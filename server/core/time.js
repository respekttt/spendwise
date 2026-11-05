// Календарні дати за Europe/Kyiv (ADR 003).
// Модулі server/core/ не читають системний час: момент `now` передає викликач.

const kyivFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Kyiv',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Київська календарна дата для заданого моменту.
 * @param {Date} now
 * @returns {string} `YYYY-MM-DD`
 */
export function kyivToday(now) {
  const p = Object.fromEntries(kyivFormat.formatToParts(now).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * Зсув календарної дати на `days` днів. Рахується над UTC-північчю,
 * тому переходи на літній/зимовий час не впливають на результат.
 * @param {string} isoDate `YYYY-MM-DD`
 * @param {number} days
 * @returns {string} `YYYY-MM-DD`
 */
export function addDays(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
