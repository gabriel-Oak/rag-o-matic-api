# rag-o-matic-api

API RAG sobre o vault do Obsidian: indexação de notas + pesquisa com embeddings
(Ollama `bge-m3`) e busca vetorial (Qdrant). Duas interfaces sobre o mesmo app:
**REST** e **MCP** (Model Context Protocol, Streamable HTTP).

## Stack

- Node 22
- Fastify 5
- TypeScript (ESM, NodeNext)
- MCP SDK (`@modelcontextprotocol/sdk`)
- Qdrant client (`@qdrant/js-client-rest`)
- vitest

## Arquitetura

```
src/
├── fastify/        # app Fastify: server (listen), app (plugins), routes
├── core/
│   ├── mcp/        # servidor MCP montado em /mcp (Streamable HTTP) + tools
│   └── utils/
│       ├── services/   # ollama (embeddings), qdrant (vetores), http, logger
│       ├── controller/ # decorators (@Controller, @Get, @Post...) + build-routes
│       └── errors/     # HttpError / BaseError
└── core/features/  # (futuro) indexação e query de notas
```

Padrão **drink-it**: controllers via decorators + use cases + resultados
`Either` (sucesso/erro tipado, sem exceptions para fluxo de domínio).

## Como rodar

Pré-requisitos: **Node 22+** e um `.env` na raiz:

```sh
cp .env.example .env
```

### Dev (sem Docker para a API)

```sh
npm install
npm run dev        # tsx watch src/index.ts
```

### API em Docker

```sh
docker build -t rag-o-matic-api .
docker run --rm -p 8080:8080 \
  -e OLLAMA_URL=http://SEU_HOST:11434 \
  -e QDRANT_URL=http://SEU_HOST:6333 \
  rag-o-matic-api
```

### Dependências locais (sem TrueNAS)

Sube Ollama + Qdrant localmente:

```sh
docker compose up -d
docker compose exec ollama ollama pull bge-m3
```

Os defaults do `.env.example` já apontam para `localhost:11434` e
`localhost:6333`.

## Variáveis de ambiente

| Variável                 | Default        | Descrição                                              |
| ------------------------ | -------------- | ------------------------------------------------------ |
| `NODE_ENV`               | `development`  | `development` \| `test` \| `production`                |
| `PORT`                   | `8080`         | Porta HTTP                                             |
| `OLLAMA_URL`             | — (obrigatória) | URL do Ollama (ex.: `http://localhost:11434`)         |
| `OLLAMA_EMBEDDING_MODEL` | `bge-m3`       | Modelo de embedding                                    |
| `QDRANT_URL`             | — (obrigatória) | URL do Qdrant REST (ex.: `http://localhost:6333`)     |
| `QDRANT_API_KEY`         | — (opcional)   | API key do Qdrant (autenticação)                       |
| `QDRANT_COLLECTION`      | `vault_notes`  | Collection de vetores                                  |
| `QDRANT_DIMENSION`       | `1024`         | Dimensão dos vetores (bge-m3)                          |

## Endpoints

### REST

| Método | Rota      | Descrição                        |
| ------ | --------- | -------------------------------- |
| GET    | `/health` | Health check → `{"status":"ok"}` |

### MCP (Streamable HTTP)

`POST /mcp` (requests), `GET /mcp` (stream SSE server→client),
`DELETE /mcp` (encerra sessão). Sessão identificada pelo header
`mcp-session-id` (gerado no `initialize`).

Tool disponível:

- **`health`** — status do servidor, uptime e config RAG ativa
  (modelo de embedding, collection Qdrant, dimensão dos vetores).
  Sem argumentos.

Config de cliente MCP (Claude Desktop e compatíveis):

```json
{
  "mcpServers": {
    "rag-o-matic": {
      "url": "http://SEU_HOST:8080/mcp"
    }
  }
}
```

## Exemplos (curl)

Health:

```sh
curl -s http://localhost:8080/health
# {"status":"ok"}
```

MCP — `initialize` (responde com o header `mcp-session-id`; use-o nas
próximas chamadas):

```sh
curl -i -X POST http://localhost:8080/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-06-18",
      "capabilities": {},
      "clientInfo": { "name": "curl", "version": "0.0.0" }
    }
  }'
```

MCP — chamar a tool `health` (após `initialize` +
`notifications/initialized`, com o `mcp-session-id` da resposta):

```sh
curl -s -X POST http://localhost:8080/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H "mcp-session-id: $SESSION_ID" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": { "name": "health", "arguments": {} }
  }'
# data: {"result":{"content":[{"type":"text","text":"{\"status\":\"ok\",\"uptime\":49.3,\"config\":{\"model\":\"bge-m3\",\"collection\":\"vault_notes\",\"dimension\":1024}}"}]},"jsonrpc":"2.0","id":2}
```

## Testes / qualidade

```sh
npm test          # vitest
npm run lint      # eslint
npm run build     # tsc → dist/
```

## Status

Base pronta: app Fastify, serviços (Ollama, Qdrant, http, logger),
servidor MCP com tool `health`, Docker + compose, testes.

Backlog (próximas tasks): chunking de notas, `POST /index`, `GET /query`,
tools MCP de feature (index/query). Ver nota do vault: `RAG Obsidian.md`.
