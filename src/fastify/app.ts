import fastify from 'fastify';
import cors from '@fastify/cors';
import { mountMcp } from '../core/mcp/mcp-transport.js';
import createRouter from './routes.js';

const app = fastify({ bodyLimit: 10 * 1024 * 1024 });
void app.register(cors);
createRouter(app);
mountMcp(app);

export default app;
