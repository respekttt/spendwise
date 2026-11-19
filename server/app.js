import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { runWithContext } from './context.js';
import { ValidationError } from './core/errors.js';
import { registerErrorHandlers } from './errors.js';
import { createLogger } from './logger.js';
import { categoryRoutes } from './routes/categories.js';
import { expenseRoutes } from './routes/expenses.js';
import { versionRoutes } from './routes/version.js';
import { createServices } from './services/index.js';

const publicDir = fileURLToPath(new URL('../public', import.meta.url));

// Формати заголовків — контракт API, «Заголовки».
const USER = /^[A-Za-z0-9._-]{1,64}$/;
const PROCESS_ID = /^[A-Za-z0-9._:-]{1,64}$/;

/**
 * Фабрика застосунку (ADR 007). Сховища не створює й БД не відкриває.
 * @param {object} options
 * @param {object} options.store сховище з `withTransaction`, `withRead` і репозиторіями
 * @param {() => Date} [options.now] годинник (ADR 003); маршрути рахують `today = kyivToday(now())`
 * @param {string} [options.version] значення для `GET /version`; визначає його `server/main.js`
 * @param {import('pino').Logger} [options.logger] той самий екземпляр, що й у сховищі (ADR 009)
 * @returns {import('fastify').FastifyInstance}
 */
export function createApp({
  store,
  now = () => new Date(),
  version = 'unknown',
  logger = createLogger({ level: 'silent' }),
} = {}) {
  if (!store) throw new TypeError('createApp: store обов’язковий (ADR 007)');

  const app = Fastify({
    loggerInstance: logger,
    requestIdHeader: false,
    genReqId: () => randomUUID(),
  });

  app.decorate('now', now);
  app.decorateRequest('bpId', null);

  // ADR 009, «Вхід у контекст»: bpId → X-User → контекст; помилку X-User віддаємо вже в контексті.
  app.addHook('onRequest', (request, _reply, done) => {
    const processId = request.headers['x-process-id'];
    request.bpId =
      typeof processId === 'string' && PROCESS_ID.test(processId) ? processId : request.id;

    const rawUser = request.headers['x-user'];
    let user = null;
    if (rawUser === undefined) user = 'local';
    else if (typeof rawUser === 'string' && USER.test(rawUser)) user = rawUser;

    runWithContext({ reqId: request.id, bpId: request.bpId, user }, () =>
      user === null
        ? done(new ValidationError('X-User: очікується 1–64 символи [A-Za-z0-9._-]'))
        : done(),
    );
  });

  // Заголовки беруться з request, а не з ALS.
  app.addHook('onSend', (request, reply, payload, done) => {
    reply.header('X-Request-Id', request.id);
    reply.header('X-Process-Id', request.bpId ?? request.id);
    done(null, payload);
  });

  registerErrorHandlers(app);

  app.register(fastifyStatic, { root: publicDir });
  const services = createServices({ store, logger, now });
  app.register(expenseRoutes, { services });
  app.register(categoryRoutes, { services });
  app.register(versionRoutes, { version });

  return app;
}
