import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type IndexContentUsecase from '../features/index/usecases/index-content-usecase.js';
import type QueryContentUsecase from '../features/query/usecases/query-content-usecase.js';
import { registerHealthTool } from './tools/health.js';
import { registerIndexContentTool } from './tools/index-content.js';
import { registerIndexMarkdownTool } from './tools/index-markdown.js';
import { registerQueryTool } from './tools/query.js';

export interface McpServerDeps {
  model: string;
  collection: string;
  dimension: number;
  indexContent: IndexContentUsecase;
  queryContent: QueryContentUsecase;
}

/**
 * Creates a FRESH McpServer instance.
 *
 * MCP server instances are not shared across connections: each transport
 * (i.e. each client session) gets its own instance. The usecases are shared
 * (stateless) and passed in by the transport.
 */
export function createMcpServer(deps: McpServerDeps): McpServer {
  const server = new McpServer({ name: 'rag-o-matic', version: '1.0.0' });

  registerHealthTool(server, {
    getModel: () => deps.model,
    getCollection: () => deps.collection,
    getDimension: () => deps.dimension,
  });

  registerIndexContentTool(server, { indexContent: deps.indexContent });
  registerIndexMarkdownTool(server, { indexContent: deps.indexContent });
  registerQueryTool(server, { queryContent: deps.queryContent });

  return server;
}
