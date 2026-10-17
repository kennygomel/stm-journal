// endpoints/adminCustomers.js — справочник заказчиков (владелец и админ).
import { EndpointError } from 'sdk';
import { requireAdmin } from '../lib/auth.js';
import { createCustomer, deleteCustomer, listCustomerDtos, updateCustomer } from '../lib/customers.js';
import { getSettings } from '../lib/calc.js';

export default async function (input, ctx) {
  const admin = await requireAdmin(ctx);
  const action = String(input?.action || 'list');

  if (action === 'list') {
    const [customers, settings] = await Promise.all([listCustomerDtos(), getSettings()]);
    return { customers, settings };
  }
  if (action === 'create') {
    return { customer: await createCustomer(admin, input?.customer || input) };
  }
  if (action === 'update') {
    return { customer: await updateCustomer(admin, input?.customer || input) };
  }
  if (action === 'delete') {
    return { deleted: await deleteCustomer(input?.id ?? input?.customer?.id) };
  }
  throw new EndpointError(`Неизвестное действие: ${action}`, { code: 'BAD_ACTION' });
}
