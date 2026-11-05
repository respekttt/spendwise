import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { openDb } from './db/index.js';
import { resolveVersion, versionRoutes } from './routes/version.js';

const publicDir = fileURLToPath(new URL('../public', import.meta.url));

/**
 * Фабрика застосунку.
 * @param {object} [options]
 * @param {string} [options.dbPath] шлях до файла SQLite або `:memory:`
 * @param {() => Date} [options.now] годинник (ADR 003); маршрути рахують `today = kyivToday(now())`
 * @param {string} [options.version] значення для `GET /version`; за замовчуванням визначається один раз тут
 * @param {boolean | object} [options.logger] налаштування логера Fastify
 * @returns {import('fastify').FastifyInstance}
 */
export function createApp({
  dbPath = ':memory:',
  now = () => new Date(),
  version = resolveVersion(),
  logger = false,
} = {}) {
  const app = Fastify({ logger });
  const db = openDb(dbPath);

  app.decorate('db', db);
  app.decorate('now', now);
  app.addHook('onClose', async () => {
    db.close();
  });

  app.setErrorHandler((error, request, reply) => {
    // Нечисловий або неіснуючий :id — 404, а не 400 (контракт, «Загальні правила»).
    if (error.validation && error.validationContext === 'params') {
      return reply.code(404).send({ error: 'Ресурс не знайдено' });
    }
    if (error.validation) {
      return reply.code(400).send({ error: 'Невалідні дані запиту' });
    }
    const status = error.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      return reply.code(status).send({ error: 'Некоректний запит' });
    }
    request.log.error(error);
    return reply.code(500).send({ error: 'Внутрішня помилка сервера' });
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({ error: 'Маршрут не знайдено' });
  });

  app.register(fastifyStatic, { root: publicDir });
  app.register(versionRoutes, { version });

  return app;
}
