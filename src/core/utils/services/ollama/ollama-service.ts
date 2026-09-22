import { getEnv } from "../../env.js";
import type { Either } from "../../types.js";
import { Left, Right } from "../../types.js";
import type { IHttpService } from "../http-service/types.js";
import type { ILoggerService } from "../logger/types.js";
import type { EmbedResponse, IOllamaService } from "./types.js";
import { OllamaError } from "./types.js";

export default class OllamaService implements IOllamaService {
  constructor(
    private readonly httpService: IHttpService,
    private readonly logger: ILoggerService
  ) {}

  async embed(
    inputs: string[]
  ): Promise<Either<OllamaError, number[][]>> {
    const { OLLAMA_URL, OLLAMA_EMBEDDING_MODEL } = getEnv();

    try {
      const response = await this.httpService.post<EmbedResponse>(
        `${OLLAMA_URL}/api/embed`,
        { model: OLLAMA_EMBEDDING_MODEL, input: inputs }
      );

      if (!this.isValidEmbeddings(response?.embeddings, inputs.length)) {
        const error = new OllamaError(
          "Ollama /api/embed returned an invalid response",
          { expected: inputs.length, received: response?.embeddings }
        );
        this.logger.error(error.message, error);
        return new Left(error);
      }

      return new Right(response.embeddings);
    } catch (e) {
      const error = new OllamaError("Failed to embed inputs via Ollama", {
        error: e,
      });
      this.logger.error(error.message, error);
      return new Left(error);
    }
  }

  private isValidEmbeddings(
    embeddings: unknown,
    expectedLength: number
  ): embeddings is number[][] {
    if (!Array.isArray(embeddings) || embeddings.length !== expectedLength) {
      return false;
    }

    return embeddings.every(
      (vector) =>
        Array.isArray(vector) &&
        vector.every(
          (value) => typeof value === "number" && Number.isFinite(value)
        )
    );
  }
}
