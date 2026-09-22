import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().default(8080),
  OLLAMA_URL: z.url(),
  OLLAMA_EMBEDDING_MODEL: z.string().min(1).default("bge-m3"),
  QDRANT_URL: z.url(),
  QDRANT_API_KEY: z
    .string()
    .optional()
    .transform((value) => (value ? value : undefined)),
  QDRANT_COLLECTION: z.string().min(1).default("vault_notes"),
  QDRANT_DIMENSION: z.coerce.number().positive().default(1024),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${details}`);
  }

  return Object.freeze(result.data);
}

let cached: Env | undefined;

export function getEnv(): Env {
  if (!cached) {
    cached = loadEnv(process.env);
  }
  return cached;
}
