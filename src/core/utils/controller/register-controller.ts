import { FastifyInstance } from 'fastify';
import HttpError from '../errors/http-error.js';
import createLoggerService from '../services/logger/index.js';
import { SYMBOL_DELETE, SYMBOL_GET, SYMBOL_PATCH, SYMBOL_POST, SYMBOL_PUT } from './decorators/symbols.js';
import { controllerAction, IControllerActionMeta } from './types.js';

export default function registerController(
  path: string,
  controller: object,
  app: FastifyInstance
) {
  function processMeta(
    symbol: symbol,
    method: 'get' | 'post' | 'patch' | 'put' | 'delete'
  ) {
    if (Reflect.hasMetadata(symbol, controller.constructor)) {
      const actions = Reflect.getMetadata(
        symbol,
        controller.constructor
      ) as IControllerActionMeta[];

      actions.forEach(({ path: p, action }) => {
        const actionPath = p === '/' ? '' : p;
        app[method](`${path}${actionPath}`, async (req, rep) => {
          try {
            const res = await (controller as Record<string, controllerAction>)[action](req, rep);
            return res;
          } catch (e) {
            const error = new HttpError({
              message: (e as Error).message,
              meta: e
            });

            const logger = createLoggerService();
            logger.error(error.message, error);
            await rep.code(error.statusCode).send(error);
          }
        });
      });
    }
  }

  processMeta(SYMBOL_GET, 'get');
  processMeta(SYMBOL_POST, 'post');
  processMeta(SYMBOL_PATCH, 'patch');
  processMeta(SYMBOL_PUT, 'put');
  processMeta(SYMBOL_DELETE, 'delete');
}
