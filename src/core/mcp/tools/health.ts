import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export interface HealthToolDeps {
  getModel(): string;
  getCollection(): string;
  getDimension(): number;
}

export function registerHealthTool(server: McpServer, deps: HealthToolDeps): void {
  server.registerTool(
    'health',
    {
      title: 'Health',
      description:
        'Server health: status, uptime and RAG config (embedding model, Qdrant collection, vector dimension). No arguments.',
      inputSchema: {},
    },
    async () => {
      const payload = {
        status: 'ok',
        uptime: process.uptime(),
        config: {
          model: deps.getModel(),
          collection: deps.getCollection(),
          dimension: deps.getDimension(),
        },
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(payload) }],
      };
    },
  );
}
