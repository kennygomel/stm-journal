// endpoints/adminRecalc.js — пересчёт записей за период по действующим тарифам.
// Только владелец: операция меняет уже сохранённые суммы.
import { EndpointError } from 'sdk';
import { requireOwner } from '../lib/auth.js';
import { recalculateTrips } from '../lib/trips.js';
import { isIsoDate, parseInteger } from '../lib/format.js';

export default async function (input, ctx) {
  await requireOwner(ctx);

  const range = {
    from: isIsoDate(input?.from) ? input.from : null,
    to: isIsoDate(input?.to) ? input.to : null,
  };
  if (!range.from && !range.to) {
    throw new EndpointError('Выберите период пересчёта.', { code: 'BAD_RANGE' });
  }

  // Без userId пересчитываем все журналы — так запоздалое обновление тарифов
  // применяется сразу ко всем, а не только к журналу владельца.
  const userId = input?.userId === undefined || input?.userId === null
    ? null
    : parseInteger(input.userId, { min: 1, max: 1e9 });
  if (input?.userId !== undefined && input?.userId !== null && !userId) {
    throw new EndpointError('Некорректный пользователь.', { code: 'BAD_USER' });
  }

  return recalculateTrips(range, { userId, apply: input?.apply === true });
}
