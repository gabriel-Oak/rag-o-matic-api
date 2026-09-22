import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { getEnv } from '../utils/env.js';
import createLoggerService from '../utils/services/logger/index.js';
import { createMcpServer } from './mcp-server.js';

const SESSION_ID_HEADER = 'mcp-session-id';

/**
 * Mounts the MCP Streamable HTTP endpoint on the SAME Fastify app, at /mcp.
 *
 * One StreamableHTTPServerTransport + one McpServer per session (MCP server
 * instances are not shared across connections). Sessions live in an in-memory
 * map keyed by the mcp-session-id header.
 */
export function mountMcp(app: FastifyInstance): void {
  const logger = createLoggerService();
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  const findSession = (
    req: FastifyRequest,
  ): { sessionId: string; transport: StreamableHTTPServerTransport } | undefined => {
    const header = req.headers[SESSION_ID_HEADER];
    if (typeof header !== 'string') return undefined;
    const transport = sessions.get(header);
    return transport ? { sessionId: header, transport } : undefined;
  };

  // The transport writes the HTTP response itself, so the Fastify reply is
  // hijacked BEFORE delegating. On unexpected error, finish the raw response.
  const handle = async (
    transport: StreamableHTTPServerTransport,
    req: FastifyRequest,
    reply: FastifyReply,
    parsedBody?: unknown,
  ): Promise<void> => {
    reply.hijack();
    try {
      await transport.handleRequest(req.raw, reply.raw, parsedBody);
    } catch (error) {
      logger.error('MCP: failed to handle request', { err: error });
      if (!reply.raw.headersSent) {
        reply.raw.statusCode = 500;
        reply.raw.setHeader('content-type', 'application/json');
        reply.raw.end(JSON.stringify({ error: 'Internal Server Error' }));
      } else {
        reply.raw.end();
      }
    }
  };

  app.post('/mcp', async (req, reply) => {
    const found = findSession(req);

    if (found) {
      await handle(found.transport, req, reply, req.body);
      return;
    }

    // New session: fresh transport + McpServer. The session id is generated
    // by the transport during the initialize request; onsessioninitialized
    // registers it in the map, onsessionclosed (DELETE) removes it.
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        sessions.set(sessionId, transport);
      },
      onsessionclosed: (sessionId) => {
        sessions.delete(sessionId);
      },
    });

    // Set BEFORE server.connect(): Protocol.connect chains (not replaces)
    // the previously assigned onclose handler.
    transport.onclose = () => {
      const sessionId = transport.sessionId;
      if (sessionId) sessions.delete(sessionId);
    };

    const env = getEnv();
    const server = createMcpServer({
      model: env.OLLAMA_EMBEDDING_MODEL,
      collection: env.QDRANT_COLLECTION,
      dimension: env.QDRANT_DIMENSION,
    });
    await server.connect(transport);

    await handle(transport, req, reply, req.body);

    // If no session was created (e.g. non-initialize request without a valid
    // session id), tear down the orphaned transport/server pair.
    if (!transport.sessionId) {
      await transport.close();
    }
  });

  app.get('/mcp', async (req, reply) => {
    const found = findSession(req);
    if (!found) {
      reply.code(404).send({ error: 'Session not found' });
      return;
    }
    // SSE stream for server-to-client messages.
    await handle(found.transport, req, reply);
  });

  app.delete('/mcp', async (req, reply) => {
    const found = findSession(req);
    if (!found) {
      reply.code(404).send({ error: 'Session not found' });
      return;
    }
    // The transport fires onsessionclosed and closes itself; the explicit
    // delete is belt-and-braces in case the hook did not run.
    await handle(found.transport, req, reply);
    sessions.delete(found.sessionId);
  });
}
