import fastify from 'fastify';
import cors from '@fastify/cors';
import { mountMcp } from '../core/mcp/mcp-transport.js';
import createRouter from './routes.js';

const app = fastify();
void app.register(cors);
// services will be wired here (later task)
createRouter(app);
mountMcp(app);

export default app;
