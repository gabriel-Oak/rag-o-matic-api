/**
 * Integration test — runs against a real Qdrant (QDRANT_URL, or
 * http://localhost:6333 when unset) and SKIPS automatically when no
 * Qdrant is reachable, so `npm test` stays green in environments
 * without one (e.g. CI).
 *
 * Regression guard for the "dead ranking" bug: a prefetch item without
 * a `query` field makes Qdrant silently return points ordered by ID
 * (vectors ignored), so EVERY query returns the same list with
 * position-based scores (1.0, 0.667, 0.5, ...). Two very different
 * queries MUST NOT return the same list of sources.
 */
import { randomUUID } from "node:crypto";
import { QdrantClient } from "@qdrant/js-client-rest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSparseVector } from "../../../features/index/utils/sparse-tf.js";
import type { ILoggerService } from "../../logger/types.js";
import QdrantVectorDatabaseService from "./qdrant-vector-database-service.js";
import type { VectorPoint } from "./types.js";

const QDRANT_URL = process.env.QDRANT_URL ?? "http://localhost:6333";
const COLLECTION = `rag_omatic_vitest_${Date.now().toString(36)}`;
const DIMENSION = 16;

// Configure env before the service's first getEnv() call (env is cached
// per process). Must run at module load, before any test executes.
process.env.NODE_ENV = "test";
process.env.OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
process.env.OLLAMA_EMBEDDING_MODEL = "bge-m3";
process.env.QDRANT_URL = QDRANT_URL;
process.env.QDRANT_COLLECTION = COLLECTION;
process.env.QDRANT_DIMENSION = String(DIMENSION);

const parsed = new URL(QDRANT_URL);
const client = new QdrantClient({
  host: parsed.hostname,
  port: Number(parsed.port) || (parsed.protocol === "https:" ? 443 : 6333),
  https: parsed.protocol === "https:",
  ...(process.env.QDRANT_API_KEY
    ? { apiKey: process.env.QDRANT_API_KEY }
    : {}),
});

const reachable = await (async () => {
  try {
    const res = await fetch(`${QDRANT_URL}/collections`, {
      signal: AbortSignal.timeout(3000),
      headers: process.env.QDRANT_API_KEY
        ? { "api-key": process.env.QDRANT_API_KEY }
        : {},
    });
    return res.ok;
  } catch {
    return false;
  }
})();

const logger: ILoggerService = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

const unitVector = (position: number): number[] => {
  const vector = new Array<number>(DIMENSION).fill(0);
  vector[position] = 1;
  return vector;
};

// Six sources, each with its own dense basis vector and its own sparse
// term, so "alpha" and "zeta" queries are maximally different.
const TERMS = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"];

const service = new QdrantVectorDatabaseService(logger);

const sourcesOf = (
  hits: Array<{ point: VectorPoint }>,
): string[] => hits.map((hit) => hit.point.payload.source as string);

describe.skipIf(!reachable)(
  "QdrantVectorDatabaseService (integration, real Qdrant)",
  () => {
    beforeAll(async () => {
      const ensured = await service.ensureCollection();
      if (ensured.isError) throw ensured.error;

      const points: VectorPoint[] = TERMS.map((term, i) => ({
        id: randomUUID(),
        vector: unitVector(i),
        sparse: buildSparseVector(term),
        payload: {
          source: `${term}.md`,
          type: "markdown",
          chunkIndex: 0,
          content: `note about ${term}`,
          headings: [],
          indexedAt: "2026-01-01T00:00:00.000Z",
        },
      }));

      // wait: true makes the points queryable right after the call.
      await client.upsert(COLLECTION, {
        points: points.map((point) => ({
          id: point.id,
          vector: point.vector,
          payload: point.payload,
          ...(point.sparse
            ? { sparse_vectors: { text: point.sparse } }
            : {}),
        })),
        wait: true,
      });
    }, 20000);

    afterAll(async () => {
      await client.deleteCollection(COLLECTION);
      const closable = client as QdrantClient & { close?: () => Promise<void> };
      if (typeof closable.close === "function") {
        await closable.close();
      }
    }, 20000);

    it("two very different queries do NOT return the same list of sources", async () => {
      const alphaQuery = await service.queryHybrid(
        unitVector(0),
        buildSparseVector("alpha"),
        5,
      );
      const zetaQuery = await service.queryHybrid(
        unitVector(5),
        buildSparseVector("zeta"),
        5,
      );

      expect(alphaQuery.isError).toBe(false);
      if (alphaQuery.isError) throw alphaQuery.error;
      expect(zetaQuery.isError).toBe(false);
      if (zetaQuery.isError) throw zetaQuery.error;

      const alphaSources = sourcesOf(alphaQuery.success);
      const zetaSources = sourcesOf(zetaQuery.success);

      // Each query must surface its own best match first...
      expect(alphaSources[0]).toBe("alpha.md");
      expect(zetaSources[0]).toBe("zeta.md");

      // ...and the two result lists must differ (the "dead ranking"
      // regression returns the identical ID-ordered list for both).
      expect(alphaSources).not.toEqual(zetaSources);
    }, 20000);
  },
);
