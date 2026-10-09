#!/usr/bin/env node
/**
 * reindex-vault.mjs — bulk (re)index of an Obsidian vault into the RAG API.
 *
 * Walks a vault directory for *.md / *.pdf files and POSTs each one to
 * `{--api}/index` (sequentially). State is kept in a JSON manifest so the
 * run is resumable: files whose sha256+mtime match the manifest are skipped
 * unless --force is given. The manifest is rewritten (atomic tmp+rename)
 * after every successful index, so a killed run resumes where it stopped.
 *
 * Usage:
 *   node scripts/reindex-vault.mjs --vault <path> [options]
 *
 * Options:
 *   --vault <path>      Vault directory (required).
 *   --api <url>         API base URL (default: http://localhost:8080).
 *   --manifest <path>   Manifest file (default: tmp/reindex-manifest.json).
 *   --recreate          Drop the Qdrant collection BEFORE indexing (see below).
 *   --force             Reindex everything, ignoring the manifest.
 *   --ignore <glob>     Extra glob to skip (repeatable, e.g. --ignore "Templates/**").
 *                       Globs match the vault-relative path: * (no /), ? (one char), ** (any depth).
 *   --help              Show this help.
 *
 * Walk rules:
 *   - Only *.md and *.pdf (extension case-insensitive).
 *   - Skips hidden files/dirs (name starts with "."), which covers .obsidian/.
 *   - source = vault-relative path with "/" separators (e.g. "Pessoas/Mayne.md").
 *
 * Retries:
 *   1 initial attempt + up to 3 retries with exponential backoff 1s/2s/4s,
 *   ONLY on network errors or HTTP 5xx. 4xx is a client error: logged, file
 *   added to the failed list, run continues.
 *
 * --recreate:
 *   Requires QDRANT_URL and QDRANT_COLLECTION in the script environment.
 *   Deletes the collection via Qdrant REST (DELETE /collections/{name}) and
 *   waits until it is gone. The collection is NOT created here: creation
 *   happens in the API on the first upsert (ensureCollection), which is the
 *   simplest robust path — the API already knows the dimension and the
 *   dense+sparse config. Only runs with the explicit flag, and logs what
 *   will be dropped before doing it.
 *
 * Exit codes: 0 = no failures, 1 = at least one file failed, 2 = usage error.
 */

import { readdir, stat as fsStat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_API = 'http://localhost:8080';
const DEFAULT_MANIFEST = 'tmp/reindex-manifest.json';
const BACKOFFS_MS = [1000, 2000, 4000]; // waits before retries 1, 2 and 3
const HEALTH_ATTEMPTS = 15;
const HEALTH_INTERVAL_MS = 2000;
const GONE_POLL_MS = 250;
const GONE_POLL_MAX = 40;

const log = (msg) => console.log(`[reindex] ${msg}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class RetryableError extends Error {}
class FatalHttpError extends Error {
  constructor(status, body) {
    super(`HTTP ${status}: ${body.slice(0, 300)}`);
    this.status = status;
  }
}

function usage() {
  console.log(
    [
      'Usage: node scripts/reindex-vault.mjs --vault <path> [options]',
      '',
      '  --vault <path>      Vault directory (required)',
      `  --api <url>         API base URL (default: ${DEFAULT_API})`,
      `  --manifest <path>   Manifest file (default: ${DEFAULT_MANIFEST})`,
      '  --recreate          Drop Qdrant collection first (needs QDRANT_URL + QDRANT_COLLECTION env)',
      '  --force             Ignore manifest, reindex everything',
      '  --ignore <glob>     Skip matching paths (repeatable, e.g. "Templates/**")',
      '  --help              Show this help',
    ].join('\n'),
  );
}

function parseArgs(argv) {
  const opts = {
    vault: null,
    api: DEFAULT_API,
    manifest: DEFAULT_MANIFEST,
    recreate: false,
    force: false,
    ignore: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`missing value for ${arg}`);
      return argv[i];
    };
    if (arg === '--vault') opts.vault = next();
    else if (arg === '--api') opts.api = next();
    else if (arg === '--manifest') opts.manifest = next();
    else if (arg === '--ignore') opts.ignore.push(next());
    else if (arg === '--recreate') opts.recreate = true;
    else if (arg === '--force') opts.force = true;
    else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  if (!opts.vault) {
    usage();
    throw new Error('--vault is required');
  }
  return opts;
}

/** Convert a glob to an anchored RegExp. Supports * (no /), ? (one char), ** (any depth). */
function globToRegExp(glob) {
  const g = glob.replace(/\\/g, '/');
  let re = '';
  for (let i = 0; i < g.length; i += 1) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        re += '.*';
        i += 1;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

/** Recursively collect *.md/*.pdf files under vaultDir (skips hidden + ignores). */
async function walkVault(vaultDir, ignorePatterns) {
  const ignores = ignorePatterns.map(globToRegExp);
  const files = [];
  const stack = [vaultDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue; // hidden files/dirs incl. .obsidian
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (ext !== '.md' && ext !== '.pdf') continue;
      const source = path
        .relative(vaultDir, full)
        .split(path.sep)
        .join('/');
      if (ignores.some((re) => re.test(source))) continue;
      files.push({ source, type: ext === '.pdf' ? 'pdf' : 'markdown', full });
    }
  }
  files.sort((a, b) => a.source.localeCompare(b.source));
  return files;
}

function loadManifest(manifestPath) {
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return {};
  }
}

/** Atomic write: tmp file + rename, so a kill never corrupts the manifest. */
function saveManifest(manifestPath, data) {
  mkdirSync(path.dirname(path.resolve(manifestPath)), { recursive: true });
  const tmp = `${manifestPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, manifestPath);
}

/** Read file once: sha256 + mtime + raw buffer (reused for the upload). */
function fingerprint(full) {
  const buf = readFileSync(full);
  return {
    sha256: createHash('sha256').update(buf).digest('hex'),
    mtime: statSync(full).mtimeMs,
    buf,
  };
}

async function postIndex(apiBase, payload) {
  const res = await fetch(`${apiBase.replace(/\/+$/, '')}/index`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status >= 500) throw new RetryableError(`HTTP ${res.status}`);
    throw new FatalHttpError(res.status, body);
  }
  return res.json();
}

/** 1 initial attempt + up to 3 retries (backoff 1s/2s/4s), only for retryable errors. */
async function postIndexWithRetry(apiBase, payload, source) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await postIndex(apiBase, payload);
    } catch (err) {
      if (!(err instanceof RetryableError) || attempt >= BACKOFFS_MS.length) throw err;
      const delay = BACKOFFS_MS[attempt];
      log(`  ${source}: retryable error (${err.message}), retry ${attempt + 1}/${BACKOFFS_MS.length} in ${delay}ms`);
      await sleep(delay);
    }
  }
}

async function waitForApi(apiBase) {
  const url = `${apiBase.replace(/\/+$/, '')}/health`;
  for (let attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    if (attempt < HEALTH_ATTEMPTS) {
      log(`API not up yet, retrying in ${HEALTH_INTERVAL_MS / 1000}s (${attempt}/${HEALTH_ATTEMPTS})`);
      await sleep(HEALTH_INTERVAL_MS);
    }
  }
  throw new Error(`API not healthy after ${HEALTH_ATTEMPTS} attempts: GET ${url}`);
}

function qdrantHeaders(apiKey) {
  return apiKey ? { 'api-key': apiKey } : {};
}

/** DELETE the collection via Qdrant REST and wait until it is gone. */
async function dropCollection(qdrantUrl, collection, apiKey) {
  const base = qdrantUrl.replace(/\/+$/, '');
  const res = await fetch(`${base}/collections/${encodeURIComponent(collection)}`, {
    method: 'DELETE',
    headers: qdrantHeaders(apiKey),
  });
  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => '');
    throw new Error(`Qdrant DELETE /collections/${collection} failed: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  for (let i = 0; i < GONE_POLL_MAX; i += 1) {
    const chk = await fetch(`${base}/collections/${encodeURIComponent(collection)}`, {
      headers: qdrantHeaders(apiKey),
    });
    if (chk.status === 404) return;
    await sleep(GONE_POLL_MS);
  }
  throw new Error(`collection ${collection} still present ${GONE_POLL_MAX * GONE_POLL_MS}ms after DELETE`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const vaultDir = path.resolve(opts.vault);
  if (!existsSync(vaultDir) || !(await fsStat(vaultDir)).isDirectory()) {
    throw new Error(`vault not found or not a directory: ${vaultDir}`);
  }

  if (opts.recreate) {
    const qdrantUrl = process.env.QDRANT_URL;
    const collection = process.env.QDRANT_COLLECTION;
    if (!qdrantUrl || !collection) {
      throw new Error('--recreate requires QDRANT_URL and QDRANT_COLLECTION in the environment');
    }
    log(`--recreate: WILL DROP collection "${collection}" at ${qdrantUrl} (all its points are lost)`);
    await dropCollection(qdrantUrl, collection, process.env.QDRANT_API_KEY);
    log(`collection "${collection}" dropped; it will be recreated by the API on the first upsert`);
  }

  log(`waiting for API at ${opts.api}`);
  await waitForApi(opts.api);

  const files = await walkVault(vaultDir, opts.ignore);
  if (files.length === 0) {
    log('no .md/.pdf files found in vault (after ignores)');
    console.log(JSON.stringify({ indexed: 0, skipped: 0, failed: [] }, null, 2));
    return;
  }

  let manifest = opts.force ? {} : loadManifest(opts.manifest);
  if (opts.force) log('--force: ignoring manifest, reindexing everything');
  log(`${files.length} file(s) to process`);

  const failed = [];
  let indexed = 0;
  let skipped = 0;

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const progress = `[${i + 1}/${files.length}] ${file.source}`;
    try {
      const { sha256, mtime, buf } = fingerprint(file.full);
      const prev = manifest[file.source];
      if (!opts.force && prev && prev.sha256 === sha256 && prev.mtime === mtime) {
        skipped += 1;
        console.log(`${progress} → SKIP (unchanged)`);
        continue;
      }
      const result = await postIndexWithRetry(opts.api, {
        type: file.type,
        content: buf.toString('base64'),
        source: file.source,
      });
      manifest[file.source] = { sha256, mtime, indexedAt: new Date().toISOString() };
      saveManifest(opts.manifest, manifest);
      indexed += 1;
      console.log(`${progress} → ${result.chunkCount} chunks`);
    } catch (err) {
      failed.push(file.source);
      console.log(`${progress} → FALHOU (${err.message})`);
    }
  }

  const summary = { indexed, skipped, failed };
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = failed.length > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error(`[reindex] fatal: ${err.message}`);
  process.exit(2);
});
