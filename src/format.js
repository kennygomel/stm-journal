// src/format.js — форматирование сумм, дат и чисел (всё на клиенте).

const money = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/**
 * Знак белорусского рубля из шрифта НБРБ — код U+E901 в области PUA.
 * В системе такого символа нет, поэтому рисуем его шрифтом (см. styles.css).
 */
export const BYN_SIGN = '\uE901';

/** Узел со знаком BYN (шрифт nbrb); вне DOM — обычный текст. */
export function bynSign() {
  if (typeof document === 'undefined') return 'BYN';
  const node = document.createElement('span');
  node.className = 'nbrb-icon';
  node.textContent = BYN_SIGN;
  return node;
}

/**
 * Копейки → узлы «2 500 <знак BYN>» (без копеек, если сумма целая).
 * Возвращает массив узлов: его принимает el() как children.
 */
export function fmtMoney(kopecks) {
  return [moneyText(kopecks), bynSign()];
}

/** Только число для суммы: «2 500 » с неразрывным пробелом (знак — отдельно). */
export function moneyText(kopecks) {
  return `${money.format(Number(kopecks || 0) / 100)}\u00A0`;
}

/** Копейки → «2 500,50» — для полей ввода. */
export function moneyInput(kopecks) {
  if (kopecks === null || kopecks === undefined) return '';
  return String(Number(kopecks) / 100).replace('.', ',');
}

/** Рубли (строка/число) → копейки. */
export function toKopecks(rubles) {
  const normalized = String(rubles ?? '').replace(/\s+/g, '').replace(',', '.');
  const value = Number(normalized);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

/**
 * Тарифы для отправки на сервер: копейки → рубли.
 * Сервер сам умножает на 100 (lib/settings.js), поэтому отправлять нужно
 * именно рубли — иначе сумма вырастет в 100 раз.
 */
export function ratesToRubles(values) {
  const out = {};
  for (const [key, value] of Object.entries(values)) {
    out[key] = value === null || value === undefined || value === '' ? value : moneyInput(value);
  }
  return out;
}

/** Значение из поля ввода: «12» → 12, пусто → null. */
export function intInput(value) {
  const raw = String(value ?? '').trim();
  if (raw === '') return null;
  const num = Number(raw);
  return Number.isFinite(num) ? Math.round(num) : null;
}

export function fmtNumber(value) {
  return new Intl.NumberFormat('ru-RU').format(Number(value || 0));
}

/** «2025-03-08» → «08.03.2025». */
export function fmtDate(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/** «2025-03-08» → «сб, 8 марта». */
export function fmtDateLong(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || '';
  const date = new Date(`${iso}T12:00:00`);
  return date.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' });
}

/** Сегодняшняя дата в локальной зоне → YYYY-MM-DD. */
export function todayIso() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function isoDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function startOfMonth(offsetMonths = 0) {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() + offsetMonths);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-01`;
}

export function endOfMonth(offsetMonths = 0) {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() + offsetMonths + 1);
  date.setDate(0);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function plural(n, one, few, many) {
  const abs = Math.abs(Number(n) || 0) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
  });
}
