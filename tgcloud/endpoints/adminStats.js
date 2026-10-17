// endpoints/adminStats.js — сводка для дашборда админки (только владелец).
import { requireOwner } from '../lib/auth.js';
import { dashboardStats } from '../lib/trips.js';
import { isIsoDate } from '../lib/format.js';
import { todayIso } from '../lib/format.js';

export default async function (input, ctx) {
  await requireOwner(ctx);
  const today = todayIso(input?.tzOffsetMinutes);
  const from = isIsoDate(input?.from) ? input.from : `${today.slice(0, 7)}-01`;
  const to = isIsoDate(input?.to) ? input.to : today;
  return dashboardStats({ from, to });
}
