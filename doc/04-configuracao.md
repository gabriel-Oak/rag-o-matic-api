# Configuração

## Variáveis de Ambiente

Todas validadas com zod no `src/core/utils/env.ts`. Fail-fast na startup.

| Variável | Obrigatório | Default | Tipo | Descrição |
| --- | --- | --- | --- | --- |
| `NODE_ENV` | Não | `development` | `development` \| `test` \| `production` | Ambiente de execução |
| `PORT` | Não | `8080` | number | Porta do servidor HTTP |
| `OLLAMA_URL` | **Sim** | — | URL | Endpoint do Ollama (ex: `http://192.168.1.100:11434`) |
| `OLLAMA_EMBEDDING_MODEL` | Não | `bge-m3` | string | Modelo de embedding |
| `QDRANT_URL` | **Sim** | — | URL | Endpoint do Qdrant (ex: `http://192.168.1.100:6333`) |
| `QDRANT_API_KEY` | Não | — | string | API key do Qdrant (opcional) |
| `QDRANT_COLLECTION` | Não | `vault_notes` | string | Nome da collection no Qdrant |
| `QDRANT_DIMENSION` | Não | `1024` | number | Dimensão dos vetores (deve bater com o modelo) |

### Exemplo `.env`

```bash
NODE_ENV=development
PORT=8080

OLLAMA_URL=http://192.168.1.100:11434
OLLAMA_EMBEDDING_MODEL=bge-m3

QDRANT_URL=http://192.168.1.100:6333
QDRANT_API_KEY=
QDRANT_COLLECTION=vault_notes
QDRANT_DIMENSION=1024
```

Copie de `.env.example`:

```bash
cp .env.example .env
```

## Como Rodar

### Desenvolvimento Local

```bash
# Instala dependências
npm install

# Roda em watch mode (tsx)
npm run dev
```

### Build + Produção

```bash
# Compila TypeScript
npm run build

# Roda a build
npm start
```

### Docker

**Build da imagem:**

```bash
docker build -t rag-o-matic-api .
```

**Rodar:**

```bash
docker run -d \
  --name rag-o-matic-api \
  -p 8080:8080 \
  --env-file .env \
  rag-o-matic-api
```

**Dockerfile multi-stage:**

```
Stage 1 (builder): node:22-alpine → npm ci → tsc → dist/
Stage 2 (runtime): node:22-alpine → npm ci --omit=dev → dist/ → CMD ["node", "dist/index.js"]
```

- Usuário não-root (`USER node`)
- `npm ci --ignore-scripts` no runtime (esbuild/fsevents são devDep, não precisam de postinstall)
- Husky no builder: `npm ci` com scripts (esbuild precisa postinstall para o plugin esbuild)

### Docker Compose (Dev — Ollama + Qdrant local)

```bash
docker compose up -d
```

Services:
- `ollama` — imagem `ollama/ollama`, porta 11434, volume para modelos
- `qdrant` — imagem `qdrant/qdrant`, portas 6333 (REST) + 6334 (gRPC), volume para dados

**Puxar modelo bge-m3:**

```bash
docker compose exec ollama ollama pull bge-m3
```

## Configuração de Cliente MCP

### Claude Desktop

Edite `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "rag-o-matic": {
      "url": "http://SEU_HOMELAB_IP:8080/mcp"
    }
  }
}
```

### mcp-inspector (CLI)

```bash
npx @modelcontextprotocol/inspector
# Insira: http://SEU_HOMELAB_IP:8080/mcp
```

### Curl (teste manual)

```bash
# Initialize
curl -X POST localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-06-18",
      "capabilities": {},
      "clientInfo": { "name": "test", "version": "1.0.0" }
    }
  }'
```

A resposta conterá `mcp-session-id` no header. Use-o em requisições subsequentes.

## Configuração de Linter

### ESLint (flat config)

`.eslintrc` → `eslint.config.js` (ESLint 9+):

```js
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'tmp', 'coverage', 'node_modules'] },
  ...tseslint.configs.recommended
);
```

### Husky + lint-staged

`.husky/pre-commit`:

```bash
npm run lint-staged
```

`.lintstagedrc.json`:

```json
{
  "*.ts": ["eslint --fix"]
}
```

## Configuração de Build

### tsconfig.json

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
  "exclude": ["jest.config.js", "coverage/", "**/*.test.ts"]
}
```

**`useDefineForClassFields: false`** — obrigatório quando `emitDecoratorMetadata` está ativo. Sem isso, o metadata de decorators é gerado incorretamente (TS 5+ muda o default).

## Configuração do Vitest

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

Testes são ignorados do `tsconfig.json` (excluídos do build).
