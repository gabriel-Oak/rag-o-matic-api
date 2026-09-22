# Arquitetura

## Visão Geral

API de RAG (Retrieval-Augmented Generation) sobre o vault do Obsidian. O projeto expõe duas interfaces no mesmo processo Fastify (mesma porta):

- **REST** — endpoints HTTP para consumo futuro (controllers por decorators)
- **MCP** — servidor Model Context Protocol via Streamable HTTP (SDK oficial)

O Ollama e o Qdrant são serviços externos (homelab/TrueNAS). A API é a camada de orquestração: chama Ollama para embeddings, insere/lê no Qdrant.

## Arquitetura de Pastas

```
src/
├── index.ts                    # Entry point: env → reflect-metadata → startServer
├── fastify/                    # Camada HTTP
│   ├── config.ts               # dotenv (.env)
│   ├── app.ts                  # Cria instância Fastify + registra cors, rotas, MCP
│   ├── routes.ts               # buildRoutes (controllers) + /health + catch-all 404
│   └── server.ts               # Ouve na porta (env.PORT)
└── core/
    ├── mcp/                    # Servidor MCP (Streamable HTTP)
    │   ├── mcp-server.ts       # Factory: cria McpServer + registra tools
    │   ├── mcp-transport.ts    # Mount no Fastify: POST/GET/DELETE /mcp + session map
    │   └── tools/health.ts     # Tool "health" (smoke test)
    └── utils/                  # Infraestrutura compartilhada
        ├── env.ts              # Validação de envs com zod (fail-fast)
        ├── types.ts            # Either<E, R> = Left | Right
        ├── constants.ts
        ├── errors/             # BaseError, HttpError
        │   ├── base-error.ts
        │   └── http-error.ts
        ├── controller/         # Sistema de decorators + roteamento
        │   ├── build-routes.ts
        │   ├── register-controller.ts
        │   ├── types.ts
        │   └── decorators/     # @controller, @get, @post, @put, @patch, @del
        │       ├── controller.ts
        │       ├── get.ts
        │       ├── post.ts
        │       ├── put.ts
        │       ├── patch.ts
        │       ├── del.ts
        │       └── symbols.ts
        └── services/           # Serviços externos / utilitários
            ├── ollama/         # OllamaService: embed(inputs) → vectors
            │   ├── ollama-service.ts
            │   ├── types.ts
            │   └── index.ts
            ├── qdrant/         # QdrantService: ensureCollection, upsert, query
            │   ├── qdrant-service.ts
            │   ├── types.ts
            │   └── index.ts
            ├── http-service/   # Axios wrapper (get/post → data)
            │   ├── http-service.ts
            │   ├── types.ts
            │   └── index.ts
            └── logger/         # Winston wrapper (info/warn/error/debug)
                ├── logger.ts
                ├── types.ts
                └── index.ts
```

## Padrões de Design

### Either (Result Pattern)

Todos os serviços retornam `Either<E, R>` — nunca lançam exceções.
Falhas são `Left<Error>`, sucesso é `Right<Value>`.

```ts
import { Left, Right, Either } from '@/utils/types.js';

// Uso:
const result = await ollama.embed(['texto']);
if (result.isError) {
  // result.error é OllamaError
} else {
  // result.success é number[][]
}
```

### Injeção de Dependência por Construtor

Controllers e services recebem dependências pelo construtor — facilita teste com mocks.

```ts
class OllamaService implements IOllamaService {
  constructor(
    private readonly httpService: IHttpService,
    private readonly logger: ILoggerService
  ) {}
}
```

### Controllers por Decorators

Decorators registram metadados via `reflect-metadata`. `buildRoutes` percorre os controllers, extrai os caminhos e registra rotas no Fastify.

```ts
@controller('/meu-recurso')
export default class MeuController {
  @get('/')
  async list(req, reply) {
    return { items: [] };
  }

  @post('/criar')
  async create(req, reply) {
    return { id: '123' };
  }
}
```

O path do controller é derivado automaticamente (`MeuController` → `/meu-controlador`) se `@controller()` não for explicitado. O `registerController` mapeia cada decorator HTTP para `app[method](path, handler)` com try/catch → `HttpError` + log.

### Service Factory

Cada serviço exporta um factory function (padrão `createXxxService`), igual ao `http-service/index.ts` do drink-it. Permite injetar dependências nos testes.

```ts
// src/core/utils/services/ollama/index.ts
export function createOllamaService(
  httpService: IHttpService,
  logger: ILoggerService
): IOllamaService {
  return new OllamaService(httpService, logger);
}
```

## Decisões Arquiteturais

| Decisão | Escolha | Motivo |
| --- | --- | --- |
| Módulo | **ESM** | MCP SDK é ESM-only |
| Router | Fastify + decorators | Reutiliza padrão drink-it, metadados via reflect-metadata |
| Resultado | Either/Left/Right | Erros tratados, nunca lançados (padrão drink-it datasources) |
| Injeção | Construtor | Testável, explícito |
| Logger | Winston | Padrão drink-it, transports flexíveis |
| HTTP | Axios via HttpService | Padrão drink-it, interceptors se precisar |
| Validação de env | Zod (fail-fast) | Erro legível na startup, tipado |

## Fluxo de Inicialização

```
index.ts
  ↓
dotenv (config.ts)
  ↓
reflect-metadata
  ↓
startServer()
  ↓
app = fastify()
  ├─ cors
  ├─ createRouter() → buildRoutes → registerController (decorators)
  ├─ mountMcp() → session map + POST/GET/DELETE /mcp
  └─ app.listen({ port, host })
```

## Fluxo de Requisição MCP

```
Cliente MCP
  → POST /mcp (initialize)
    → cria StreamableHTTPServerTransport novo
    → cria McpServer novo
    → server.connect(transport)
    → session id → sessions map
  → POST /mcp (tools/list, tools/call)
    → lookup session por mcp-session-id header
    → handleRequest no transport
  → GET /mcp (SSE stream)
    → session existente → transport.handleRequest (SSE)
  → DELETE /mcp
    → transport.handleRequest + sessions.delete(sessionId)
```

## Comparação com drink-it-api

| Aspecto | drink-it | rag-o-matic |
| --- | --- | --- |
| Módulo | CJS | ESM |
| TS | 4.9 | 5.x |
| Fastify | 4 | 5 |
| Testes | jest | vitest |
| ORM | TypeORM (PostgreSQL) | — |
| Cache | Redis | — |
| Auth | JWT | — (uso pessoal) |
| MCP | — | SDK oficial |
| Datasources | Per-feature | Shared services (Ollama, Qdrant) |
