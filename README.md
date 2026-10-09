# rag-o-matic-api

API RAG sobre o vault do Obsidian: indexação de notas + busca **híbrida**
(embedding denso via Ollama `bge-m3` + sparse TF próprio, fusão RRF) no
Qdrant. Duas interfaces sobre o mesmo app: **REST** e **MCP** (Model
Context Protocol, Streamable HTTP).

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
| `QDRANT_COLLECTION`      | `vault_notes`  | Collection de vetores (dense + sparse v2)              |
| `QDRANT_DIMENSION`       | `1024`         | Dimensão dos vetores (bge-m3)                          |

> **Coleção v2 (dense + sparse)**: o app cria a coleção com
> `sparse_vectors.text` (float32, modifier `idf`). Se a coleção **já
> existir sem** essa config, o app falha com erro claro — `collection
> ... exists without sparse config — rename QDRANT_COLLECTION or drop
> it` (a config é imutável; o app não tenta mutar). Após upgrade, use um
> nome de coleção novo (ex.: `obsidian_vault_v2`) e reindexe — reindex
> completo via `POST /index` por source.

## Endpoints

### REST

| Método | Rota      | Descrição                        |
| ------ | --------- | -------------------------------- |
| GET    | `/health` | Health check → `{"status":"ok"}` |
| POST   | `/index`  | Indexa conteúdo (markdown/PDF) — chunks + embeddings persistidos no Qdrant; veja abaixo |
| GET    | `/query`  | Busca top-k de chunks similares — vetoriza via Ollama, busca no Qdrant; veja abaixo |
| DELETE | `/index/:source` | Remove todos os chunks de um `source` — idempotente; veja abaixo |

#### `POST /index` — indexação de conteúdo

Agnóstico de formato: recebe **markdown ou PDF** (bytes originais em
**base64** no body JSON), extrai o texto, faz chunking markdown-aware
(fences `dataview`/`dataviewjs` são pulados; prefixo de contexto do
chunk = source + máx. 2 headings, trail completo no payload
`headings`), gera embedding denso via Ollama + sparse vector próprio
(unigramas+bigramas, hash FNV-1a) e **persiste os pontos no Qdrant**
(dense 1024 dimensões, distância Cosine + sparse `text` com modifier
IDF). Nota com frontmatter ganha um **chunk 0 dedicado `## Metadados`**
(payload `type: "metadata"`, conteúdo = source + YAML cru) —
telefone/aniversário/IDs ficam indexados; demais chunks mantêm
`type: "markdown" | "pdf"`. O response é um **resumo** da operação.

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
- `chunkCount` — chunks gerados (inclui o chunk de metadados, quando a
  nota tem frontmatter)
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

Recebe a query como string no querystring e roda **busca híbrida**:
embedding denso via Ollama (`bge-m3`) + sparse TF próprio
(unigramas+bigramas, hash FNV-1a, modifier IDF no Qdrant), com fusão
**RRF** no Qdrant. Retorna os chunks mais relevantes (top-k) com
trechos + metadata + score. Resultados vazios → **200 com `results:
[]`** (não é erro).

Querystring:

| Param   | Tipo      | Obrigatório | Descrição                       |
| ------- | --------- | ----------- | ------------------------------- |
| `q`     | string    | sim         | Texto da busca                  |
| `limit` | int 1–20  | não         | Default `5`; top-k de resultados |
| `sourcePrefix` | string | não | Restringe a busca a sources sob um prefixo de pasta (ex.: `Pessoas/`) |

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
      "indexedAt": "2026-09-24T12:00:00.000Z",
      "frontmatter": "tags: [terapia]\ndata: 2026-05-20"
    }
  ]
}
```

- `score` — RRF (Reciprocal Rank Fusion) da busca híbrida (`~[0,1]`,
  maior = mais relevante; **não** é cosine)
- `count` — `results.length`
- `frontmatter` — YAML cru da nota, presente apenas quando a nota tem
  frontmatter
- **Sem `model` no response** — config ativa (model/collection/dimension)
  visível via tool MCP `health`
- Sem vector no response (o `frontmatter` aparece quando presente)

Status codes:

| Código | Caso                                                                                       |
| ------ | ------------------------------------------------------------------------------------------ |
| `200`  | ok (inclui resultados vazios → `results: []`)                                              |
| `400`  | `q` ausente/vazio ou `limit` inválido (schema)                                            |
| `422`  | dimension mismatch do embedding: `"embedding dimension mismatch (expected X, got Y)"`     |
| `502`  | Ollama ou Qdrant falharam                                                                  |

#### `DELETE /index/:source` — remover source

Remove **todos os chunks** indexados sob o `source` do Qdrant
(filter exato por `source`). **Idempotente**: `source` inexistente →
`200` com `deleted: 0` (sem 404).

Path param:

| Param    | Tipo   | Obrigatório | Descrição                          |
| -------- | ------ | ----------- | ---------------------------------- |
| `source` | string | sim         | Identidade do documento no índice  |

Response (200):

```json
{
  "source": "nota.md",
  "deleted": 12
}
```

- `source` — echo do `source` do path
- `deleted` — pontos removidos do Qdrant (`0` se o `source` não existe)

Status codes:

| Código | Caso                                                 |
| ------ | ---------------------------------------------------- |
| `200`  | ok (inclui `source` inexistente → `deleted: 0`)     |
| `502`  | Qdrant falhou (count ou delete)                      |

### MCP (Streamable HTTP)

`POST /mcp` (requests), `GET /mcp` (stream SSE server→client),
`DELETE /mcp` (encerra sessão). Sessão identificada pelo header
`mcp-session-id` (gerado no `initialize`).

Tools disponíveis:

- **`health`** — status do servidor, uptime e config RAG ativa
  (modelo de embedding, collection Qdrant, dimensão dos vetores).
  Sem argumentos.
- **`index_content`** — indexa documento (markdown ou PDF) no vector
  store; re-index do mesmo `source` sobrescreve os chunks anteriores.
  Args: `type` (`"markdown" | "pdf"`), `content` (base64 dos bytes),
  `source`, `chunking?`.
- **`index_markdown`** — indexa **texto markdown puro** (sem base64),
  frontmatter YAML opcional no topo. Args: `content` (texto), `source`,
  `chunking?`. Use para markdown em texto puro; `index_content` para
  PDF/binário.
- **`query`** — busca híbrida top-k (embed denso via Ollama + sparse TF
  próprio, fusão RRF no Qdrant); resultado vazio não é erro. Hits podem
  incluir `frontmatter` (YAML cru da nota). Args: `q`, `limit?` (1–20,
  default `5`), `sourcePrefix?` (ex.: `"Pessoas/"` — restringe a busca a
  sources sob o prefixo).
- **`list_sources`** — lista sources indexados (notas/PDFs) com
  contagem de chunks. Args: `prefix?` (ex.: `"Projetos/"` — filtra por
  pasta). Use para perguntas de "o que existe" / "liste X"; depois use
  `query` para o conteúdo.
- **`delete_content`** — remove todos os chunks indexados sob um
  `source` do vector store; idempotente (source inexistente →
  `deleted: 0`). Args: `source`.

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

`GET /query` — busca híbrida top-k (score = RRF; `sourcePrefix`
opcional restringe a busca por pasta):

```sh
curl -s 'http://localhost:8080/query?q=notas+sobre+terapia&limit=3'
# {"query":"notas sobre terapia","count":3,"results":[{"score":0.87,"source":"Terapia 2026-05-20.md","type":"markdown","chunkIndex":2,"headings":["# Terapia 2026-05-20","## Resumo"],"content":"## Resumo\n\n...","indexedAt":"2026-09-24T12:00:00.000Z","frontmatter":"tags: [terapia]"}]}
```

`DELETE /index/:source` — remove todos os chunks de um source
(idempotente — source inexistente → `deleted: 0`):

```sh
curl -s -X DELETE http://localhost:8080/index/nota.md
# {"source":"nota.md","deleted":12}
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

MCP — `tools/list` (mesma sessão):

```sh
curl -s -X POST http://localhost:8080/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H "mcp-session-id: $SESSION_ID" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/list",
    "params": {}
  }'
```

MCP — `tools/call index_markdown` (texto puro — sem converter para
base64):

```sh
curl -s -X POST http://localhost:8080/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H "mcp-session-id: $SESSION_ID" \
  -d '{
    "jsonrpc": "2.0",
    "id": 4,
    "method": "tools/call",
    "params": {
      "name": "index_markdown",
      "arguments": {
        "content": "---\ntags: [terapia]\n---\n\n# Terapia\n\nConteúdo da nota.",
        "source": "nota.md"
      }
    }
  }'
```

MCP — `tools/call query`:

```sh
curl -s -X POST http://localhost:8080/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H "mcp-session-id: $SESSION_ID" \
  -d '{
    "jsonrpc": "2.0",
    "id": 5,
    "method": "tools/call",
    "params": {
      "name": "query",
      "arguments": { "q": "notas sobre terapia", "limit": 3 }
    }
  }'
```

MCP — `tools/call list_sources`:

```sh
curl -s -X POST http://localhost:8080/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H "mcp-session-id: $SESSION_ID" \
  -d '{
    "jsonrpc": "2.0",
    "id": 6,
    "method": "tools/call",
    "params": {
      "name": "list_sources",
      "arguments": { "prefix": "Projetos/" }
    }
  }'
```

MCP — `tools/call delete_content`:

```sh
curl -s -X POST http://localhost:8080/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H "mcp-session-id: $SESSION_ID" \
  -d '{
    "jsonrpc": "2.0",
    "id": 7,
    "method": "tools/call",
    "params": {
      "name": "delete_content",
      "arguments": { "source": "nota.md" }
    }
  }'
```

## Testes / qualidade

```sh
npm test          # vitest
npm run lint      # eslint
npm run build     # tsc → dist/
```

## Status

Base pronta: app Fastify, serviços (Ollama, Qdrant, http, logger),
servidor MCP com 6 tools (`health`, `index_content`, `index_markdown`,
`query`, `list_sources`, `delete_content`), Docker + compose, testes,
`POST /index` (produção — persiste chunks dense + sparse no Qdrant),
`GET /query` (busca híbrida top-k, fusão RRF), `DELETE /index/:source`
(remove todos os chunks de um source — idempotente).

Ver nota do vault: `RAG Obsidian.md`.
