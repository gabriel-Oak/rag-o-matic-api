import { describe, expect, it, vi } from "vitest";
import type { Env } from "../../../utils/env.js";
import { getEnv } from "../../../utils/env.js";
import type { ILoggerService } from "../../../utils/services/logger/types.js";
import type { IOllamaService } from "../../../utils/services/ollama/types.js";
import { OllamaError } from "../../../utils/services/ollama/types.js";
import { Left, Right } from "../../../utils/types.js";
import type { IndexRequest } from "../models/types.js";
import IndexContentUsecase from "./index-content.usecase.js";

vi.mock("../../../utils/env.js", () => ({
  getEnv: vi.fn(),
}));

const env = {
  NODE_ENV: "test",
  PORT: 8080,
  OLLAMA_URL: "http://localhost:11434",
  OLLAMA_EMBEDDING_MODEL: "bge-m3",
  QDRANT_URL: "http://localhost:6333",
  QDRANT_COLLECTION: "vault_notes",
  QDRANT_DIMENSION: 1024,
} as Env;

function fakeLogger(): ILoggerService {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makeUsecase(embed: IOllamaService["embed"]) {
  const ollamaService: IOllamaService = { embed };
  const logger = fakeLogger();
  const usecase = new IndexContentUsecase(ollamaService, logger);

  return { usecase, embed: embed as unknown as vi.Mock, logger };
}

function b64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

function markdownRequest(
  content: string,
  extra: Partial<IndexRequest> = {}
): IndexRequest {
  return {
    type: "markdown",
    content: b64(content),
    source: "test.md",
    ...extra,
  };
}

describe("IndexContentUsecase.execute", () => {
  it("returns summary shape for markdown with frontmatter, embedding inputs prefixed with frontmatter", async () => {
    vi.mocked(getEnv).mockReturnValue(env);
    const frontmatter = "tags: [rag]";
    const markdown = `---\n${frontmatter}\n---\n\n# Title\n\nText here.`;
    const embedding = [0.1, 0.2, 0.3];
    const embed = vi.fn().mockResolvedValue(new Right([[...embedding]]));
    const { usecase, embed: embedMock } = makeUsecase(embed);

    const result = await usecase.execute(
      markdownRequest(markdown, { source: "doc.md" })
    );

    expect(result.isError).toBe(false);
    if (result.isError) throw result.error;
    expect(result.success.source).toBe("doc.md");
    expect(result.success.model).toBe("bge-m3");
    expect(result.success.type).toBe("markdown");
    expect(result.success.chunkCount).toBe(1);
    expect(result.success.upserted).toBe(0);

    expect(embedMock).toHaveBeenCalledTimes(1);
    const [inputs] = embedMock.mock.calls[0];
    expect(inputs).toHaveLength(1);
    expect(inputs[0].startsWith(frontmatter + "\n\n")).toBe(true);
  });

  it("does not prefix embedding inputs when markdown has no frontmatter", async () => {
    vi.mocked(getEnv).mockReturnValue(env);
    const markdown = "# Title\n\nText here.";
    const embed = vi.fn().mockResolvedValue(new Right([[1, 2, 3]]));
    const { usecase, embed: embedMock } = makeUsecase(embed);

    const result = await usecase.execute(markdownRequest(markdown));

    expect(result.isError).toBe(false);
    if (result.isError) throw result.error;
    expect(result.success.chunkCount).toBe(1);
    expect(result.success.upserted).toBe(0);

    expect(embedMock).toHaveBeenCalledTimes(1);
    const [inputs] = embedMock.mock.calls[0];
    expect(inputs).toHaveLength(1);
    expect(inputs[0].startsWith("# Title")).toBe(true);
  });

  it("returns Left(HttpError 422) when extractText fails", async () => {
    vi.mocked(getEnv).mockReturnValue(env);
    const embed = vi.fn();
    const { usecase, embed: embedMock, logger } = makeUsecase(embed);

    const result = await usecase.execute({
      type: "pdf",
      content: Buffer.from("not a pdf").toString("base64"),
      source: "doc.pdf",
    });

    expect(result.isError).toBe(true);
    if (!result.isError) throw result.success;
    expect(result.error.statusCode).toBe(422);
    expect(logger.error).toHaveBeenCalled();
    expect(embedMock).not.toHaveBeenCalled();
  });

  it("returns Left(HttpError 502) when Ollama fails", async () => {
    vi.mocked(getEnv).mockReturnValue(env);
    const markdown = "# Title\n\nText here.";
    const embed = vi
      .fn()
      .mockResolvedValue(new Left(new OllamaError("boom")));
    const { usecase, logger } = makeUsecase(embed);

    const result = await usecase.execute(markdownRequest(markdown));

    expect(result.isError).toBe(true);
    if (!result.isError) throw result.success;
    expect(result.error.statusCode).toBe(502);
    expect(result.error.meta).toBeInstanceOf(OllamaError);
    expect(logger.error).toHaveBeenCalled();
  });

  it("returns Left(HttpError 400) when no chunks are produced", async () => {
    vi.mocked(getEnv).mockReturnValue(env);
    const embed = vi.fn();
    const { usecase, embed: embedMock } = makeUsecase(embed);

    const result = await usecase.execute(
      markdownRequest("---\ntags: [x]\n---\n")
    );

    expect(result.isError).toBe(true);
    if (!result.isError) throw result.success;
    expect(result.error.statusCode).toBe(400);
    expect(result.error.message).toBe(
      "no chunks produced from the provided content"
    );
    expect(embedMock).not.toHaveBeenCalled();
  });

  it("returns Left(HttpError 422) for whitespace-only markdown (extractText guards first)", async () => {
    vi.mocked(getEnv).mockReturnValue(env);
    const embed = vi.fn();
    const { usecase } = makeUsecase(embed);

    const result = await usecase.execute(markdownRequest("   \n  \n"));

    expect(result.isError).toBe(true);
    if (!result.isError) throw result.success;
    expect(result.error.statusCode).toBe(422);
  });

});
