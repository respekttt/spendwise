import { kyivToday } from '../core/time.js';
import {
  idempotencyHeaders,
  idempotencyKey,
  idParams,
  objectBody,
  sendCreated,
} from './schemas.js';

/**
 * Маршрути категорій (контракт API).
 * @param {import('fastify').FastifyInstance} app
 * @param {{ services: ReturnType<typeof import('../services/index.js').createServices> }} options
 */
export async function categoryRoutes(app, { services }) {
  app.get('/categories', () => services.categories.list());

  app.post(
    '/categories',
    { schema: { body: objectBody, headers: idempotencyHeaders } },
    async (request, reply) =>
      sendCreated(
        reply,
        await services.categories.create(request.body, { idempotencyKey: idempotencyKey(request) }),
      ),
  );

  app.put('/categories/:id', { schema: { params: idParams, body: objectBody } }, (request) =>
    services.categories.update(request.params.id, request.body, {
      today: kyivToday(app.now()),
    }),
  );

  app.delete('/categories/:id', { schema: { params: idParams } }, (request) =>
    services.categories.remove(request.params.id),
  );
}
