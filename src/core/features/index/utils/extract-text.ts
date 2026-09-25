import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import createLoggerService from '../../../utils/services/logger/index.js';
import { Left, Right } from '../../../utils/types.js';
import type { Either } from '../../../utils/types.js';
import { ExtractError } from '../models/types.js';

const BOM = '\uFEFF';

const logger = createLoggerService();

/**
 * Extracts plain text from the given bytes.
 *
 * - `markdown`: decodes UTF-8 and strips a leading BOM when present.
 * - `pdf`: uses the pdfjs legacy build (Node, no DOM) to gather text
 *   content page by page; pages are joined with a blank line.
 *
 * Returns `Left(ExtractError)` when the PDF is invalid/corrupt or when
 * no extractable text is found (e.g. scanned PDFs without OCR).
 */
export async function extractText(
  type: 'markdown' | 'pdf',
  bytes: Buffer
): Promise<Either<ExtractError, string>> {
  let text: string;

  if (type === 'markdown') {
    text = stripBom(bytes.toString('utf8'));
  } else {
    const result = await extractPdfText(bytes);
    if (result instanceof Left) return result;
    text = result.success;
  }

  if (text.trim().length === 0) {
    return new Left(new ExtractError('no extractable text'));
  }

  return new Right(text);
}

function stripBom(value: string): string {
  return value.startsWith(BOM) ? value.slice(1) : value;
}

async function extractPdfText(
  bytes: Buffer
): Promise<Either<ExtractError, string>> {
  const task = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
  });
  try {
    const doc = await task.promise;

    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();

      let pageText = '';
      for (const item of content.items) {
        if (!('str' in item) || item.str.length === 0) continue;
        pageText += item.str;
        if (item.hasEOL) pageText += '\n';
      }
      pages.push(pageText);
    }

    return new Right(pages.join('\n\n'));
  } catch (error) {
    logger.error('extract-text: failed to extract pdf text', { error });
    return new Left(
      new ExtractError('failed to extract text from pdf', { error })
    );
  } finally {
    await task.destroy();
  }
}
