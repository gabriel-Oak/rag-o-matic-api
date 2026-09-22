import BaseError from '../../../utils/errors/base-error.js';

export class ExtractError extends BaseError {
  readonly type = 'extract-error';
}
