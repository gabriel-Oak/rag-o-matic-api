import { SYMBOL_GET } from './symbols.js';
import { IControllerActionMeta } from '../types.js';

const get = (path: string) => {
  return (
    target: object,
    propertyKey: string
  ) => {
    if (!Reflect.hasMetadata(SYMBOL_GET, target.constructor)) {
      Reflect.defineMetadata(SYMBOL_GET, [], target.constructor);
    }

    const gets = Reflect.getMetadata(SYMBOL_GET, target.constructor) as IControllerActionMeta[];
    gets.push({
      path,
      action: propertyKey
    });
    Reflect.defineMetadata(SYMBOL_GET, gets, target.constructor);
  };
};

export default get;
