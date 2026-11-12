/**
 * `GET /version` (контракт API). Маршрут лише віддає значення, яке йому передали;
 * як версію визначено — справа точки входу (`server/main.js`, `resolveVersion`).
 * @param {import('fastify').FastifyInstance} app
 * @param {{ version: string }} options
 */
export async function versionRoutes(app, { version }) {
  app.get('/version', async (_request, reply) => {
    reply.type('text/plain; charset=utf-8');
    return version;
  });
}
