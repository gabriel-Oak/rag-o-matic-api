import type { Either } from "../../types.js";
import BaseError from "../../errors/base-error.js";

export class OllamaError extends BaseError {
  readonly type = "ollama-error";
}

export interface EmbedResponse {
  embeddings: number[][];
}

export interface IOllamaService {
  embed: (inputs: string[]) => Promise<Either<OllamaError, number[][]>>;
}
