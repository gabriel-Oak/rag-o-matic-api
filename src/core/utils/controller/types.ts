import { FastifyReply, FastifyRequest } from 'fastify';

export type controllerAction = (req: FastifyRequest, resp: FastifyReply) => (
  unknown | Promise<unknown>
);

export interface IControllerActionMeta {
  path: string;
  action: string;
}

export type ICreateController<T> = () => T;
