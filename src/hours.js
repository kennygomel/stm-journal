// src/hours.js — правило доплаты за часы.
//
// За каждые ПОЛНЫЕ 4 часа свыше лимита (по умолчанию 8) — один шаг доплаты:
// 12 ч → +20 ₽, 16 ч → +40 ₽, 20 ч → +60 ₽. 11 ч → 0, 13 ч → +20 ₽.
// Те же константы продублированы на сервере (tgcloud/lib/calc.js): формулы
// должны совпадать, поэтому есть тест, сверяющий обе реализации.

export const HOURS_STEP = 4;

/** Сколько шагов доплаты укладывается в превышение по часам. */
export function hoursSteps(extraHours) {
  const extra = Math.max(0, Number(extraHours) || 0);
  return Math.floor(extra / HOURS_STEP);
}
