import { config } from 'dotenv';

const result = config({ path: '.env', quiet: true });
if (result.error && result.error.code !== 'ENOENT') {
  throw result.error;
}
