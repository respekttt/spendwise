import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// specs/testing.md, сценарій 3, критерії 3 і 5: окремий процес сервера, лише HTTP.

const mainJs = resolve(import.meta.dir, '../../server/main.js');
const READY_TIMEOUT_MS = 20_000;
const dir = mkdtempSync(join(tmpdir(), 'spendwise-e2e-'));
const dbPath = join(dir, 'e2e.db');
let proc;

/** Вільний порт: відкрити на 0 і закрити. */
const freePort = () =>
  new Promise((done) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
  });

/** true, якщо з'єднання з портом відхилено. */
const refused = (port) =>
  new Promise((done) => {
    const socket = createConnection(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      done(false);
    });
    socket.once('error', () => done(true));
  });

/** Процес сервера на `dbPath`; готовність — перша успішна відповідь `GET /version` за 20 с. */
async function start() {
  const port = await freePort();
  proc = Bun.spawn([process.execPath, mainJs], {
    env: { ...process.env, DB_PATH: dbPath, PORT: String(port), HOST: '127.0.0.1' },
    stdout: 'ignore',
    stderr: 'ignore',
  });
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await fetch(`http://127.0.0.1:${port}/version`).catch(() => undefined);
    if (res?.ok) return `http://127.0.0.1:${port}`;
    await Bun.sleep(50);
  }
  throw new Error(`сервер не відповів на GET /version за ${READY_TIMEOUT_MS} мс`);
}

/** Зупинка процесу, який запустив цей тест (за його PID, а не за назвою). */
async function stop() {
  if (!proc) return;
  proc.kill();
  await proc.exited;
  proc = undefined;
}

const json = (body, headers = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

afterAll(async () => {
  await stop();
  // Windows може ще мить тримати файл БД щойно завершеного процесу (EBUSY).
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  expect(existsSync(dir)).toBe(false);
});

describe('E2E: сценарій 3', () => {
  test(
    'ліміт, warning, звіт, повтор за Idempotency-Key, видалення категорії, рестарт, версія',
    async () => {
      let base = await start();

      // Дата витрати — `to` звіту: київський today сервера (розд. 2, «Межа E2E»).
      let res = await fetch(`${base}/reports/last-30-days`);
      expect(res.status).toBe(200);
      const { to: today } = await res.json();
      expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      res = await fetch(`${base}/categories`, json({ name: 'Їжа', limit_amount: 100 }));
      expect(res.status).toBe(201);
      const { category } = await res.json();
      expect(category).toEqual({
        id: category.id,
        name: 'Їжа',
        limit_amount: 100,
        is_default: false,
      });

      const expenseBody = { category_id: category.id, amount: 150, spent_at: today };
      const key = { 'idempotency-key': 'e2e-expense-1' };
      res = await fetch(`${base}/expenses`, json(expenseBody, key));
      expect(res.status).toBe(201);
      expect(res.headers.get('idempotent-replayed')).toBeNull();
      const created = await res.json();
      expect(created.expense).toMatchObject({
        category_id: category.id,
        amount: 150,
        description: '',
        spent_at: today,
      });
      expect(created.warning).toEqual({
        category_id: category.id,
        limit_amount: 100,
        spent: 150,
        exceeded_by: 50,
      });

      res = await fetch(`${base}/reports/last-30-days`);
      expect(res.status).toBe(200);
      const report = await res.json();
      const [y, m, d] = today.split('-').map(Number);
      expect(report).toEqual({
        from: new Date(Date.UTC(y, m - 1, d - 29)).toISOString().slice(0, 10),
        to: today,
        total: 150,
        categories: [{ category_id: category.id, name: 'Їжа', total: 150, share: 100 }],
        limits: [
          {
            category_id: category.id,
            name: 'Їжа',
            limit_amount: 100,
            spent: 150,
            remaining: 0,
            exceeded_by: 50,
          },
        ],
      });

      res = await fetch(`${base}/expenses`, json(expenseBody, key));
      expect(res.status).toBe(201);
      expect(res.headers.get('idempotent-replayed')).toBe('true');
      expect(await res.json()).toEqual(created);

      res = await fetch(`${base}/expenses`);
      expect(await res.json()).toEqual([created.expense]);

      res = await fetch(`${base}/categories/${category.id}`, { method: 'DELETE' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ category, moved_expenses: 1 });

      // Зупинка й повторний старт на тій самій БД.
      const firstPort = Number(new URL(base).port);
      await stop();
      expect(await refused(firstPort)).toBe(true);
      base = await start();

      res = await fetch(`${base}/categories`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([
        { id: 1, name: 'Інше', limit_amount: null, is_default: true },
      ]);

      res = await fetch(`${base}/expenses`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([{ ...created.expense, category_id: 1 }]);

      res = await fetch(`${base}/version`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toStartWith('text/plain');
      expect(await res.text()).toMatch(/^[0-9a-f]{7,40}$/);

      const secondPort = Number(new URL(base).port);
      await stop();
      expect(await refused(secondPort)).toBe(true);
    },
    3 * READY_TIMEOUT_MS,
  );
});
