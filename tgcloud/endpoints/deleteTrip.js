// endpoints/deleteTrip.js — удаление своей записи.
import { requireUser } from '../lib/auth.js';
import { deleteTrip } from '../lib/trips.js';

export default async function (input, ctx) {
  const user = await requireUser(ctx);
  return deleteTrip(user, input?.id);
}
