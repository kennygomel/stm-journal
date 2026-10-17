// endpoints/updateTrip.js — правка своей записи.
import { requireUser } from '../lib/auth.js';
import { updateTrip } from '../lib/trips.js';

export default async function (input, ctx) {
  const user = await requireUser(ctx);
  const trip = await updateTrip(user, input);
  return { trip };
}
