export class Left<E> {
  readonly isError = true;

  public error!: E;

  constructor(error: E) {
    this.error = error;
  }
}

export class Right<R> {
  readonly isError = false;

  public success!: R;

  constructor(success: R) {
    this.success = success;
  }
}

export type Either<E, R> = Left<E> | Right<R>;
