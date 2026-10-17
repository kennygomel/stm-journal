// endpoints/adminUsers.js — заявки на доступ и права (только админ).
import { EndpointError } from 'sdk';
import { requireOwner } from '../lib/auth.js';
import { listUsers, setRole, setStatus } from '../lib/users.js';

export default async function (input, ctx) {
  const owner = await requireOwner(ctx);
  const action = String(input?.action || 'list');

  if (action === 'list') {
    return { users: await listUsers() };
  }
  if (action === 'setStatus') {
    return { user: await setStatus(owner, input) };
  }
  if (action === 'setRole' || action === 'setAdmin') {
    return { user: await setRole(owner, input) };
  }
  throw new EndpointError(`Неизвестное действие: ${action}`, { code: 'BAD_ACTION' });
}
