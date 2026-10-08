import "reflect-metadata";
import fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import buildRoutes from "../../../utils/controller/build-routes.js";
import type { ICreateController } from "../../../utils/controller/types.js";
import HttpError from "../../../utils/errors/http-error.js";
import { Left, Right } from "../../../utils/types.js";
import type { Either } from "../../../utils/types.js";
import type { DeleteSourceResult } from "../models/types.js";
import type DeleteSourceUsecase from "../usecases/delete-source-usecase.js";
import DeleteController from "./delete-controller.js";

const mockError = vi.fn();
vi.mock("../../../utils/services/logger/index.js", () => ({
  default: () => ({ error: mockError }),
}));

const deleteResult: DeleteSourceResult = {
  source: "foo",
  deleted: 3,
};

type Execute = (
  source: string
) => Promise<Either<HttpError, DeleteSourceResult>>;

const createApp = (execute: Execute) => {
  const app = fastify();
  const factories: ICreateController<object>[] = [
    () => new DeleteController({ execute } as unknown as DeleteSourceUsecase),
  ];
  buildRoutes(app, factories);
  return app;
};

describe("DeleteController (DELETE /index/:source)", () => {
  it("returns 200 with the exact DeleteSourceResult when the usecase resolves Right", async () => {
    const execute = vi.fn().mockResolvedValue(new Right(deleteResult));
    const app = createApp(execute);
    const res = await app.inject({
      method: "DELETE",
      url: "/index/foo",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(deleteResult);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith("foo");
    await app.close();
  });

  it("returns 502 with the HttpError message and statusCode when the usecase resolves Left(502)", async () => {
    const execute = vi
      .fn()
      .mockResolvedValue(
        new Left(
          new HttpError({
            message: "failed to delete points for source",
            statusCode: 502,
          })
        )
      );
    const app = createApp(execute);
    const res = await app.inject({
      method: "DELETE",
      url: "/index/foo",
    });

    expect(res.statusCode).toBe(502);
    const body = res.json();
    expect(body.message).toBe("failed to delete points for source");
    expect(body.statusCode).toBe(502);
    await app.close();
  });

  it("returns 404 without calling the usecase when the source param is missing", async () => {
    const execute = vi.fn();
    const app = createApp(execute);
    const res = await app.inject({
      method: "DELETE",
      url: "/index",
    });

    expect(res.statusCode).toBe(404);
    expect(execute).not.toHaveBeenCalled();
    await app.close();
  });
});
