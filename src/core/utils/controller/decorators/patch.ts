import { SYMBOL_PATCH } from './symbols.js';
import { IControllerActionMeta } from '../types.js';

const patch = (path: string) => {
  return (
    target: object,
    propertyKey: string
  ) => {
    if (!Reflect.hasMetadata(SYMBOL_PATCH, target.constructor)) {
      Reflect.defineMetadata(SYMBOL_PATCH, [], target.constructor);
    }

    const gets = Reflect.getMetadata(SYMBOL_PATCH, target.constructor) as IControllerActionMeta[];
    gets.push({
      path,
      action: propertyKey
    });
    Reflect.defineMetadata(SYMBOL_PATCH, gets, target.constructor);
  };
};

export default patch;
