import { FastifyInstance } from 'fastify';
import createIndexController from '../core/features/index/controller/create-index-controller.js';
import createQueryController from '../core/features/query/controller/create-query-controller.js';
import buildRoutes from '../core/utils/controller/build-routes.js';
import HttpError from '../core/utils/errors/http-error.js';

const createRouter = (app: FastifyInstance) => {
  buildRoutes(app, [createIndexController, createQueryController]);

  app.get('/health', (_, res) => res.code(200).send({ status: 'ok' }));
  app.get('/*', (req, res) => res.code(404).send(new HttpError({
    message: 'Error, looks like the route you are looking for has been removed or doesn\'t exists',
    statusCode: 404,
    meta: req.url
  })));
};

export default createRouter;
