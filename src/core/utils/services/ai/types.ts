import type { Either } from "../../types.js";
import BaseError from "../../errors/base-error.js";

export class AIError extends BaseError {
  readonly type = "ai-error";
}

export interface IAIService {
  embed: (inputs: string[]) => Promise<Either<AIError, number[][]>>;
}
