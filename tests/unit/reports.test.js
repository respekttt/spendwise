import { describe, expect, test } from 'bun:test';
import { ValidationError } from '../../server/core/errors.js';
import {
  categoryTotals,
  last30Days,
  limitStates,
  limitWarning,
  monthRange,
} from '../../server/core/reports.js';
import { parseDate } from '../../server/core/validation.js';

// specs/testing.md, розд. 3, «Unit: server/core/reports.js повністю»: кожен випадок — окремий тест.

describe('last30Days', () => {
  test('from = today − 29, to = today', () => {
    expect(last30Days('2026-11-05')).toEqual({ from: '2026-10-07', to: '2026-11-05' });
  });

  test('вікно через перехід на літній час (2026-03-29)', () => {
    expect(last30Days('2026-04-15')).toEqual({ from: '2026-03-17', to: '2026-04-15' });
  });

  test('вікно через межу року', () => {
    expect(last30Days('2027-01-10')).toEqual({ from: '2026-12-12', to: '2027-01-10' });
  });
});

describe('monthRange', () => {
  test('звичайний місяць: від 01 до 31', () => {
    expect(monthRange('2026-10')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  });

  test('лютий: to = 31, а дата неіснуючого дня не проходить валідацію (ADR 003)', () => {
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-31' });
    expect(() => parseDate('2026-02-31', '2026-11-05')).toThrow(ValidationError);
  });

  test('місяць з 30 днями: to = 31', () => {
    expect(monthRange('2026-11')).toEqual({ from: '2026-11-01', to: '2026-11-31' });
    expect(() => parseDate('2026-11-31', '2026-12-31')).toThrow(ValidationError);
  });
});

describe('limitWarning', () => {
  test('limit_amount = null → undefined', () => {
    expect(limitWarning(3, null, 1_000_000)).toBeUndefined();
  });

  test('округлена сума менша за ліміт або рівна йому → undefined', () => {
    expect(limitWarning(3, 300, 299.99)).toBeUndefined();
    expect(limitWarning(3, 300, 300)).toBeUndefined();
    expect(limitWarning(3, 300, 300.004)).toBeUndefined();
  });

  test('більша на копійку → warning з exceeded_by = 0.01', () => {
    expect(limitWarning(3, 300, 300.01)).toEqual({
      category_id: 3,
      limit_amount: 300,
      spent: 300.01,
      exceeded_by: 0.01,
    });
  });

  test('0.1 + 0.2 за ліміту 0.30 → undefined (ADR 001)', () => {
    expect(limitWarning(3, 0.3, 0.1 + 0.2)).toBeUndefined();
  });

  test('spent і exceeded_by у warning округлені', () => {
    expect(limitWarning(2, 1000, 1020.5000000001)).toEqual({
      category_id: 2,
      limit_amount: 1000,
      spent: 1020.5,
      exceeded_by: 20.5,
    });
    // 0.3 − 0.1 без округлення дає 0.19999999999999998.
    expect(limitWarning(4, 0.1, 0.1 + 0.2)).toEqual({
      category_id: 4,
      limit_amount: 0.1,
      spent: 0.3,
      exceeded_by: 0.2,
    });
  });
});

describe('categoryTotals', () => {
  test('порожній вхід і вхід лише з нулями → total = 0, categories = [], без NaN', () => {
    expect(categoryTotals([])).toEqual({ total: 0, categories: [] });
    expect(
      categoryTotals([
        { category_id: 1, name: 'Інше', total: 0 },
        { category_id: 2, name: 'Їжа', total: 0 },
      ]),
    ).toEqual({ total: 0, categories: [] });
  });

  test('рядки з total ≤ 0 відкидаються', () => {
    expect(
      categoryTotals([
        { category_id: 1, name: 'Інше', total: -5 },
        { category_id: 2, name: 'Їжа', total: 0 },
        { category_id: 3, name: 'Авто', total: 0.004 },
        { category_id: 4, name: 'Кава', total: 40 },
      ]),
    ).toEqual({
      total: 40,
      categories: [{ category_id: 4, name: 'Кава', total: 40, share: 100 }],
    });
  });

  test('порядок за спаданням суми', () => {
    const { categories } = categoryTotals([
      { category_id: 1, name: 'А', total: 10 },
      { category_id: 2, name: 'Б', total: 30 },
      { category_id: 3, name: 'В', total: 20 },
    ]);
    expect(categories.map((c) => c.category_id)).toEqual([2, 3, 1]);
  });

  test('за однакових сум — за category_id зростанням (вхід 3, 1, 2)', () => {
    const { categories } = categoryTotals([
      { category_id: 3, name: 'В', total: 10 },
      { category_id: 1, name: 'А', total: 10 },
      { category_id: 2, name: 'Б', total: 10 },
    ]);
    expect(categories.map((c) => c.category_id)).toEqual([1, 2, 3]);
  });

  test('одна категорія → share = 100', () => {
    expect(categoryTotals([{ category_id: 5, name: 'Їжа', total: 123.45 }])).toEqual({
      total: 123.45,
      categories: [{ category_id: 5, name: 'Їжа', total: 123.45, share: 100 }],
    });
  });

  test('шість рівних категорій → сума часток 100.02, у межах 0.005 × N', () => {
    const rows = [1, 2, 3, 4, 5, 6].map((id) => ({ category_id: id, name: `К${id}`, total: 1 }));
    const { categories } = categoryTotals(rows);
    expect(categories.map((c) => c.share)).toEqual([16.67, 16.67, 16.67, 16.67, 16.67, 16.67]);
    const sum = categories.reduce((s, c) => s + c.share, 0);
    expect(sum).toBeCloseTo(100.02, 10);
    expect(Math.abs(sum - 100)).toBeLessThanOrEqual(0.005 * 6 + 1e-9);
  });
});

describe('limitStates', () => {
  test('категорія з лімітом і spent = 0: remaining = limit_amount, exceeded_by = 0', () => {
    expect(
      limitStates([{ category_id: 3, name: 'Транспорт', limit_amount: 300, spent: 0 }]),
    ).toEqual([
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

  test('під лімітом, рівно на ліміті, над лімітом: remaining і exceeded_by не від’ємні й округлені', () => {
    const states = limitStates([
      { category_id: 1, name: 'А', limit_amount: 0.3, spent: 0.1 },
      { category_id: 2, name: 'Б', limit_amount: 300, spent: 300 },
      { category_id: 3, name: 'В', limit_amount: 0.1, spent: 0.1 + 0.2 },
    ]);
    expect(states).toEqual([
      { category_id: 1, name: 'А', limit_amount: 0.3, spent: 0.1, remaining: 0.2, exceeded_by: 0 },
      { category_id: 2, name: 'Б', limit_amount: 300, spent: 300, remaining: 0, exceeded_by: 0 },
      { category_id: 3, name: 'В', limit_amount: 0.1, spent: 0.3, remaining: 0, exceeded_by: 0.2 },
    ]);
  });

  test('порядок за абеткою uk: «Авто» перед «Їжа»', () => {
    const states = limitStates([
      { category_id: 1, name: 'Їжа', limit_amount: 100, spent: 0 },
      { category_id: 2, name: 'Авто', limit_amount: 100, spent: 0 },
    ]);
    expect(states.map((s) => s.name)).toEqual(['Авто', 'Їжа']);
  });
});
