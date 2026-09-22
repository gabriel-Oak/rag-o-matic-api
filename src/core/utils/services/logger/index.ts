import { createLogger } from 'winston';
import LoggerService from './logger.js';
import { ILoggerService } from './types.js';

let instance: ILoggerService;
const createLoggerService = (): ILoggerService => {
  if (!instance) instance = new LoggerService(createLogger());
  return instance;
};

export default createLoggerService;
