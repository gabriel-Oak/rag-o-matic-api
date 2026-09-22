import { env } from 'process';
import createLoggerService from '../core/utils/services/logger/index.js';
import app from './app.js';

export default async function startServer() {
  const logger = createLoggerService();
  const port = env.PORT ?? 8080;
  await app.listen({ port: +port, host: '0.0.0.0' })
    .catch((e) => logger.error('Error starting server', e));

  logger.info(`Server started at port ${port}`);
}
