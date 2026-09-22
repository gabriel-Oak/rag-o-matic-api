# API Reference

A API expõe dois endpoints no mesmo servidor Fastify (mesma porta):

- `GET /health` — saúde da API (REST)
- `/mcp` — servidor MCP (Streamable HTTP)

## REST

### GET /health

Retorna status de saúde da API.

**Request:**

```
GET /health
```

**Response 200:**

```json
{
  "status": "ok"
}
```

**Exemplo curl:**

```bash
curl localhost:8080/health
# → {"status":"ok"}
```

---

### Catch-all 404

Rotas inexistentes retornam `HttpError` 404.

**Response 404:**

```json
{
  "statusCode": 404,
  "error": "Not Found",
  "message": "Error, looks like the route you are looking for has been removed or doesn't exists",
  "meta": "<url da rota>"
}
```

**Exemplo curl:**

```bash
curl localhost:8080/does-not-exist
# → {"statusCode":404,"error":"Not Found","message":"Error, looks like the route you are looking for has been removed or doesn't exists","meta":"/does-not-exist"}
```

## MCP (Model Context Protocol)

### Endpoint: `/mcp`

Protocolo MCP sobre HTTP via `StreamableHTTPServerTransport` (SDK `@modelcontextprotocol/sdk` v1.30.0).

**Headers:**
- `Content-Type: application/json`
- `Accept: application/json, text/event-stream`
- `Mcp-Session-Id: <session-id>` (após initialize)

### POST /mcp — Inicialização + Requests

Cria uma nova sessão se `Mcp-Session-Id` não estiver presente. Já cria um `McpServer` novo + `StreamableHTTPServerTransport` novo por sessão.

**Request (initialize):**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-06-18",
    "capabilities": {},
    "clientInfo": {
      "name": "minha-app",
      "version": "1.0.0"
    }
  }
}
```

**Response 200 (SSE-framed):**

```
HTTP/1.1 200 OK
Mcp-Session-Id: e9b6b634-646e-4140-8c61-6d2b250de81c
Content-Type: text/event-stream

data: {"jsonrpc":"2.0","result":{"protocolVersion":"2025-06-18","serverInfo":{"name":"rag-o-matic","version":"1.0.0"},"capabilities":{}},"id":1}
```

**Response 202 (notifications/initialized):**

```
HTTP/1.1 202 Accepted
Mcp-Session-Id: e9b6b634-646e-4140-8c61-6d2b250de81c
Content-Type: text/event-stream

data: {"jsonrpc":"2.0","method":"notifications/initialized"}
```

### POST /mcp — tools/list

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list",
  "params": {}
}
```

**Response:**

```json
{
  "jsonrpc": "2.0",
  "result": {
    "tools": [
      {
        "name": "health",
        "description": "Server health: status, uptime and RAG config (embedding model, Qdrant collection, vector dimension). No arguments.",
        "inputSchema": {}
      }
    ]
  },
  "id": 2
}
```

### POST /mcp — tools/call (health)

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "health",
    "arguments": {}
  }
}
```

**Response:**

```json
{
  "jsonrpc": "2.0",
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"status\":\"ok\",\"uptime\":123.456,\"config\":{\"model\":\"bge-m3\",\"collection\":\"vault_notes\",\"dimension\":1024}}"
      }
    ]
  },
  "id": 3
}
```

### GET /mcp — SSE Stream

Retorna stream SSE para notificações do servidor (server-to-client). Requer `Mcp-Session-Id` válido.

**Response 200:**

```
HTTP/1.1 200 OK
Mcp-Session-Id: e9b6b634-646e-4140-8c61-6d2b250de81c
Content-Type: text/event-stream

data: {"jsonrpc":"2.0","method":"notifications/..."}
```

### DELETE /mcp — Encerrar Sessão

```json
{
  "jsonrpc": "2.0",
  "method": "session/terminate",
  "params": {}
}
```

Encerra a sessão e remove do session map. Requisições subsequentes com o mesmo `Mcp-Session-Id` retornam erro.

**Response 400 (sessão morta):**

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32000,
    "message": "Bad Request: Server not initialized"
  }
}
```

## Fluxo Completo MCP

```
1. POST /mcp (initialize)          → 200 + Mcp-Session-Id
2. POST /mcp (tools/list)          → 200 (com session header)
3. POST /mcp (tools/call health)   → 200
4. DELETE /mcp (session/terminate) → 200
5. POST /mcp (tools/list, old id)  → 400 (session not initialized)
```

## Tool: health

| Propriedade | Valor |
| --- | --- |
| Nome | `health` |
| Descrição | Server health: status, uptime and RAG config |
| Input Schema | `{}` (sem argumentos) |
| Output | JSON com `status`, `uptime` (segundos), `config` ({ model, collection, dimension }) |

## Controllers (futuro)

O sistema de decorators está pronto para receber features. Quando implementadas, seguirão o padrão:

```ts
@controller('/recurso')
export default class RecursoController {
  @get('/')
  async list(req, reply) { /* ... */ }

  @post('/')
  async create(req, reply) { /* ... */ }

  @get('/:id')
  async get(req, reply) { /* ... */ }

  @patch('/:id')
  async update(req, reply) { /* ... */ }

  @delete('/:id')
  async remove(req, reply) { /* ... */ }
}
```

Os controllers são registrados via `buildRoutes(app, [RecursoController])` em `routes.ts`.

## HTTP Error Format

Todos os erros seguem o formato `HttpError`:

```json
{
  "statusCode": 404,
  "error": "Not Found",
  "message": "Error message here",
  "meta": { /* optional, only in non-production */ }
}
```

- `statusCode`: 400, 404, 500, etc.
- `message`: descrição legível
- `meta`: detalhes técnicos (apenas `NODE_ENV !== 'production'`)
