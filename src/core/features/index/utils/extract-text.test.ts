import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractText } from './extract-text.js';
import { ExtractError } from '../models/types.js';
import { Left, Right } from '../../../utils/types.js';

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '__fixtures__',
);

describe('extractText', () => {
  it('returns exact text for markdown utf-8', async () => {
    const bytes = Buffer.from('# Title\n\nBody text.', 'utf8');
    const result = await extractText('markdown', bytes);

    expect(result).toBeInstanceOf(Right);
    if (result.isError) throw new Error('expected success');
    expect(result.success).toBe('# Title\n\nBody text.');
  });

  it('strips leading BOM from markdown', async () => {
    const bytes = Buffer.from('\uFEFF# Title', 'utf8');
    const result = await extractText('markdown', bytes);

    expect(result).toBeInstanceOf(Right);
    if (result.isError) throw new Error('expected success');
    expect(result.success).toBe('# Title');
  });

  it('extracts known text from sample.pdf fixture', async () => {
    const bytes = readFileSync(join(fixturesDir, 'sample.pdf'));
    const result = await extractText('pdf', bytes);

    expect(result).toBeInstanceOf(Right);
    if (result.isError) throw new Error('expected success');
    expect(result.success).toContain('Hello RAG sample');
  });

  it('returns Left(ExtractError) for garbage bytes as pdf', async () => {
    const result = await extractText('pdf', Buffer.from('not a pdf'));

    expect(result).toBeInstanceOf(Left);
    if (!result.isError) throw new Error('expected error');
    expect(result.error).toBeInstanceOf(ExtractError);
  });

  it('returns Left(ExtractError) when pdf has no extractable text', async () => {
    const bytes = readFileSync(join(fixturesDir, 'sample-blank.pdf'));
    const result = await extractText('pdf', bytes);

    expect(result).toBeInstanceOf(Left);
    if (!result.isError) throw new Error('expected error');
    expect(result.error).toBeInstanceOf(ExtractError);
    expect(result.error.message).toBe('no extractable text');
  });
});
