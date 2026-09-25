import "reflect-metadata";
import fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import buildRoutes from "../../../utils/controller/build-routes.js";
import type { ICreateController } from "../../../utils/controller/types.js";
import HttpError from "../../../utils/errors/http-error.js";
import { Left, Right } from "../../../utils/types.js";
import type { Either } from "../../../utils/types.js";
import type { IndexResult } from "../models/types.js";
import type IndexContentUsecase from "../usecases/index-content-usecase.js";
import IndexController from "./index-controller.js";

const mockError = vi.fn();
vi.mock("../../../utils/services/logger/index.js", () => ({
  default: () => ({ error: mockError }),
}));

const indexResult: IndexResult = {
  source: "doc.md",
  type: "markdown",
  model: "bge-m3",
  chunkCount: 1,
  upserted: 1,
};

const validBody = {
  type: "markdown",
  content: Buffer.from("hello", "utf8").toString("base64"),
  source: "doc.md",
};

type Execute = (
  req: unknown
) => Promise<Either<HttpError, IndexResult>>;

const createApp = (execute: Execute) => {
  const app = fastify();
  const factories: ICreateController<object>[] = [
    () => new IndexController({ execute } as unknown as IndexContentUsecase),
  ];
  buildRoutes(app, factories);
  return app;
};

describe("IndexController (POST /index)", () => {
  it("returns 200 with the exact IndexResult when the usecase resolves Right", async () => {
    const execute = vi.fn().mockResolvedValue(new Right(indexResult));
    const app = createApp(execute);
    const res = await app.inject({
      method: "POST",
      url: "/index",
      payload: validBody,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(indexResult);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(validBody);
    await app.close();
  });

  it("returns 422 with the HttpError message and statusCode when the usecase resolves Left(422)", async () => {
    const execute = vi
      .fn()
      .mockResolvedValue(
        new Left(
          new HttpError({ message: "no extractable text", statusCode: 422 })
        )
      );
    const app = createApp(execute);
    const res = await app.inject({
      method: "POST",
      url: "/index",
      payload: validBody,
    });

    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.message).toBe("no extractable text");
    expect(body.statusCode).toBe(422);
    await app.close();
  });

  it("returns 502 when the usecase resolves Left(502)", async () => {
    const execute = vi
      .fn()
      .mockResolvedValue(
        new Left(new HttpError({ message: "ollama down", statusCode: 502 }))
      );
    const app = createApp(execute);
    const res = await app.inject({
      method: "POST",
      url: "/index",
      payload: validBody,
    });

    expect(res.statusCode).toBe(502);
    const body = res.json();
    expect(body.message).toBe("ollama down");
    expect(body.statusCode).toBe(502);
    await app.close();
  });

  it("returns 400 without calling the usecase when content is missing", async () => {
    const execute = vi.fn();
    const app = createApp(execute);
    const res = await app.inject({
      method: "POST",
      url: "/index",
      payload: { type: "markdown" },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.message).toBe("invalid request body");
    expect(body.statusCode).toBe(400);
    expect(execute).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns 400 without calling the usecase when source is missing", async () => {
    const execute = vi.fn();
    const app = createApp(execute);
    const res = await app.inject({
      method: "POST",
      url: "/index",
      payload: {
        type: "markdown",
        content: Buffer.from("hello", "utf8").toString("base64"),
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.message).toBe("invalid request body");
    expect(body.statusCode).toBe(400);
    expect(execute).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns 400 without calling the usecase when content is not valid base64", async () => {
    const execute = vi.fn();
    const app = createApp(execute);
    const res = await app.inject({
      method: "POST",
      url: "/index",
      payload: { type: "markdown", content: "not-base64!!" },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.message).toBe("invalid request body");
    expect(body.statusCode).toBe(400);
    expect(execute).not.toHaveBeenCalled();
    await app.close();
  });
});
