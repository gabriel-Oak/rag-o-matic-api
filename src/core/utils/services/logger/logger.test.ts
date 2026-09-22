import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import createLoggerService from "./index.js";

describe("createLoggerService", () => {
  beforeAll(() => {
    // production mode: no console transport attached (no test output noise)
    vi.stubEnv("NODE_ENV", "production");
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("returns an object with info/warn/error/debug functions", () => {
    const logger = createLoggerService();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("log methods do not throw", () => {
    const logger = createLoggerService();
    expect(() => {
      logger.info("info message");
      logger.warn("warn message", { a: 1 });
      logger.error("error message");
      logger.debug("debug message");
    }).not.toThrow();
  });

  it("is memoized (same instance on repeated calls)", () => {
    expect(createLoggerService()).toBe(createLoggerService());
  });
});
