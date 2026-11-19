import { afterAll, describe, expect, test } from 'bun:test';
import { currentContext, requireContext, runWithContext } from '../server/context.js';
import { createTestApp, expectError, memoryLogger } from './helpers.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('server/context.js (ADR 009)', () => {
  test('поза запитом: currentContext → undefined, requireContext кидає', () => {
    expect(currentContext()).toBeUndefined();
    expect(() => requireContext()).toThrow();
  });

  test('контекст заморожений і переживає await', async () => {
    await runWithContext({ reqId: 'r', bpId: 'b', user: 'u' }, async () => {
      await Promise.resolve();
      expect(requireContext()).toEqual({ reqId: 'r', bpId: 'b', user: 'u' });
      expect(Object.isFrozen(requireContext())).toBe(true);
    });
  });

  test('mixin: reqId, bpId, user у рядку кореневого логера; поза запитом — нічого', () => {
    const { records, logger } = memoryLogger('info');
    runWithContext({ reqId: 'r1', bpId: 'b1', user: 'u1' }, () => logger.info('в запиті'));
    logger.info('поза запитом');

    expect(records[0]).toMatchObject({ reqId: 'r1', bpId: 'b1', user: 'u1' });
    expect(records[1]).not.toContainKey('reqId');
    expect(records[1]).not.toContainKey('user');
  });

  test('mixin: дочірній логер з reqId не отримує дубліката', () => {
    const { records, logger } = memoryLogger('info');
    runWithContext({ reqId: 'r1', bpId: 'b1', user: 'u1' }, () =>
      logger.child({ reqId: 'r1' }).info('x'),
    );
    expect(records[0]).toMatchObject({ reqId: 'r1', bpId: 'b1', user: 'u1' });
  });
});

describe('заголовки-ID і X-User (контракт, «Заголовки»)', () => {
  const { app } = createTestApp();
  afterAll(() => app.close());

  const get = (headers = {}) => app.inject({ method: 'GET', url: '/version', headers });

  test('X-Request-Id — UUID сервера; вхідний X-Request-Id ігнорується', async () => {
    const res = await get({ 'x-request-id': 'client-id' });
    expect(res.headers['x-request-id']).toMatch(UUID);
    expect(res.headers['x-request-id']).not.toBe('client-id');
  });

  test('валідний X-Process-Id повертається без змін', async () => {
    const res = await get({ 'x-process-id': 'flow:42.a-b_c' });
    expect(res.headers['x-process-id']).toBe('flow:42.a-b_c');
  });

  for (const [name, headers] of [
    ['відсутній', {}],
    ['невалідний', { 'x-process-id': 'має пробіл' }],
    ['задовгий', { 'x-process-id': 'a'.repeat(65) }],
  ]) {
    test(`X-Process-Id ${name} → дорівнює X-Request-Id, не 400`, async () => {
      const res = await get(headers);
      expect(res.statusCode).toBe(200);
      expect(res.headers['x-process-id']).toBe(res.headers['x-request-id']);
    });
  }

  test('два запити з одним X-Process-Id мають різні X-Request-Id', async () => {
    const [a, b] = await Promise.all([
      get({ 'x-process-id': 'p1' }),
      get({ 'x-process-id': 'p1' }),
    ]);
    expect(a.headers['x-request-id']).not.toBe(b.headers['x-request-id']);
  });

  for (const user of ['має пробіл', 'a'.repeat(65), '']) {
    test(`невалідний X-User ${JSON.stringify(user)} → 400`, async () => {
      expectError(expect, await get({ 'x-user': user }), 400);
    });
  }

  test('невалідний X-User + валідний X-Process-Id → 400 з обома заголовками-ID', async () => {
    const res = await get({ 'x-user': 'bad user', 'x-process-id': 'proc-1' });
    expectError(expect, res, 400);
    expect(res.headers['x-request-id']).toMatch(UUID);
    expect(res.headers['x-process-id']).toBe('proc-1');
  });

  test('404 і 500 теж мають заголовки-ID', async () => {
    const res = await app.inject({ method: 'GET', url: '/no-such-route' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['x-request-id']).toMatch(UUID);
    expect(res.headers['x-process-id']).toBe(res.headers['x-request-id']);
  });
});

describe('AC 10: контекст у рядках логу з усіх шарів', () => {
  const body = { category_id: 2, amount: 10, spent_at: '2026-11-05' };

  test('маршрут, сервіс і репозиторій мають однакові reqId, bpId, user', async () => {
    const { app, records, lines } = createTestApp({ level: 'debug' });
    const res = await app.inject({
      method: 'POST',
      url: '/expenses',
      payload: body,
      headers: { 'x-user': 'alice', 'x-process-id': 'proc-7' },
    });
    await app.close();

    const reqId = res.headers['x-request-id'];
    const mine = records.filter((r) => r.reqId === reqId);
    const byMsg = (msg) => mine.filter((r) => r.msg === msg);
    // Рядок маршруту (request.log Fastify), сервісу і репозиторію.
    expect(byMsg('request completed').length).toBe(1);
    expect(byMsg('expense created').length).toBe(1);
    expect(byMsg('repository call').length).toBeGreaterThanOrEqual(2);

    // incoming request пишеться до onRequest — bpId і user у ньому немає (ADR 009).
    for (const r of mine.filter((r) => r.msg !== 'incoming request')) {
      expect({ msg: r.msg, bpId: r.bpId, user: r.user }).toEqual({
        msg: r.msg,
        bpId: 'proc-7',
        user: 'alice',
      });
    }
    // Без дубліката reqId між bindings і mixin.
    for (const line of lines) expect(line.split('"reqId"').length).toBeLessThanOrEqual(2);
  });

  test('без X-User — local; невалідний X-User: request completed має reqId, bpId і user: null', async () => {
    const { app, records } = createTestApp({ level: 'info' });
    const ok = await app.inject({ method: 'GET', url: '/categories' });
    const bad = await app.inject({
      method: 'GET',
      url: '/categories',
      headers: { 'x-user': 'bad user', 'x-process-id': 'p-9' },
    });
    await app.close();

    const completed = (res) =>
      records.find((r) => r.reqId === res.headers['x-request-id'] && r.msg === 'request completed');
    expect(completed(ok).user).toBe('local');
    expect(completed(bad)).toMatchObject({ bpId: 'p-9', user: null });
  });

  test('два паралельні запити через справжній HTTP не змішують контекст', async () => {
    const { app, records } = createTestApp({ level: 'debug' });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const url = `http://127.0.0.1:${app.server.address().port}/expenses`;
    const send = (user, extra) =>
      fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-user': user },
        body: JSON.stringify({ ...body, ...extra }),
      });

    // Велике тіло розбирається довше — запити перекриваються в часі.
    const [big, small] = await Promise.all([
      send('big', { pad: 'x'.repeat(200_000) }),
      send('small'),
    ]);
    await app.close();

    expect([big.status, small.status]).toEqual([201, 201]);
    for (const [res, user] of [
      [big, 'big'],
      [small, 'small'],
    ]) {
      const mine = records.filter(
        (r) => r.reqId === res.headers.get('x-request-id') && r.msg !== 'incoming request',
      );
      expect(mine.some((r) => r.msg === 'repository call')).toBe(true);
      expect(new Set(mine.map((r) => r.user))).toEqual(new Set([user]));
    }
  });
});
