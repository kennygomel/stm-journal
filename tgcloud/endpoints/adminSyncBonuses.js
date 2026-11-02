// endpoints/adminSyncBonuses.js — пересчёт ТОЛЬКО месячных доплат (владелец).
//
// Нужен после изменения правил доплат: доход рейсов не трогаем, а заново
// раскладываем доплаты за дни и за месячный пробег по журналам водителей.
// Возвращает, сколько месяцев пересчитано.

import { db, EndpointError } from 'sdk';
import { and, gte, lte } from 'sdk/db';
import { trips } from '../schema.js';
import { requireOwner } from '../lib/auth.js';
import { isIsoDate } from '../lib/format.js';
import { monthOf } from '../lib/calc.js';
import { syncMonthBonuses } from '../lib/trips.js';

export default async function (input, ctx) {
  await requireOwner(ctx);
  const from = isIsoDate(input?.from) ? input.from : null;
  const to = isIsoDate(input?.to) ? input.to : null;
  if (!from || !to) {
    throw new EndpointError('Укажите период: from и to в формате YYYY-MM-DD', { code: 'BAD_RANGE' });
  }
  if (from > to) throw new EndpointError('Начало периода позже конца', { code: 'BAD_RANGE' });

  const rows = await db
    .select({ userId: trips.userId, tripDate: trips.tripDate })
    .from(trips)
    .where(and(gte(trips.tripDate, from), lte(trips.tripDate, to)))
    .all();

  const pairs = new Map();
  for (const row of rows) {
    const month = monthOf(row.tripDate);
    if (month) pairs.set(`${row.userId}:${month}`, { userId: row.userId, month });
  }

  let updated = 0;
  let daysBonus = 0;
  let monthKmBonus = 0;
  for (const { userId, month } of pairs.values()) {
    const result = await syncMonthBonuses(userId, month);
    daysBonus += result.daysBonus || 0;
    monthKmBonus += result.monthKmBonus || 0;
    updated += 1;
  }
  return { months: updated, daysBonus, monthKmBonus };
}
