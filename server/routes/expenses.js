import { kyivToday } from '../core/time.js';
import { idParams, objectBody } from './schemas.js';

/**
 * Маршрути витрат (контракт API). `today` рахує маршрут (ADR 003, ADR 007).
 * @param {import('fastify').FastifyInstance} app
 * @param {{ services: ReturnType<typeof import('../services/index.js').createServices> }} options
 */
export async function expenseRoutes(app, { services }) {
  const today = () => kyivToday(app.now());

  app.get('/expenses', () => services.expenses.list());

  app.post('/expenses', { schema: { body: objectBody } }, async (request, reply) => {
    const body = await services.expenses.create(request.body, { today: today() });
    return reply.code(201).send(body);
  });

  app.put('/expenses/:id', { schema: { params: idParams, body: objectBody } }, (request) =>
    services.expenses.update(request.params.id, request.body, { today: today() }),
  );

  app.delete('/expenses/:id', { schema: { params: idParams } }, (request) =>
    services.expenses.remove(request.params.id),
  );
}
