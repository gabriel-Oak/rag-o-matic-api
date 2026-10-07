import { createLogger } from "winston";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import createLoggerService from "./index.js";
import LoggerService from "./logger.js";

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

describe("LoggerService error serialization", () => {
  // The winston Console transport writes through console._stdout/_stderr
  // (raw streams, not process.stdout/console.log) — capture there.
  // Transport writes happen on the next macrotask, so wait one tick.
  async function captureWrites(fn: () => void): Promise<string> {
    const written: string[] = [];
    const consoleWithStreams = console as unknown as {
      _stdout: { write: (chunk: string | Uint8Array) => boolean };
      _stderr: { write: (chunk: string | Uint8Array) => boolean };
    };
    const spyOut = vi
      .spyOn(consoleWithStreams._stdout, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        written.push(String(chunk));
        return true;
      });
    const spyErr = vi
      .spyOn(consoleWithStreams._stderr, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        written.push(String(chunk));
        return true;
      });

    try {
      fn();
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      spyOut.mockRestore();
      spyErr.mockRestore();
    }

    return written.join("");
  }

  it("serializes Error instances (message and cause) instead of {}", async () => {
    const logger = new LoggerService(createLogger());
    const cause = Object.assign(
      new Error("connect ECONNREFUSED 10.0.0.1:6333"),
      { code: "ECONNREFUSED" }
    );

    const output = await captureWrites(() => {
      logger.error("failed to reach qdrant", {
        error: new TypeError("fetch failed", { cause }),
      });
    });

    expect(output).toContain('"name":"TypeError"');
    expect(output).toContain('"message":"fetch failed"');
    expect(output).toContain('"code":"ECONNREFUSED"');
    expect(output).toContain("connect ECONNREFUSED 10.0.0.1:6333");
  });

  it("keeps plain data untouched", async () => {
    const logger = new LoggerService(createLogger());

    const output = await captureWrites(() => {
      logger.info("ok", { collection: "vault", count: 3 });
    });

    expect(output).toContain('"collection":"vault"');
    expect(output).toContain('"count":3');
  });
});
