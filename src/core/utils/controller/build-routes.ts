import { FastifyInstance } from 'fastify';
import { SYMBOL_CONTROLLER } from './decorators/symbols.js';
import registerController from './register-controller.js';
import { ICreateController } from './types.js';

export default function buildRoutes(
  app: FastifyInstance,
  controllersFactory: ICreateController<object>[]
) {
  controllersFactory.forEach((createController) => {
    const controller = createController();
    let path: string;
    if (Reflect.hasMetadata(SYMBOL_CONTROLLER, controller.constructor)) {
      path = Reflect.getMetadata(SYMBOL_CONTROLLER, controller.constructor);
    } else {
      const t = /^(.+?)(Controller)?$/.exec(controller.constructor.name);
      if (t && t?.length > 0) {
        const [, p] = t;
        path = `/${p}`;
      } else {
        path = `/${controller.constructor.name}`;
      }
    }
    path = path[0].toLocaleLowerCase() + path.substring(1).replace(/[A-Z]/g, (i) => `-${i.toLowerCase()}`);
    // strip dash artifact right after the leading slash ("/-foo-bar" -> "/foo-bar")
    path = path.startsWith('/-') ? `/${path.slice(2)}` : path;
    registerController(path, controller, app);
  });
}
