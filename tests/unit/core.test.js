import { describe, expect, test } from 'bun:test';
import { normalizeCategoryName, sortCategories } from '../../server/core/categories.js';
import { ValidationError } from '../../server/core/errors.js';
import { parseMoney, roundMoney } from '../../server/core/money.js';
import {
  categoryTotals,
  last30Days,
  limitStates,
  limitWarning,
  monthRange,
} from '../../server/core/reports.js';
import {
  parseCategoryInput,
  parseDate,
  parseExpenseInput,
  parseMonth,
} from '../../server/core/validation.js';

const T = '2026-11-05';

describe('гроші (ADR 001)', () => {
  test('0.10 + 0.20 = 0.30 після округлення', () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
  });

  test('відомі межі округлення: 0.005 → 0.01, 1.005 → 1', () => {
    expect(parseMoney(0.005, 'amount')).toBe(0.01);
    expect(parseMoney(1.005, 'amount')).toBe(1);
  });

  test('верхня межа 1 000 000 000 включно', () => {
    expect(parseMoney(1_000_000_000, 'amount')).toBe(1_000_000_000);
  });

  for (const value of [0, -5, 0.004, '12.5', 1e308, 1_000_000_000.01, null, undefined]) {
    test(`${String(value)} → ValidationError з назвою поля`, () => {
      expect(() => parseMoney(value, 'amount')).toThrow(ValidationError);
      expect(() => parseMoney(value, 'amount')).toThrow(/^amount:/);
    });
  }
});

describe('назви (ADR 002)', () => {
  test('trim, NFC, регістр для кирилиці', () => {
    expect(normalizeCategoryName('  ЇЖА ')).toBe('їжа');
    expect(normalizeCategoryName(' Інше ')).toBe('інше');
    expect(normalizeCategoryName('Мийка'.normalize('NFD'))).toBe('мийка'.normalize('NFC'));
  });

  test('апострофи не нормалізуються', () => {
    expect(normalizeCategoryName("Кав'ярня")).not.toBe(normalizeCategoryName('Кавʼярня'));
  });

  test('сортування: абетка uk, «Інше» остання', () => {
    const sorted = sortCategories([
      { name: 'Інше', is_default: true },
      { name: 'Їжа', is_default: false },
      { name: 'Авто', is_default: false },
      { name: 'Ґанок', is_default: false },
      { name: 'Яблука', is_default: false },
    ]);
    expect(sorted.map((c) => c.name)).toEqual(['Авто', 'Ґанок', 'Їжа', 'Яблука', 'Інше']);
  });
});

describe('валідація полів', () => {
  test('дата: T і T - 29 валідні, T + 1 і нереальні — ні', () => {
    expect(parseDate(T, T)).toBe(T);
    expect(parseDate('2026-10-07', T)).toBe('2026-10-07');
    for (const bad of ['2026-11-06', '2026-02-30', '2026-2-3', '03.02.2026', 20261105]) {
      expect(() => parseDate(bad, T)).toThrow(ValidationError);
    }
  });

  test('місяць: поточний валідний; 2026-13, 2026-1, майбутній, відсутній — ні', () => {
    expect(parseMonth('2026-11', T)).toBe('2026-11');
    expect(parseMonth('2025-12', T)).toBe('2025-12');
    for (const bad of ['2026-13', '2026-1', '2026-12', undefined, '2026-00']) {
      expect(() => parseMonth(bad, T)).toThrow(ValidationError);
    }
  });

  test('витрата: description за замовчуванням "", межа 500 символів у кодових точках', () => {
    const base = { category_id: 1, amount: 10, spent_at: T };
    expect(parseExpenseInput(base, T).description).toBe('');
    expect(
      parseExpenseInput({ ...base, description: '😀'.repeat(500) }, T).description,
    ).toHaveLength(1000);
    expect(() => parseExpenseInput({ ...base, description: 'x'.repeat(501) }, T)).toThrow(
      /^description:/,
    );
    expect(() => parseExpenseInput({ ...base, description: 5 }, T)).toThrow(ValidationError);
    expect(() => parseExpenseInput({ ...base, category_id: '1' }, T)).toThrow(/^category_id:/);
    expect(() => parseExpenseInput({ ...base, category_id: 1.5 }, T)).toThrow(/^category_id:/);
  });

  test('категорія: trim + NFC, 1–50 символів, ліміт null за замовчуванням, is_default — 400', () => {
    expect(parseCategoryInput({ name: '  Їжа ' })).toEqual({ name: 'Їжа', limit_amount: null });
    expect(parseCategoryInput({ name: 'А'.repeat(50), limit_amount: 0.1 + 0.2 })).toEqual({
      name: 'А'.repeat(50),
      limit_amount: 0.3,
    });
    for (const name of ['', '   ', 'А'.repeat(51), 5]) {
      expect(() => parseCategoryInput({ name })).toThrow(/^name:/);
    }
    expect(() => parseCategoryInput({ name: 'X', limit_amount: 0 })).toThrow(/^limit_amount:/);
    expect(() => parseCategoryInput({ name: 'X', is_default: false })).toThrow(/^is_default:/);
  });
});

describe('періоди й звіти', () => {
  test('вікно 30 днів і межі місяця', () => {
    expect(last30Days(T)).toEqual({ from: '2026-10-07', to: T });
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-31' });
  });

  test('warning: строго більше за ліміт; рівно на ліміті — немає; суми округлюються', () => {
    expect(limitWarning(3, 300, 300)).toBeUndefined();
    expect(limitWarning(3, 0.3, 0.1 + 0.2)).toBeUndefined();
    expect(limitWarning(3, null, 1e6)).toBeUndefined();
    expect(limitWarning(2, 1000, 1020.5000000001)).toEqual({
      category_id: 2,
      limit_amount: 1000,
      spent: 1020.5,
      exceeded_by: 20.5,
    });
  });

  test('частки: за спаданням суми, сума часток у межах 0.005 × N', () => {
    const rows = [1, 2, 3, 4, 5, 6].map((id) => ({ category_id: id, name: `К${id}`, total: 1 }));
    const report = categoryTotals(rows);
    expect(report.total).toBe(6);
    const sum = report.categories.reduce((s, c) => s + c.share, 0);
    expect(Math.abs(sum - 100)).toBeLessThanOrEqual(0.005 * 6 + 1e-9);

    const sorted = categoryTotals([
      { category_id: 1, name: 'Інше', total: 500.1 },
      { category_id: 3, name: 'Їжа', total: 1000.2 },
      { category_id: 4, name: 'Нуль', total: 0 },
    ]);
    expect(sorted).toEqual({
      total: 1500.3,
      categories: [
        { category_id: 3, name: 'Їжа', total: 1000.2, share: 66.67 },
        { category_id: 1, name: 'Інше', total: 500.1, share: 33.33 },
      ],
    });
  });

  test('порожній період: total = 0, categories = [] без NaN', () => {
    expect(categoryTotals([])).toEqual({ total: 0, categories: [] });
  });

  test('стан лімітів: remaining і exceeded_by не від’ємні, округлені', () => {
    expect(
      limitStates([
        { category_id: 3, name: 'Транспорт', limit_amount: 300, spent: 0 },
        { category_id: 2, name: 'Їжа', limit_amount: 1000, spent: 1000.2 },
      ]),
    ).toEqual([
      {
        category_id: 2,
        name: 'Їжа',
        limit_amount: 1000,
        spent: 1000.2,
        remaining: 0,
        exceeded_by: 0.2,
      },
      {
        category_id: 3,
        name: 'Транспорт',
        limit_amount: 300,
        spent: 0,
        remaining: 300,
        exceeded_by: 0,
      },
    ]);
  });
});

describe('parseDate: межі формату й назва поля', () => {
  test('зайве на початку чи в кінці або не рядок → ValidationError', () => {
    for (const bad of ['x2026-02-03', '2026-02-03x', ['2026-11-05']]) {
      expect(() => parseDate(bad, T)).toThrow(ValidationError);
    }
  });

  test('тексти помилок формату й дати з майбутнього починаються з spent_at:', () => {
    expect(() => parseDate('2026-02-30', T)).toThrow(/^spent_at: \S/);
    expect(() => parseDate('2026-11-06', T)).toThrow(/^spent_at: \S/);
  });

  test('з явним field текст починається з його назви', () => {
    expect(() => parseDate('2026-02-30', T, 'x')).toThrow(/^x: \S/);
    expect(() => parseDate('2026-11-06', T, 'x')).toThrow(/^x: \S/);
  });
});

describe('parseMonth: межі формату й назва поля', () => {
  test('зайве на початку чи в кінці або не рядок → ValidationError', () => {
    for (const bad of ['12026-01', '2026-01x', ['2026-11']]) {
      expect(() => parseMonth(bad, T)).toThrow(ValidationError);
    }
  });

  test('тексти помилок формату й місяця з майбутнього починаються з month:', () => {
    expect(() => parseMonth('2026-13', T)).toThrow(/^month: \S/);
    expect(() => parseMonth('2026-12', T)).toThrow(/^month: \S/);
  });
});

describe('parseExpenseInput: назва поля amount', () => {
  test('amount: 0 → текст починається з amount:', () => {
    expect(() => parseExpenseInput({ category_id: 1, amount: 0, spent_at: T }, T)).toThrow(
      /^amount: \S/,
    );
  });
});
