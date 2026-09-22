import { SYMBOL_DELETE } from './symbols.js';
import { IControllerActionMeta } from '../types.js';

const del = (path: string) => {
  return (
    target: object,
    propertyKey: string
  ) => {
    if (!Reflect.hasMetadata(SYMBOL_DELETE, target.constructor)) {
      Reflect.defineMetadata(SYMBOL_DELETE, [], target.constructor);
    }

    const gets = Reflect.getMetadata(SYMBOL_DELETE, target.constructor) as IControllerActionMeta[];
    gets.push({
      path,
      action: propertyKey
    });
    Reflect.defineMetadata(SYMBOL_DELETE, gets, target.constructor);
  };
};

export default del;
