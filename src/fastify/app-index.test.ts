import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../core/utils/env.js';
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

vi.mock('../core/utils/env.js', () => ({
  getEnv: vi.fn(() => env),
}));

vi.mock('../core/utils/services/ollama/ollama-service.js', async () => {
  const { Right } = await import('../core/utils/types.js');

  class MockOllamaService {
    async embed(inputs: string[]) {
      return new Right(inputs.map(() => [0.1, 0.2, 0.3]));
    }
  }

  return { default: MockOllamaService };
});

const markdown = '# Hello\n\nThis is a small paragraph.\n';
const content = Buffer.from(markdown, 'utf8').toString('base64');

describe('POST /index (real app, Ollama mocked)', () => {
  it('embeds a valid markdown body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/index',
      payload: { type: 'markdown', content, source: 'note.md' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.type).toBe('markdown');
    expect(body.model).toBe('bge-m3');
    expect(body.source).toBe('note.md');
    expect(body.chunkCount).toBeGreaterThanOrEqual(1);
    expect(body.chunks[0].embedding).toEqual([0.1, 0.2, 0.3]);
    expect(body.chunks[0].charCount).toBe(body.chunks[0].content.length);
  });

  it('rejects a body larger than 10 MB with 413', async () => {
    const payload = JSON.stringify({
      type: 'markdown',
      content: 'a'.repeat(11 * 1024 * 1024),
      source: 'big.md',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/index',
      headers: { 'content-type': 'application/json' },
      payload,
    });

    expect(res.statusCode).toBe(413);
  });
});
