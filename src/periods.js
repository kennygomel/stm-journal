// src/periods.js — периоды отчётов и пересчёта. Один набор на все экраны,
// чтобы «7 дней» и «год» означали одно и то же везде.

import { endOfMonth, isoDaysAgo, startOfMonth, todayIso } from './format.js';

/** Пресеты периодов. `custom` не задаёт границы — их выбирает пользователь. */
export const PERIODS = [
  { id: 'month', label: 'Этот месяц' },
  { id: 'prev', label: 'Прошлый месяц' },
  { id: 'd7', label: '7 дней' },
  { id: 'd30', label: '30 дней' },
  { id: 'year', label: 'Год' },
  { id: 'all', label: 'Всё время' },
];

const year = (offset = 0) => new Date().getFullYear() + offset;

/** Границы периода: { from, to }, где null означает «без ограничения». */
export function rangeFor(periodId) {
  switch (periodId) {
    case 'month':
      return { from: startOfMonth(0), to: endOfMonth(0) };
    case 'prev':
      return { from: startOfMonth(-1), to: endOfMonth(-1) };
    case 'd7':
      return { from: isoDaysAgo(6), to: todayIso() };
    case 'd30':
      return { from: isoDaysAgo(29), to: todayIso() };
    case 'year':
      return { from: `${year()}-01-01`, to: `${year()}-12-31` };
    case 'prevYear':
      return { from: `${year(-1)}-01-01`, to: `${year(-1)}-12-31` };
    case 'all':
    default:
      return { from: null, to: null };
  }
}

/** Человекочитаемое описание периода для подписи. */
export function describeRange(range) {
  if (!range?.from && !range?.to) return 'всё время';
  const from = range.from ? range.from.split('-').reverse().join('.') : '…';
  const to = range.to ? range.to.split('-').reverse().join('.') : 'сегодня';
  return `${from} — ${to}`;
}
