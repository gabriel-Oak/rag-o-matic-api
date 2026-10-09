import fastify from 'fastify';
import cors from '@fastify/cors';
import { mountMcp } from '../core/mcp/mcp-transport.js';
import createRouter from './routes.js';

const app = fastify({ bodyLimit: 50 * 1024 * 1024 });

// MCP Streamable HTTP clients (e.g. @modelcontextprotocol/sdk) send
// `DELETE /mcp` with `content-type: application/json` and NO body. Fastify's
// default JSON parser rejects empty bodies with FST_ERR_CTP_EMPTY_JSON_BODY
// (400) before the route handler runs, so real clients can never terminate
// a session. Tolerate empty JSON bodies (parsed as undefined); non-empty
// bodies parse exactly as before, including 400 on malformed JSON.
app.removeAllContentTypeParsers();
app.addContentTypeParser(
  ['application/json', 'application/*+json'],
  { parseAs: 'buffer' },
  (req, body, done) => {
    if (body.length === 0) {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(body.toString('utf8')));
    } catch (error) {
      const err = error as Error & { statusCode?: number };
      err.statusCode = 400;
      done(err, undefined);
    }
  },
);
app.addContentTypeParser('text/plain', (req, body, done) => {
  done(null, body);
});

void app.register(cors);
createRouter(app);
mountMcp(app);

export default app;
