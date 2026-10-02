import "reflect-metadata";
import fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import buildRoutes from "../../../utils/controller/build-routes.js";
import type { ICreateController } from "../../../utils/controller/types.js";
import HttpError from "../../../utils/errors/http-error.js";
import { Left, Right } from "../../../utils/types.js";
import type { Either } from "../../../utils/types.js";
import type { QueryResult } from "../models/types.js";
import type QueryContentUsecase from "../usecases/query-content-usecase.js";
import QueryController from "./query-controller.js";

const mockError = vi.fn();
vi.mock("../../../utils/services/logger/index.js", () => ({
  default: () => ({ error: mockError }),
}));

const queryResult: QueryResult = {
  query: "foo",
  count: 1,
  results: [
    {
      score: 0.9,
      source: "doc.md",
      type: "markdown",
      chunkIndex: 0,
      headings: ["Intro"],
      content: "hello world",
      indexedAt: "2025-01-01T00:00:00.000Z",
    },
  ],
};

type Execute = (req: unknown) => Promise<Either<HttpError, QueryResult>>;

const createApp = (execute: Execute) => {
  const app = fastify();
  const factories: ICreateController<object>[] = [
    () => new QueryController({ execute } as unknown as QueryContentUsecase),
  ];
  buildRoutes(app, factories);
  return app;
};

describe("QueryController (GET /query)", () => {
  it("returns 200 with the exact QueryResult when the usecase resolves Right", async () => {
    const execute = vi.fn().mockResolvedValue(new Right(queryResult));
    const app = createApp(execute);
    const res = await app.inject({
      method: "GET",
      url: "/query?q=foo",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(queryResult);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith({ q: "foo", limit: 5 });
    await app.close();
  });

  it("returns 502 with the HttpError message and statusCode when the usecase resolves Left(502)", async () => {
    const execute = vi
      .fn()
      .mockResolvedValue(
        new Left(
          new HttpError({ message: "failed to embed query", statusCode: 502 })
        )
      );
    const app = createApp(execute);
    const res = await app.inject({
      method: "GET",
      url: "/query?q=x",
    });

    expect(res.statusCode).toBe(502);
    const body = res.json();
    expect(body.message).toBe("failed to embed query");
    expect(body.statusCode).toBe(502);
    await app.close();
  });

  it("returns 400 without calling the usecase when q is missing", async () => {
    const execute = vi.fn();
    const app = createApp(execute);
    const res = await app.inject({
      method: "GET",
      url: "/query",
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.message).toBe("invalid query params");
    expect(body.statusCode).toBe(400);
    expect(execute).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns 400 without calling the usecase when q is empty", async () => {
    const execute = vi.fn();
    const app = createApp(execute);
    const res = await app.inject({
      method: "GET",
      url: "/query?q=",
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.message).toBe("invalid query params");
    expect(body.statusCode).toBe(400);
    expect(execute).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns 400 without calling the usecase when limit is 0", async () => {
    const execute = vi.fn();
    const app = createApp(execute);
    const res = await app.inject({
      method: "GET",
      url: "/query?q=x&limit=0",
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.message).toBe("invalid query params");
    expect(body.statusCode).toBe(400);
    expect(execute).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns 400 without calling the usecase when limit is 21", async () => {
    const execute = vi.fn();
    const app = createApp(execute);
    const res = await app.inject({
      method: "GET",
      url: "/query?q=x&limit=21",
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.message).toBe("invalid query params");
    expect(body.statusCode).toBe(400);
    expect(execute).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns 400 without calling the usecase when limit is not a number", async () => {
    const execute = vi.fn();
    const app = createApp(execute);
    const res = await app.inject({
      method: "GET",
      url: "/query?q=x&limit=abc",
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.message).toBe("invalid query params");
    expect(body.statusCode).toBe(400);
    expect(execute).not.toHaveBeenCalled();
    await app.close();
  });
});
