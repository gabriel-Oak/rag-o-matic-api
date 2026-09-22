export default abstract class BaseError extends Error {
  public abstract readonly type: string;

  constructor(
    public readonly message: string,
    public readonly meta?: unknown
  ) { super(); }
}
