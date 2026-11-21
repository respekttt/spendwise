import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// AC 12, сценарій 9 (ADR 008): процес з непридатною БД завершується з кодом ≠ 0 до listen().

const mainJs = resolve(import.meta.dir, '../../server/main.js');
// Тести запускають справжній процес; на Windows з антивірусом і OneDrive старт буває довшим
// за 5 с за замовчуванням, а цикл очікування в AC 9 сам триває до 5 с (200 × 25 мс).
const SPAWN_TIMEOUT_MS = 20_000;
let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'spendwise-start-'));
});
afterEach(() => {
  // Windows може ще мить тримати файл БД щойно завершеного процесу (EBUSY).
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  expect(existsSync(dir)).toBe(false);
});

/** Вільний порт: відкрити на 0 і закрити. */
const freePort = () =>
  new Promise((done) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
  });

const start = (dbPath, port) =>
  Bun.spawn([process.execPath, mainJs], {
    env: { ...process.env, DB_PATH: dbPath, PORT: String(port), HOST: '127.0.0.1' },
    stdout: 'pipe',
    stderr: 'pipe',
  });

const listening = (port) =>
  fetch(`http://127.0.0.1:${port}/version`).then(
    () => true,
    () => false,
  );

describe('AC 12: старт з непридатною БД', () => {
  for (const [name, makePath, code] of [
    ['неіснуючий каталог DB_PATH', () => join(dir, 'missing', 'x.db'), 'SQLITE_CANTOPEN'],
    [
      'файл з довільними байтами',
      () => {
        const path = join(dir, 'junk.db');
        writeFileSync(path, 'не база даних '.repeat(400));
        return path;
      },
      'SQLITE_NOTADB',
    ],
  ]) {
    test(
      `${name} → код виходу ≠ 0, fatal у лозі, порт не слухає`,
      async () => {
        const port = await freePort();
        const proc = start(makePath(), port);
        const exitCode = await proc.exited;
        const out = await new Response(proc.stdout).text();

        expect(exitCode).not.toBe(0);
        const fatal = out
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
          .find((r) => r.level === 60);
        expect(fatal).toMatchObject({ msg: 'database unavailable', err: { code } });
        expect(await listening(port)).toBe(false);
      },
      SPAWN_TIMEOUT_MS,
    );
  }

  test(
    'справна БД: старт, «Інше» одна після повторного старту (AC 9)',
    async () => {
      const dbPath = join(dir, 'ok.db');
      for (let run = 0; run < 2; run++) {
        const port = await freePort();
        const proc = start(dbPath, port);
        let res;
        for (let i = 0; i < 200 && !res; i++) {
          res = await fetch(`http://127.0.0.1:${port}/categories`).catch(() => Bun.sleep(25));
        }
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual([
          { id: 1, name: 'Інше', limit_amount: null, is_default: true },
        ]);
        proc.kill();
        await proc.exited;
      }
    },
    SPAWN_TIMEOUT_MS,
  );
});
