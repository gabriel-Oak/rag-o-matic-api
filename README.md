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
└── core/features/  # indexação e query de notas
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
| POST   | `/index`  | Indexa conteúdo (markdown/PDF) — chunks + embeddings persistidos no Qdrant; veja abaixo |
| GET    | `/query`  | Busca top-k de chunks similares — vetoriza via Ollama, busca no Qdrant; veja abaixo |

#### `POST /index` — indexação de conteúdo

Agnóstico de formato: recebe **markdown ou PDF** (bytes originais em
**base64** no body JSON), extrai o texto, faz chunking markdown-aware,
gera embeddings via Ollama e **persiste os pontos no Qdrant**
(collection `vault_notes`, 1024 dimensões, distância Cosine). O response
é um **resumo** da operação.

**`source` é obrigatório**: identidade do documento no índice. Re-index do
mesmo `source` sobrescreve os pontos existentes (delete-then-upsert).

Body (JSON):

| Campo                    | Tipo                 | Obrigatório | Descrição                                            |
| ------------------------ | -------------------- | ----------- | ---------------------------------------------------- |
| `type`                   | `"markdown" \| "pdf"` | sim         | Formato do conteúdo (explícito, não inferido)        |
| `content`                | string (base64)      | sim         | `base64 < nota.md>` ou `base64 < doc.pdf>`           |
| `source`                 | string               | sim         | Identidade do documento no índice (re-index sobrescreve) |
| `chunking.maxChunkChars` | int > 0              | não         | Default `1500`                                       |
| `chunking.overlapChars`  | int > 0              | não         | Default `200`; deve ser `< maxChunkChars`            |

Body limitado a 10 MB (base64 infla o payload ~33%).

Response (200):

```json
{
  "source": "nota.md",
  "type": "markdown",
  "model": "bge-m3",
  "chunkCount": 5,
  "upserted": 5
}
```

- `source` — echo do `source` enviado no request
- `model` — `OLLAMA_EMBEDDING_MODEL` do env
- `chunkCount` — chunks gerados pelo chunking
- `upserted` — pontos upsertados no Qdrant (1 por chunk)

Status codes:

| Código | Caso                                                                                       |
| ------ | ------------------------------------------------------------------------------------------ |
| `200`  | ok (resumo da indexação)                                                                   |
| `400`  | body inválido (schema) / `type` inválida / `content` não-base64 / `source` ausente / zero chunks |
| `413`  | body maior que 10 MB                                                                       |
| `422`  | extração falhou (ex.: PDF corrompido — OCR fora de escopo) OU dimension mismatch: `"embedding dimension mismatch (expected X, got Y)"` |
| `502`  | Ollama ou Qdrant falharam                                                                  |

#### `GET /query` — busca de chunks similares

Recebe a query como string no querystring, **vetoriza via Ollama**
(`bge-m3`) e busca no **Qdrant** os chunks mais similares (top-k),
retornando trechos + metadata + score. Resultados vazios → **200 com
`results: []`** (não é erro).

Querystring:

| Param   | Tipo      | Obrigatório | Descrição                       |
| ------- | --------- | ----------- | ------------------------------- |
| `q`     | string    | sim         | Texto da busca                  |
| `limit` | int 1–20  | não         | Default `5`; top-k de resultados |

Response (200):

```json
{
  "query": "notas sobre terapia",
  "count": 3,
  "results": [
    {
      "score": 0.87,
      "source": "Terapia 2026-05-20.md",
      "type": "markdown",
      "chunkIndex": 2,
      "headings": ["# Terapia 2026-05-20", "## Resumo"],
      "content": "## Resumo\n\n...",
      "indexedAt": "2026-09-24T12:00:00.000Z"
    }
  ]
}
```

- `score` — cosine do Qdrant (`[0,1]`, maior = mais similar)
- `count` — `results.length`
- **Sem `model` no response** — config ativa (model/collection/dimension)
  visível via tool MCP `health`
- Sem vector/frontmatter no response

Status codes:

| Código | Caso                                                                                       |
| ------ | ------------------------------------------------------------------------------------------ |
| `200`  | ok (inclui resultados vazios → `results: []`)                                              |
| `400`  | `q` ausente/vazio ou `limit` inválido (schema)                                            |
| `422`  | dimension mismatch do embedding: `"embedding dimension mismatch (expected X, got Y)"`     |
| `502`  | Ollama ou Qdrant falharam                                                                  |

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

`POST /index` — markdown com frontmatter Obsidian (`base64 -w 0 < nota.md`
no Linux; `base64 -i nota.md` no macOS):

```sh
curl -s -X POST http://localhost:8080/index \
  -H 'content-type: application/json' \
  -d "{
    \"type\": \"markdown\",
    \"source\": \"nota.md\",
    \"content\": \"$(base64 -w 0 < nota.md)\"
  }"
```

`POST /index` — PDF (`base64 -w 0 < doc.pdf`; macOS: `base64 -i doc.pdf`):

```sh
curl -s -X POST http://localhost:8080/index \
  -H 'content-type: application/json' \
  -d "{
    \"type\": \"pdf\",
    \"source\": \"doc.pdf\",
    \"content\": \"$(base64 -w 0 < doc.pdf)\"
  }"
```

`POST /index` — com `chunking` custom:

```sh
curl -s -X POST http://localhost:8080/index \
  -H 'content-type: application/json' \
  -d "{
    \"type\": \"markdown\",
    \"source\": \"nota.md\",
    \"content\": \"$(base64 -w 0 < nota.md)\",
    \"chunking\": { \"maxChunkChars\": 800, \"overlapChars\": 100 }
  }"
```

`GET /query` — busca top-k de chunks similares:

```sh
curl -s 'http://localhost:8080/query?q=notas+sobre+terapia&limit=3'
# {"query":"notas sobre terapia","count":3,"results":[{"score":0.87,"source":"Terapia 2026-05-20.md","type":"markdown","chunkIndex":2,"headings":["# Terapia 2026-05-20","## Resumo"],"content":"## Resumo\n\n...","indexedAt":"2026-09-24T12:00:00.000Z"}]}
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
servidor MCP com tool `health`, Docker + compose, testes, `POST /index`
(produção — persiste chunks + embeddings no Qdrant), `GET /query`
(busca top-k de chunks similares).

Backlog (próximas tasks): tools MCP de feature (index/query).
Ver nota do vault: `RAG Obsidian.md`.
