import BaseError from './base-error.js';

export default class HttpError extends BaseError {
  readonly type = 'http-error';

  statusCode: number;

  constructor(props?: {
    message?: string;
    statusCode?: number;
    meta?: unknown;
  }) {
    const { message, statusCode, meta } = props ?? {};
    const defaultMessage = 'Tivemos algum problema desconhecido';
    const defaultStatusCode = 500;

    super(
      message ?? defaultMessage,
      process.env.NODE_ENV !== 'production' ? meta : undefined
    );
    this.statusCode = statusCode ?? defaultStatusCode;
  }

  toString = () => `${this.statusCode}: ${this.message}${this.meta
    ? ` | \n${JSON.stringify(this.meta)}`
    : ''}`;
}
