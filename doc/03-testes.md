# Testes

## Estrutura

Cada arquivo de código tem o teste correspondente ao lado:

```
src/
├── core/
│   ├── mcp/
│   │   ├── mcp-server.test.ts      # InMemoryTransport + Client
│   │   └── mcp-transport.test.ts   # Fastify app.inject (POST/GET/DELETE /mcp)
│   └── utils/
│       ├── errors/
│       │   └── http-error.test.ts  # HttpError defaults, statusCode, meta
│       ├── controller/
│       │   └── register-controller.test.ts  # decorators fake + app.inject
│       └── services/
│           ├── ollama/
│           │   └── ollama-service.test.ts  # fake IHttpService
│           ├── qdrant/
│           │   └── qdrant-service.test.ts  # fake QdrantClient
│           └── http-service/
│               └── http-service.test.ts    # fake axios client
└── fastify/
    └── app.test.ts                 # GET /health, 404 HttpError
```

## Configuração

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import esbuildLegacyDecorators from './esbuildLegacyDecorators'; // ver código

export default defineConfig({
  plugins: [esbuildLegacyDecorators()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

### Plugin esbuildLegacyDecorators

Vite 8 usa oxc por padrão, que não suporta `experimentalDecorators` (legacy decorators). O plugin compila `.ts` com esbuild antes do oxc ver o código:

```ts
function esbuildLegacyDecorators(): Plugin {
  return {
    name: "esbuild-legacy-decorators",
    enforce: "pre",
    async transform(code, id) {
      if (id.includes("node_modules") || !/\.(ts|tsx)$/.test(id)) return;
      const result = await esbuild.transform(code, {
        loader: id.endsWith(".tsx") ? "tsx" : "ts",
        tsconfigRaw: tsconfigRawContent,
        sourcemap: true,
      });
      return { code: result.code, map: result.map };
    },
  };
}
```

## Padrões de Teste

### Fake Services (injeção)

Services que dependem de `IHttpService` ou `QdrantClient` recebem um fake via construtor:

```ts
// ollama-service.test.ts
const fakeHttpService = {
  get: vi.fn(),
  post: vi.fn().mockResolvedValue({ embeddings: [[0.1, 0.2, ...]] }),
} as unknown as IHttpService;
```

### Stubbing env

Para testar com valores controlados de env, usa `vi.mock` (mesmo padrão dos testes de `env.ts`):

```ts
vi.mock("../../env.js", () => ({
  getEnv: () => ({
    OLLAMA_URL: "http://fake:11434",
    OLLAMA_EMBEDDING_MODEL: "bge-m3",
    // ...
  }),
}));
```

### Fastify app.inject

Para testar rotas sem iniciar um servidor real:

```ts
import app from "./app.js";

const res = await app.inject({
  method: "GET",
  url: "/health",
});
expect(res.statusCode).toBe(200);
expect(JSON.parse(res.payload)).toEqual({ status: "ok" });
```

### MCP InMemoryTransport

Para testar o `McpServer` sem HTTP real, usa o par `InMemoryTransport` do SDK:

```ts
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const server = createMcpServer({ model: 'bge-m3', collection: 'vault_notes', dimension: 1024 });
await server.connect(serverTransport);
const client = new Client({ name: 'test', version: '1.0.0' });
await client.connect(clientTransport);

const tools = await client.listTools();
expect(tools.tools).toHaveLength(1);
expect(tools.tools[0].name).toBe('health');
```

### HTTP-level com app.inject

Para testar o transporte MCP montado no Fastify, usa `app.inject` (funciona com `reply.hijack` no light-my-request):

```ts
const res = await app.inject({
  method: "POST",
  url: "/mcp",
  headers: {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  },
  payload: {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0.0" },
    },
  },
});
// res.payload contém "data: {...}" (SSE-framed)
```

## Cobertura Atual

| Módulo | Arquivos de teste | Testes |
| --- | --- | --- |
| Errors | `http-error.test.ts` | 12 |
| Controller | `register-controller.test.ts` | 7 |
| Logger | (stub test) | — |
| HttpService | `http-service.test.ts` | 7 |
| Ollama | `ollama-service.test.ts` | 7 |
| Qdrant | `qdrant-service.test.ts` | 13 |
| MCP | `mcp-server.test.ts` + `mcp-transport.test.ts` | 4 |
| Fastify | `app.test.ts` | 2 |
| **Total** | **9** | **52** |

## Execução

```bash
# Roda todos os testes
npm test

# Watch mode
npm run tdd

# Com cobertura
npm run coverage
```

## Teste Manual (Smoke)

Após build + deploy:

```bash
# Health
curl localhost:8080/health

# 404
curl localhost:8080/does-not-exist

# MCP initialize
curl -X POST localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}'

# MCP tools/list (com session id da response anterior)
curl -X POST localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -H "Mcp-Session-Id: <session-id>" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

# MCP tools/call health
curl -X POST localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -H "Mcp-Session-Id: <session-id>" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"health"}}'
```
