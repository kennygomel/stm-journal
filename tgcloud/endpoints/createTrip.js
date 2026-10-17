// endpoints/createTrip.js — новая запись журнала (доход считает сервер).
import { requireUser } from '../lib/auth.js';
import { createTrip } from '../lib/trips.js';

export default async function (input, ctx) {
  const user = await requireUser(ctx);
  const trip = await createTrip(user, input);
  return { trip };
}
