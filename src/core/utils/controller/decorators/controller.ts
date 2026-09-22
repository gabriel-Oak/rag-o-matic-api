import { SYMBOL_CONTROLLER } from './symbols.js';

export default function controller(path: string) {
  return (
    target: object
  ) => { Reflect.defineMetadata(SYMBOL_CONTROLLER, path, target); };
}
