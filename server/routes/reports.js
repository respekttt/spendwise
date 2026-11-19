import { kyivToday } from '../core/time.js';

/** Формат `month` перевіряє core/validation.js (поле в тексті помилки). */
const monthQuery = { type: 'object', properties: { month: { type: 'string' } } };

/**
 * Маршрути звітів (контракт API).
 * @param {import('fastify').FastifyInstance} app
 * @param {{ services: ReturnType<typeof import('../services/index.js').createServices> }} options
 */
export async function reportRoutes(app, { services }) {
  const today = () => kyivToday(app.now());

  app.get('/reports/last-30-days', () => services.reports.last30Days({ today: today() }));

  app.get('/reports/monthly', { schema: { querystring: monthQuery } }, (request) =>
    services.reports.monthly(request.query.month, { today: today() }),
  );
}
