import type { AxiosInstance } from "axios";
import { describe, expect, it, vi } from "vitest";
import HttpService from "./http-service.js";
import { createHttpService } from "./index.js";

function fakeClient(
  overrides: Partial<Record<"get" | "post", unknown>> = {}
): AxiosInstance {
  return {
    get: vi.fn().mockResolvedValue({ data: "get-data" }),
    post: vi.fn().mockResolvedValue({ data: "post-data" }),
    ...overrides,
  } as unknown as AxiosInstance;
}

describe("HttpService", () => {
  it("get returns data", async () => {
    const client = fakeClient();
    const service = new HttpService(client);

    const result = await service.get("/test");

    expect(result).toBe("get-data");
    expect(client.get).toHaveBeenCalledWith("/test", undefined);
  });

  it("get forwards config", async () => {
    const client = fakeClient();
    const service = new HttpService(client);

    const config = { headers: { "x-test": "1" } };
    const result = await service.get("/test", config);

    expect(result).toBe("get-data");
    expect(client.get).toHaveBeenCalledWith("/test", config);
  });

  it("post returns data", async () => {
    const client = fakeClient();
    const service = new HttpService(client);

    const result = await service.post("/test", { a: 1 });

    expect(result).toBe("post-data");
    expect(client.post).toHaveBeenCalledWith("/test", { a: 1 }, undefined);
  });

  it("propagates get errors", async () => {
    const client = fakeClient({
      get: vi.fn().mockRejectedValue(new Error("network down")),
    });
    const service = new HttpService(client);

    await expect(service.get("/test")).rejects.toThrow("network down");
  });

  it("propagates post errors", async () => {
    const client = fakeClient({
      post: vi.fn().mockRejectedValue(new Error("boom")),
    });
    const service = new HttpService(client);

    await expect(service.post("/test", {})).rejects.toThrow("boom");
  });
});

describe("createHttpService", () => {
  it("returns an object with get/post functions using a default axios client", () => {
    const service = createHttpService();
    expect(typeof service.get).toBe("function");
    expect(typeof service.post).toBe("function");
  });

  it("uses the injected client when provided", async () => {
    const client = fakeClient();
    const service = createHttpService(client);

    const result = await service.get("/injected");

    expect(result).toBe("get-data");
    expect(client.get).toHaveBeenCalledWith("/injected", undefined);
  });
});
