import './fastify/config.js';
import 'reflect-metadata';
import startServer from './fastify/server.js';
import createLoggerService from './core/utils/services/logger/index.js';

const logger = createLoggerService();

startServer().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(message, error);
});
