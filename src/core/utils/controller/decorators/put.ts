import { SYMBOL_PUT } from './symbols.js';
import { IControllerActionMeta } from '../types.js';

const put = (path: string) => {
  return (
    target: object,
    propertyKey: string
  ) => {
    if (!Reflect.hasMetadata(SYMBOL_PUT, target.constructor)) {
      Reflect.defineMetadata(SYMBOL_PUT, [], target.constructor);
    }

    const gets = Reflect.getMetadata(SYMBOL_PUT, target.constructor) as IControllerActionMeta[];
    gets.push({
      path,
      action: propertyKey
    });
    Reflect.defineMetadata(SYMBOL_PUT, gets, target.constructor);
  };
};

export default put;
