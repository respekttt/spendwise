import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { openDb } from './db/index.js';
import { registerErrorHandlers } from './errors.js';
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

  registerErrorHandlers(app);

  app.register(fastifyStatic, { root: publicDir });
  app.register(versionRoutes, { version });

  return app;
}
