// endpoints/report.js — история и баланс за выбранный промежуток.
import { requireUser } from '../lib/auth.js';
import { report } from '../lib/trips.js';
import { isIsoDate, todayIso } from '../lib/format.js';

export default async function (input, ctx) {
  const user = await requireUser(ctx);
  const today = todayIso(input?.tzOffsetMinutes);
  const range = {
    from: isIsoDate(input?.from) ? input.from : null,
    to: isIsoDate(input?.to) ? input.to : null,
  };
  const data = await report(user.id, range);
  return { ...data, today };
}
