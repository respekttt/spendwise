import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

// AC 16: межі шарів ADR 007 і правило імпорту server/context.js (ADR 009).

const root = resolve(import.meta.dir, '..');
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g;

/** Специфікатори імпортів файлу: відносні — як шлях від кореня репозиторію (`server/db/index.js`). */
function importsOf(file, source) {
  return [...source.matchAll(IMPORT)].map(([, spec]) =>
    spec.startsWith('.')
      ? relative(root, resolve(root, dirname(file), spec)).replaceAll('\\', '/')
      : spec,
  );
}

const within = (dir) => (path) => path === dir || path.startsWith(`${dir}/`);

/** [шар-імпортер, заборонений імпорт, пояснення]. */
const RULES = [
  [within('server/routes'), within('server/repositories'), 'routes → repositories'],
  [within('server/routes'), within('server/db'), 'routes → db'],
  [within('server/routes'), (s) => s === 'bun:sqlite', 'routes → bun:sqlite'],
  [
    within('server/services'),
    (s) => s === 'fastify' || s.startsWith('@fastify/'),
    'services → fastify',
  ],
  [within('server/services'), (s) => s === 'bun:sqlite', 'services → bun:sqlite'],
  [within('server/services'), within('server/db'), 'services → db'],
  [within('server/services'), (s) => s === 'server/errors.js', 'services → server/errors.js'],
  [
    within('server/core'),
    (s) => s.startsWith('server/') && !within('server/core')(s),
    'core → інший шар',
  ],
  [
    (file) =>
      !['server/app.js', 'server/logger.js'].includes(file) && !within('server/services')(file),
    (s) => s === 'server/context.js',
    'context.js імпортують лише app.js, logger.js і services/',
  ],
];

/** @param {{ file: string, imports: string[] }[]} modules */
function violations(modules) {
  return modules.flatMap(({ file, imports }) =>
    RULES.flatMap(([isImporter, isForbidden, rule]) =>
      isImporter(file) ? imports.filter(isForbidden).map((spec) => ({ file, spec, rule })) : [],
    ),
  );
}

function serverModules() {
  return readdirSync(join(root, 'server'), { recursive: true })
    .map((p) => `server/${p.replaceAll('\\', '/')}`)
    .filter((p) => p.endsWith('.js'))
    .map((file) => ({ file, imports: importsOf(file, readFileSync(join(root, file), 'utf8')) }));
}

describe('межі шарів (ADR 007, ADR 009)', () => {
  test('у server/ немає заборонених імпортів', () => {
    const modules = serverModules();
    expect(modules.length).toBeGreaterThan(10);
    expect(violations(modules)).toEqual([]);
  });

  test('перевірка ловить кожне правило (самоперевірка)', () => {
    const fake = [
      {
        file: 'server/routes/x.js',
        imports: ['server/repositories/memory/index.js', 'server/db/index.js', 'bun:sqlite'],
      },
      {
        file: 'server/services/x.js',
        imports: ['fastify', 'bun:sqlite', 'server/db/index.js', 'server/errors.js'],
      },
      { file: 'server/core/x.js', imports: ['server/services/index.js', 'server/context.js'] },
      { file: 'server/repositories/memory/x.js', imports: ['server/context.js'] },
      { file: 'server/routes/y.js', imports: ['server/context.js'] },
    ];
    const found = violations(fake);
    for (const [, , rule] of RULES) expect(found.map((v) => v.rule)).toContain(rule);
    // Дозволене не ловиться.
    expect(
      violations([
        { file: 'server/services/ok.js', imports: ['server/core/errors.js', 'server/context.js'] },
        { file: 'server/core/ok.js', imports: ['server/core/time.js', 'node:crypto'] },
        { file: 'server/routes/ok.js', imports: ['server/core/time.js'] },
      ]),
    ).toEqual([]);
  });

  test('розбір імпортів: відносні шляхи розв’язуються від файлу', () => {
    expect(
      importsOf(
        'server/routes/a.js',
        "import { x } from '../core/time.js';\nimport y from 'fastify';",
      ),
    ).toEqual(['server/core/time.js', 'fastify']);
  });
});
