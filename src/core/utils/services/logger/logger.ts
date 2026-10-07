import winston, { Logger } from 'winston';
import { ILoggerService } from './types.js';
import serializeError from './serialize-error.js';

// Error instances carry message/stack/cause as non-enumerable props, so the
// default stringifier collapses them to {}. Recursively convert object-typed
// log data before formatting. (winston.format(fn) is a factory: invoke it.)
const serializeErrors = winston.format((info) => {
  const target = info as Record<string, unknown>;
  for (const key of Object.keys(target)) {
    if (key === 'level' || key === 'message') {
      continue;
    }
    const value = target[key];
    if (value !== null && typeof value === 'object') {
      target[key] = serializeError(value);
    }
  }
  return info;
})();

export default class LoggerService implements ILoggerService {
  constructor(private readonly logger: Logger) {
    this.logger.add(new winston.transports.Console({
      format: winston.format.combine(
        serializeErrors,
        winston.format.simple()
      )
    }));
  }

  info(message: string, data?: unknown) {
    this.logger.info(message, data);
  }

  error(message: string, data?: unknown) {
    this.logger.error(message, data);
  }

  warn(message: string, data?: unknown) {
    this.logger.warn(message, data);
  }

  debug(message: string, data?: unknown) {
    this.logger.debug(message, data);
  }
}
