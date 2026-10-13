import { config } from 'dotenv';
import { getEnv } from '../core/utils/env.js';

const result = config({ path: '.env', quiet: true });
if (result.error && result.error.code !== 'ENOENT') {
  throw result.error;
}

// Fail fast on startup: throws listing every invalid/missing field (zod).
getEnv();
