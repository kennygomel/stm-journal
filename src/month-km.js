// src/month-km.js — месячная доплата за пробег водителя.
//
// Правило живёт и на сервере (tgcloud/lib/calc.js). Модули tgcloud/ не видят src/,
// поэтому значения продублированы; совпадение проверяет тест.
//
// Свыше 10 000 км за календарный месяц — по 1 копейке за каждый километр сверх
// лимита. Считается по журналу КОНКРЕТНОГО водителя, а не по сумме всех.

export const MONTH_KM_FREE = 10000;
export const MONTH_KM_RATE = 1; // копеек за километр

/** Доплата за месячный пробег в копейках. */
export function monthKmBonusFor(distance) {
  const km = Math.max(0, Math.floor(Number(distance) || 0));
  return Math.max(0, km - MONTH_KM_FREE) * MONTH_KM_RATE;
}
