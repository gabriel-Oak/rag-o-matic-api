import winston, { Logger } from 'winston';
import { ILoggerService } from './types.js';

export default class LoggerService implements ILoggerService {
  constructor(private readonly logger: Logger) {
    if (process.env.NODE_ENV !== 'production') {
      this.logger.add(new winston.transports.Console({
        format: winston.format.simple()
      }));
    }
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
