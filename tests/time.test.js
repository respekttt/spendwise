import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { addDays, kyivToday } from '../server/core/time.js';

describe('kyivToday (ADR 003)', () => {
  test('літо: 21:30 UTC — у Києві вже наступна доба', () => {
    expect(kyivToday(new Date('2026-07-15T21:30:00Z'))).toBe('2026-07-16');
  });

  test('зима: 21:30 UTC — у Києві ще та сама доба', () => {
    expect(kyivToday(new Date('2026-01-15T21:30:00Z'))).toBe('2026-01-15');
  });

  test('зима: 22:00 UTC — у Києві північ наступної доби', () => {
    expect(kyivToday(new Date('2026-01-15T22:00:00Z'))).toBe('2026-01-16');
  });

  test('навколо переходу на літній час 29 березня 2026', () => {
    // До переходу UTC+2: 22:30 UTC 28.03 = 00:30 29.03 у Києві.
    expect(kyivToday(new Date('2026-03-28T22:30:00Z'))).toBe('2026-03-29');
    // Після переходу UTC+3: 21:30 UTC 29.03 = 00:30 30.03 у Києві.
    expect(kyivToday(new Date('2026-03-29T21:30:00Z'))).toBe('2026-03-30');
  });
});

describe('addDays (ADR 003)', () => {
  test('через межу місяця й року', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  test('вікно 30 днів через перехід на літній час (29 березня 2026)', () => {
    expect(addDays('2026-04-15', -29)).toBe('2026-03-17');
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
  });

  test('через перехід на зимовий час (25 жовтня 2026)', () => {
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
    expect(addDays('2026-11-05', -29)).toBe('2026-10-07');
  });

  test('нульовий зсув нормалізує неіснуючу дату', () => {
    expect(addDays('2026-02-30', 0)).toBe('2026-03-02');
  });
});

test('server/core/ не викликає new Date() без аргументів (ADR 003)', () => {
  const coreDir = join(import.meta.dir, '..', 'server', 'core');
  for (const file of readdirSync(coreDir).filter((f) => f.endsWith('.js'))) {
    const source = readFileSync(join(coreDir, file), 'utf8');
    expect({ file, found: /new Date\(\s*\)|Date\.now\(/.test(source) }).toEqual({
      file,
      found: false,
    });
  }
});
