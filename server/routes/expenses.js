import { kyivToday } from '../core/time.js';
import {
  idempotencyHeaders,
  idempotencyKey,
  idParams,
  objectBody,
  sendCreated,
} from './schemas.js';

/**
 * Маршрути витрат (контракт API). `today` рахує маршрут (ADR 003, ADR 007).
 * @param {import('fastify').FastifyInstance} app
 * @param {{ services: ReturnType<typeof import('../services/index.js').createServices> }} options
 */
export async function expenseRoutes(app, { services }) {
  const today = () => kyivToday(app.now());

  app.get('/expenses', () => services.expenses.list());

  app.post(
    '/expenses',
    { schema: { body: objectBody, headers: idempotencyHeaders } },
    async (request, reply) =>
      sendCreated(
        reply,
        await services.expenses.create(request.body, {
          today: today(),
          idempotencyKey: idempotencyKey(request),
        }),
      ),
  );

  app.put('/expenses/:id', { schema: { params: idParams, body: objectBody } }, (request) =>
    services.expenses.update(request.params.id, request.body, { today: today() }),
  );

  app.delete('/expenses/:id', { schema: { params: idParams } }, (request) =>
    services.expenses.remove(request.params.id),
  );
}
