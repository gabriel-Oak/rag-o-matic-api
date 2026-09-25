import 'reflect-metadata';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { Env } from '../core/utils/env.js';
import type { VectorSearchHit } from '../core/utils/services/vector-database/types.js';
import app from './app.js';

const env = {
  NODE_ENV: 'test',
  PORT: 8080,
  OLLAMA_URL: 'http://localhost:11434',
  OLLAMA_EMBEDDING_MODEL: 'bge-m3',
  QDRANT_URL: 'http://localhost:6333',
  QDRANT_COLLECTION: 'vault_notes',
  QDRANT_DIMENSION: 1024,
} as Env;

// Read by the mock factories' closures at CALL time (not at factory execution
// time), so top-level bindings are safe to reference here (vi.mock hoisting).
const embeddedInputs: string[][] = [];

const defaultHits: VectorSearchHit[] = [
  {
    score: 0.92,
    point: {
      id: '8f14e45f-a1b2-4c3d-9e8f-0123456789ab',
      vector: new Array<number>(1024).fill(0.1),
      payload: {
        source: 'therapy-notes.md',
        type: 'markdown',
        chunkIndex: 0,
        content: 'A terapia cognitivo-comportamental ajuda a reestruturar pensamentos.',
        headings: ['Terapia', 'Introdução'],
        indexedAt: '2026-09-20T12:00:00.000Z',
      },
    },
  },
  {
    score: 0.81,
    point: {
      id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
      vector: new Array<number>(1024).fill(0.2),
      payload: {
        source: 'notes/weekly.md',
        type: 'markdown',
        chunkIndex: 2,
        content: 'Sessão de terapia focada em ansiedade.',
        headings: ['Semanal'],
        indexedAt: '2026-09-21T08:30:00.000Z',
      },
    },
  },
  {
    score: 0.55,
    point: {
      id: '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e',
      vector: new Array<number>(1024).fill(0.3),
      payload: {
        source: 'therapy.pdf',
        type: 'pdf',
        chunkIndex: 7,
        content: 'Exercícios de respiração para a próxima sessão.',
        headings: [],
        indexedAt: '2026-09-22T15:45:00.000Z',
      },
    },
  },
];

let mockHits: VectorSearchHit[] = defaultHits;

vi.mock('../core/utils/env.js', () => ({
  getEnv: vi.fn(() => env),
}));

vi.mock('../core/utils/services/ai/ollama-ai-service.js', async () => {
  const { Right } = await import('../core/utils/types.js');

  class MockAiService {
    async embed(inputs: string[]) {
      embeddedInputs.push(inputs);
      return new Right(
        inputs.map(() => new Array<number>(env.QDRANT_DIMENSION).fill(0.1)),
      );
    }
  }

  return { default: MockAiService };
});

vi.mock('../core/utils/services/vector-database/index.js', async () => {
  const { Right } = await import('../core/utils/types.js');

  return {
    createVectorDatabaseService: () => ({
      ensureCollection: async () => new Right(undefined),
      upsertPoints: async () => new Right(undefined),
      queryPoints: async () => new Right(mockHits),
      deletePointsByFilter: async () => new Right(undefined),
      close: async () => undefined,
    }),
  };
});

describe('GET /query (real app, services mocked)', () => {
  beforeEach(() => {
    embeddedInputs.length = 0;
  });

  afterEach(() => {
    mockHits = defaultHits;
  });

  it('returns 200 with mapped payload fields, echoed query and no model key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/query?q=terapia&limit=3',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.query).toBe('terapia');
    expect(body.count).toBe(3);
    expect(body.results).toHaveLength(3);
    expect(body.results[0]).toEqual({
      score: 0.92,
      source: 'therapy-notes.md',
      type: 'markdown',
      chunkIndex: 0,
      headings: ['Terapia', 'Introdução'],
      content:
        'A terapia cognitivo-comportamental ajuda a reestruturar pensamentos.',
      indexedAt: '2026-09-20T12:00:00.000Z',
    });
    expect(body.results[1]).toEqual({
      score: 0.81,
      source: 'notes/weekly.md',
      type: 'markdown',
      chunkIndex: 2,
      headings: ['Semanal'],
      content: 'Sessão de terapia focada em ansiedade.',
      indexedAt: '2026-09-21T08:30:00.000Z',
    });
    expect(body.results[2]).toEqual({
      score: 0.55,
      source: 'therapy.pdf',
      type: 'pdf',
      chunkIndex: 7,
      headings: [],
      content: 'Exercícios de respiração para a próxima sessão.',
      indexedAt: '2026-09-22T15:45:00.000Z',
    });
    expect(body).not.toHaveProperty('model');
    expect(embeddedInputs).toEqual([['terapia']]);
  });

  it('returns 400 when q is empty', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/query?q=',
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.message).toBe('invalid query params');
    expect(embeddedInputs).toEqual([]);
  });

  it('returns 400 when limit exceeds 20', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/query?q=x&limit=99',
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.message).toBe('invalid query params');
    expect(embeddedInputs).toEqual([]);
  });

  it('returns 200 with empty results when no points match', async () => {
    mockHits = [];

    const res = await app.inject({
      method: 'GET',
      url: '/query?q=terapia',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.query).toBe('terapia');
    expect(body.count).toBe(0);
    expect(body.results).toEqual([]);
    expect(embeddedInputs).toEqual([['terapia']]);
  });
});
