import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createApp } from '../server/app.js';
import { resolveVersion } from '../server/routes/version.js';

// AC 8: джерела версії в порядку з контракту API.
describe('resolveVersion', () => {
  const envWithoutSha = { ...process.env };
  delete envWithoutSha.GIT_SHA;

  const outsideRepo = mkdtempSync(join(tmpdir(), 'spendwise-nogit-'));
  afterAll(() => rmSync(outsideRepo, { recursive: true, force: true }));

  test('з GIT_SHA повертає це значення', () => {
    expect(resolveVersion({ env: { ...envWithoutSha, GIT_SHA: 'abc1234' } })).toBe('abc1234');
  });

  test('без GIT_SHA у репозиторії збігається з git rev-parse --short HEAD', () => {
    const expected = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: join(import.meta.dir, '..'),
      encoding: 'utf8',
    }).stdout.trim();

    expect(expected).toMatch(/^[0-9a-f]{4,}$/);
    expect(resolveVersion({ env: envWithoutSha })).toBe(expected);
  });

  test('без GIT_SHA і поза репозиторієм повертає unknown', () => {
    // Не даємо git шукати .git у батьківських директоріях тимчасової папки.
    const env = { ...envWithoutSha, GIT_CEILING_DIRECTORIES: dirname(outsideRepo) };
    expect(resolveVersion({ env, cwd: outsideRepo })).toBe('unknown');
  });

  test('порожній GIT_SHA вважається відсутнім', () => {
    const env = { ...envWithoutSha, GIT_SHA: '  ', GIT_CEILING_DIRECTORIES: dirname(outsideRepo) };
    expect(resolveVersion({ env, cwd: outsideRepo })).toBe('unknown');
  });
});

describe('GET /version', () => {
  test('повертає передане фабриці значення як text/plain з кодом 200', async () => {
    const app = createApp({ dbPath: ':memory:', version: 'unknown' });
    const res = await app.inject({ method: 'GET', url: '/version' });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toStartWith('text/plain');
    expect(res.body).toBe('unknown');
  });
});
