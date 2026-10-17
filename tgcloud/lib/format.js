// lib/format.js — small text/validation helpers shared by handlers and endpoints.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date in the given UTC offset (minutes east of UTC) as YYYY-MM-DD. */
export function todayIso(offsetMinutes) {
  const offset = Number.isFinite(Number(offsetMinutes)) ? Number(offsetMinutes) : 180;
  return new Date(Date.now() + offset * 60000).toISOString().slice(0, 10);
}

export function isIsoDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/** Parse an integer within [min, max]; null when it is not a valid whole number. */
export function parseInteger(value, { min = 0, max = 1000000 } = {}) {
  if (value === null || value === undefined || value === '') return null;
  const num = typeof value === 'number' ? value : Number(String(value).replace(/\s+/g, '').replace(',', '.'));
  if (!Number.isFinite(num) || !Number.isInteger(num)) return null;
  if (num < min || num > max) return null;
  return num;
}

/** Parse money given in rubles ("1500", "1500.50") into kopecks. */
export function rublesToKopecks(value, { min = 0, max = 100000000 } = {}) {
  if (value === null || value === undefined || value === '') return null;
  const num = typeof value === 'number' ? value : Number(String(value).replace(/\s+/g, '').replace(',', '.'));
  if (!Number.isFinite(num)) return null;
  const kopecks = Math.round(num * 100);
  if (kopecks < min || kopecks > max) return null;
  return kopecks;
}

/**
 * kopecks → "1 234,50 руб." для сообщений бота.
 * Символ BYN здесь не используется: в Telegram-сообщениях свой шрифт не подключить,
 * а PUA-код из шрифта НБРБ отрендерился бы пустым квадратом.
 */
export function money(kopecks) {
  const value = Number(kopecks || 0) / 100;
  const hasCents = Math.round(value * 100) % 100 !== 0;
  return `${value.toLocaleString('ru-RU', {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  })} руб.`;
}

/** kopecks → "1 234,50" (for inputs, without the currency sign). */
export function moneyPlain(kopecks) {
  const value = Number(kopecks || 0) / 100;
  return value.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function km(value) {
  return `${Number(value || 0).toLocaleString('ru-RU')} км`;
}

export function plural(n, one, few, many) {
  const abs = Math.abs(Number(n) || 0) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}

/** Escape text for Telegram HTML parse mode and for injecting into HTML. */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]);
}

export function displayName(row) {
  if (!row) return 'Без имени';
  const full = [row.firstName, row.lastName].filter(Boolean).join(' ').trim();
  if (full) return full;
  if (row.username) return `@${row.username}`;
  return `ID ${row.tgId}`;
}

export function userLine(row) {
  const parts = [displayName(row)];
  if (row.username) parts.push(`@${row.username}`);
  parts.push(`ID ${row.tgId}`);
  return parts.join(' · ');
}

export function formatDateRu(iso) {
  if (!isIsoDate(iso)) return String(iso ?? '');
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}
