import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { getEnv } from '../../core/utils/env.js';
import HttpError from '../../core/utils/errors/http-error.js';

const BEARER_PATTERN = /^Bearer\s+(.+)$/i;

const digest = (value: string) => createHash('sha256').update(value).digest();

// Generic 401: never reveal whether the header was missing, the scheme was
// wrong, or the key was wrong.
const sendUnauthorized = (reply: FastifyReply) =>
  reply.code(401).send(new HttpError({ message: 'Unauthorized', statusCode: 401 }));

export const registerApiKeyAuth = (app: FastifyInstance): void => {
  app.addHook('preHandler', async (req, reply) => {
    if (req.routeOptions.url === '/health') return;

    const expected = getEnv().API_KEY;
    const authorization = req.headers.authorization;
    const match =
      typeof authorization === 'string'
        ? authorization.match(BEARER_PATTERN)
        : null;

    const received = match?.[1];
    if (!received) {
      sendUnauthorized(reply);
      return;
    }

    // Timing-safe: compare SHA-256 digests (fixed 32 bytes each) so the
    // comparison cost never depends on the shared prefix length.
    const ok = timingSafeEqual(digest(received), digest(expected));
    if (!ok) sendUnauthorized(reply);
  });
};

export default registerApiKeyAuth;
