import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Читає файли server/core/, тож це не unit (specs/testing.md, розд. 2; ADR 011).

test('server/core/ не викликає new Date() без аргументів (ADR 003)', () => {
  const coreDir = join(import.meta.dir, '..', '..', 'server', 'core');
  for (const file of readdirSync(coreDir).filter((f) => f.endsWith('.js'))) {
    const source = readFileSync(join(coreDir, file), 'utf8');
    expect({ file, found: /new Date\(\s*\)|Date\.now\(/.test(source) }).toEqual({
      file,
      found: false,
    });
  }
});
