# Dependências

## Runtime (dependencies)

| Pacote | Versão | Uso |
| --- | --- | --- |
| `fastify` | `^5.12.5` | Web framework — HTTP + MCP no mesmo servidor |
| `@fastify/cors` | `^11.3.0` | Middleware CORS |
| `@modelcontextprotocol/sdk` | `^1.30.0` | SDK oficial MCP — servidor Streamable HTTP |
| `@qdrant/js-client-rest` | `^1.19.0` | Cliente REST oficial do Qdrant |
| `axios` | `^1.20.0` | Cliente HTTP para Ollama (via HttpService) |
| `dotenv` | `^18.0.2` | Carrega `.env` |
| `reflect-metadata` | `^0.2.2` | Metadata reflection para decorators |
| `winston` | `^3.19.0` | Logger — console em dev, structured em prod |
| `zod` | `^4.6.5` | Validação de envs (`env.ts`), schemas de tools MCP |

## Desenvolvimento (devDependencies)

| Pacote | Versão | Uso |
| --- | --- | --- |
| `typescript` | `^5.9.3` | Compilador |
| `tsx` | `^4.23.15` | Dev runner — roda `.ts` direto (ESM) |
| `vitest` | `^5.0.1` | Test runner — ESM nativo |
| `@types/node` | `^22.20.4` | Types do Node.js |
| `eslint` | `^10.11.0` | Linter (flat config) |
| `typescript-eslint` | `^8.70.1` | Parser + rules TS pro ESLint |
| `husky` | `^9.1.7` | Git hooks |
| `lint-staged` | `^17.5.1` | Executa lint nos files staged |

## Por que essas versões?

### Node 22+
- MCP SDK usa `globalThis.crypto` (Web Crypto) — nativo a partir do Node 19
- `zod` v4 usa `zod/v4` internamente — compatível com zod 3.25+
- Node 22 LTS é a versão estável recomendada

### TypeScript 5.x + ESM
- MCP SDK é **ESM-only** — não há como usar CJS
- `module: NodeNext` resolve `.js` extensions automaticamente
- `moduleResolution: NodeNext` — padrão moderno

### Vitest (não jest)
- Jest + ESM exige `--experimental-vm-modules`, config ts-jest com `useESM: true`, `extensionsToTreatAsEsModule` — configuração dolorosa
- Vitest é ESM nativo, zero config, compatível com vitest.config.ts
- Mesma API de assertion (`expect`, `vi.fn()`, `vi.mock`)

### esbuild plugin para decorators
- Vite 8 (que o vitest usa) usa oxc por padrão, que **não suporta legacy decorators**
- Plugin `esbuildLegacyDecorators()` compila com esbuild primeiro, depois oxc processa
- Sem isso, `@controller`, `@get`, etc. não são transformados e quebram

### Husky v9
- `prepare: husky` — instala hooks no `.husky/`
- Fora de um repositório git (Docker build), husky v9 retorna exit 0 silenciosamente
- Runtime Docker usa `--ignore-scripts` — husky é devDep, seguro

## Dependências não usadas (excluídas do drink-it)

| Pacote | drink-it | rag-o-matic | Motivo |
| --- | --- | --- | --- |
| `typeorm` | ✓ | — | Sem banco relacional na base |
| `pg` | ✓ | — | Sem banco relacional na base |
| `ioredis` | ✓ | — | Sem cache na base |
| `redis` | ✓ | — | Sem cache na base |
| `jsonwebtoken` | ✓ | — | Sem auth na base |
| `bcryptjs` | ✓ | — | Sem auth na base |
