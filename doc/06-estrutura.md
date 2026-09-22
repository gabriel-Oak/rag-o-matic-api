# Estrutura de Arquivos

## Visão Geral

```
rag-o-matic-api/
├── .dockerignore
├── .editorconfig
├── .env.example
├── .eslintrc.json
├── .gitignore
├── .husky/pre-commit
├── .lintstagedrc.json
├── Dockerfile
├── docker-compose.yml
├── eslint.config.js
├── package.json
├── package-lock.json
├── README.md
├── tsconfig.json
├── vitest.config.ts
├── tmp/                    # Gitignored — outputs de smoke tests
│   └── smoke-21-09-2026.md
├── doc/                    # Documentação (este arquivo)
│   ├── 01-arquitetura.md
│   ├── 02-dependencias.md
│   ├── 03-testes.md
│   ├── 04-configuracao.md
│   ├── 05-api.md
│   └── 06-estrutura.md
└── src/
    ├── index.ts            # Entry point
    ├── scaffold.test.ts    # Placeholder
    ├── core/
    │   ├── mcp/
    │   │   ├── mcp-server.ts
    │   │   ├── mcp-transport.ts
    │   │   ├── tools/
    │   │   │   └── health.ts
    │   │   ├── mcp-server.test.ts
    │   │   └── mcp-transport.test.ts
    │   └── utils/
    │       ├── env.ts
    │       ├── env.test.ts
    │       ├── types.ts
    │       ├── constants.ts
    │       ├── errors/
    │       │   ├── base-error.ts
    │       │   ├── http-error.ts
    │       │   └── http-error.test.ts
    │       ├── controller/
    │       │   ├── build-routes.ts
    │       │   ├── register-controller.ts
    │       │   ├── register-controller.test.ts
    │       │   ├── types.ts
    │       │   └── decorators/
    │       │       ├── controller.ts
    │       │       ├── get.ts
    │       │       ├── post.ts
    │       │       ├── put.ts
    │       │       ├── patch.ts
    │       │       ├── del.ts
    │       │       └── symbols.ts
    │       └── services/
    │           ├── ollama/
    │           │   ├── ollama-service.ts
    │           │   ├── ollama-service.test.ts
    │           │   ├── types.ts
    │           │   └── index.ts
    │           ├── qdrant/
    │           │   ├── qdrant-service.ts
    │           │   ├── qdrant-service.test.ts
    │           │   ├── types.ts
    │           │   └── index.ts
    │           ├── http-service/
    │           │   ├── http-service.ts
    │           │   ├── http-service.test.ts
    │           │   ├── types.ts
    │           │   └── index.ts
    │           └── logger/
    │               ├── logger.ts
    │               ├── logger.test.ts
    │               ├── types.ts
    │               └── index.ts
    └── fastify/
        ├── config.ts
        ├── app.ts
        ├── app.test.ts
        ├── routes.ts
        ├── server.ts
        └── server.test.ts
```

## Arquivos de Raiz

### `.dockerignore`

Exclusões do Docker: `node_modules`, `dist`, `.env`, `tmp`, `.plans`, `coverage`, `.git`, `.husky`, `docker-compose.yml`, `Dockerfile`.

### `.editorconfig`

Padrão de formatação: 2 spaces, LF, UTF-8, trim trailing whitespace, max_line_length = 120.

### `.env.example`

Template de variáveis de ambiente (exato ao schema de `env.ts`).

### `.eslintrc.json`

Config ESLint flat: `typescript-eslint` recommended, ignora `dist`, `tmp`, `coverage`, `node_modules`.

### `.husky/pre-commit`

Executa `npm run lint-staged` antes de cada commit.

### `.lintstagedrc.json`

```json
{
  "*.ts": ["eslint --fix"]
}
```

### `.gitignore`

```
.plans
.plans/
.env
tmp/
node_modules/
dist/
coverage/
```

### `Dockerfile`

Multi-stage:
1. **builder**: `node:22-alpine` → `npm ci` → `tsc` → `dist/`
2. **runtime**: `node:22-alpine` → `npm ci --omit=dev --ignore-scripts` → copia `dist/` → `CMD ["node", "dist/index.js"]`
   - `USER node` (não-root)
   - `EXPOSE 8080`

### `docker-compose.yml`

Services de dev:
- `ollama`: `ollama/ollama`, porta 11434, volume para modelos
- `qdrant`: `qdrant/qdrant`, portas 6333/6334, volume para dados

### `eslint.config.js`

Flat config ESLint 10+ com `typescript-eslint`.

### `package.json`

Scripts: `dev`, `build`, `start`, `test`, `tdd`, `coverage`, `lint`, `lint-staged`, `prepare`.
`"type": "module"`.

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "useDefineForClassFields": false,
    "rootDir": "src",
    "outDir": "dist",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "exclude": ["**/*.test.ts"]
}
```

### `vitest.config.ts`

Node environment, includes `src/**/*.test.ts`, plugin esbuild para legacy decorators.

## src/

### `index.ts`

Entry point: carrega `.env` → importa `reflect-metadata` → inicia `startServer()`.
Trata erros de startup com logger.

### `scaffold.test.ts`

Teste placeholder (`expect(1+1).toBe(2)`). Mantido para `npm test` passar no scaffold.

### `core/mcp/`

#### `mcp-server.ts`

Factory `createMcpServer({ model, collection, dimension })`.
Cria `McpServer` com nome `rag-o-matic`, versão `1.0.0`.
Registra a tool `health`.

#### `mcp-transport.ts`

Mount no Fastify: `POST/GET/DELETE /mcp`.
Session map: `Map<sessionId, StreamableHTTPServerTransport>`.
`reply.hijack()` antes de `transport.handleRequest()`.
`onsessioninitialized`/`onsessionclosed` para lifecycle.

#### `tools/health.ts`

Registra tool `health` com `inputSchema: {}` (sem argumentos).
Retorna JSON com `status`, `uptime`, `config` (model, collection, dimension).

#### `mcp-server.test.ts`

Teste via `InMemoryTransport.createLinkedPair()` + `Client`.
Verifica `listTools()`, `callTool('health')`.

#### `mcp-transport.test.ts`

Teste via `app.inject()` (Fastify).
Verifica `initialize` → session id → `tools/list` → `tools/call`.

### `core/utils/`

#### `env.ts`

Schema zod com 8 campos. `loadEnv()` faz `safeParse` e lança `Error` legível com todos os campos inválidos. `getEnv()` é memoizado (singleton).

#### `env.test.ts`

11 testes: validação completa, defaults, coercion, empty key, missing required, invalid number, multi-field error, bad NODE_ENV, memoization.

#### `types.ts`

`Either<E, R>` = `Left<E>` | `Right<R>`.
Classes com `isError` flag, `.error` / `.success`.

#### `constants.ts`

Constantes do projeto (sem uso ativo na base — reservado para features).

#### `errors/base-error.ts`

Classe base: `message`, `meta`, `type`.

#### `errors/http-error.ts`

`HttpError` extends `BaseError`.
`statusCode` (default 500), `type = 'http-error'`.
`meta` apenas fora de production.
`toString()` com statusCode + meta.

#### `errors/http-error.test.ts`

12 testes: defaults, custom statusCode, meta present/absent, toString format, BaseError passthrough.

### `core/utils/controller/`

#### `build-routes.ts`

Itera controllers factory, deriva path do `@controller()` metadata ou class-name (kebab-case), chama `registerController()`.

#### `register-controller.ts`

Para cada decorator HTTP, registra `app[method](path, handler)`.
Handler: try/catch → `HttpError` + logger.
Sem auth/JWT (removido da base).

#### `register-controller.test.ts`

7 testes: `@controller` + `@get` → 200, `@post` → 200, subpath '/', class-name fallback, throwing handler → 500, async rejection → 500.

#### `types.ts`

`controllerAction`, `IControllerActionMeta`, `ICreateController`.

#### `decorators/*.ts`

Cada decorator (`@controller`, `@get`, `@post`, `@put`, `@patch`, `@del`) usa `reflect-metadata` para registrar metadados no target.

#### `symbols.ts`

Symbols: `SYMBOL_CONTROLLER`, `SYMBOL_GET`, `SYMBOL_POST`, `SYMBOL_PUT`, `SYMBOL_PATCH`, `SYMBOL_DELETE`, `SYMBOL_PRIVATE` (removido, mas mantido no arquivo como placeholder).

### `core/utils/services/`

#### `ollama/`

- `types.ts`: `OllamaError`, `EmbedResponse`, `IOllamaService`
- `ollama-service.ts`: `embed(inputs) → post /api/embed` → valida response → `Either`
- `index.ts`: factory `createOllamaService(httpService, logger)`
- `ollama-service.test.ts`: 7 testes (single, batch, network error, malformed response)

#### `qdrant/`

- `types.ts`: `QdrantError`, `QdrantPoint`, `QdrantSearchHit`, `IQdrantService`
- `qdrant-service.ts`: `ensureCollection`, `upsertPoints`, `queryPoints`, `close` — injeta `QdrantClient` nos testes
- `index.ts`: factory `createQdrantService(logger, client?)`
- `qdrant-service.test.ts`: 13 testes (ensureCollection exists/not-found/other-error, upsert success/error, query success/error, constructor env url)

#### `http-service/`

- `types.ts`: `IHttpService` (get/post → `data`)
- `http-service.ts`: `Axios` wrapper
- `index.ts`: factory `createHttpService(client?)`
- `http-service.test.ts`: fake client, get/post, error propagation

#### `logger/`

- `types.ts`: `ILoggerService` (info/warn/error/debug)
- `logger.ts`: Winston wrapper, console transport em dev
- `index.ts`: factory `createLoggerService()`
- `logger.test.ts`: shape, no-throw, memoized

### `fastify/`

#### `config.ts`

`dotenv` — carrega `.env`.

#### `app.ts`

Cria `fastify()`, registra `@fastify/cors`, `createRouter()`, `mountMcp()`.
Comentário: `// services will be wired here (later task)`.

#### `app.test.ts`

2 testes: `GET /health` → 200, `GET /nope` → 404 HttpError.

#### `routes.ts`

`buildRoutes(app, [])` (vazio na base), `GET /health`, catch-all 404.

#### `server.ts`

`startServer()`: `app.listen({ port, host: '0.0.0.0' })`, log.

#### `server.test.ts`

Teste de server start (mock `app.listen`).

## Arquivos de Teste — Resumo

| Arquivo | Testes | O que testa |
| --- | --- | --- |
| `scaffold.test.ts` | 1 | `expect(1+1).toBe(2)` |
| `fastify/app.test.ts` | 2 | health 200, 404 |
| `core/utils/errors/http-error.test.ts` | 12 | HttpError defaults, statusCode, meta |
| `core/utils/env.test.ts` | 11 | Zod schema, defaults, coercion, errors |
| `core/utils/controller/register-controller.test.ts` | 7 | Decorators, path derivation, error handling |
| `core/utils/services/http-service/http-service.test.ts` | 7 | Fake axios client, get/post, error |
| `core/utils/services/logger/logger.test.ts` | 1 | Shape, no-throw |
| `core/utils/services/ollama/ollama-service.test.ts` | 7 | Fake http, success, batch, network error, malformed |
| `core/utils/services/qdrant/qdrant-service.test.ts` | 13 | Fake client, ensureCollection, upsert, query |
| `core/mcp/mcp-server.test.ts` | 2 | InMemoryTransport, listTools, callTool |
| `core/mcp/mcp-transport.test.ts` | 2 | app.inject, initialize, tools/list, dead session |
| **Total** | **63** | |
