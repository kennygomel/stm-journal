// endpoints/listTrips.js — записи журнала за промежуток.
import { requireUser } from '../lib/auth.js';
import { listTrips, toTripDto } from '../lib/trips.js';
import { isIsoDate, parseInteger } from '../lib/format.js';

export default async function (input, ctx) {
  const user = await requireUser(ctx);
  const range = {
    from: isIsoDate(input?.from) ? input.from : null,
    to: isIsoDate(input?.to) ? input.to : null,
  };
  const limit = parseInteger(input?.limit, { min: 1, max: 1000 }) || 500;
  const rows = await listTrips(user.id, range, { limit });
  return { range, trips: rows.map(toTripDto) };
}
