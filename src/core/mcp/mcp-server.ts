import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerHealthTool } from './tools/health.js';

export interface McpServerDeps {
  model: string;
  collection: string;
  dimension: number;
}

/**
 * Creates a FRESH McpServer instance.
 *
 * MCP server instances are not shared across connections: each transport
 * (i.e. each client session) gets its own instance.
 */
export function createMcpServer(deps: McpServerDeps): McpServer {
  const server = new McpServer({ name: 'rag-o-matic', version: '1.0.0' });

  registerHealthTool(server, {
    getModel: () => deps.model,
    getCollection: () => deps.collection,
    getDimension: () => deps.dimension,
  });

  return server;
}
