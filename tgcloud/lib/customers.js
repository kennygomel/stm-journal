// lib/customers.js — справочник заказчиков: только название и своя базовая ставка.
// Все доплаты (точки, километры, часы) — глобальные, в lib/settings.js.
// Справочник ведут админы, в том числе не-владельцы.

import { db, EndpointError } from 'sdk';
import { asc, eq } from 'sdk/db';
import { customers } from '../schema.js';
import { getSettings } from './calc.js';
import { parseInteger, rublesToKopecks } from './format.js';

/** Пустая ставка → null («взять глобальную»); отсутствие поля → undefined. */
function parseBaseRate(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const kopecks = rublesToKopecks(value, { min: 0, max: 100000000 });
  if (kopecks === null) {
    throw new EndpointError('Базовая ставка: укажите сумму в рублях, например 120', { code: 'BAD_RATE' });
  }
  return kopecks;
}

function parseName(value) {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 2) throw new EndpointError('Название заказчика — минимум 2 символа.', { code: 'BAD_NAME' });
  if (name.length > 120) throw new EndpointError('Название заказчика — не более 120 символов.', { code: 'BAD_NAME' });
  return name;
}

export async function listCustomers({ includeInactive = true } = {}) {
  const rows = await db.select().from(customers).orderBy(asc(customers.name)).all();
  return includeInactive ? rows : rows.filter((row) => row.active);
}

export async function getCustomer(id) {
  const customerId = parseInteger(id, { min: 1, max: 1e9 });
  if (!customerId) throw new EndpointError('Некорректный заказчик.', { code: 'BAD_CUSTOMER' });
  const row = await db.select().from(customers).where(eq(customers.id, customerId)).get();
  if (!row) throw new EndpointError('Заказчик не найден.', { code: 'CUSTOMER_NOT_FOUND' });
  return row;
}

/** DTO для Mini App: название и действующая базовая ставка. */
export async function toCustomerDto(row, global) {
  const base = global || (await getSettings());
  const own = row.baseRate === undefined ? null : row.baseRate;
  return {
    id: row.id,
    name: row.name,
    active: Boolean(row.active),
    baseRate: own === null ? base.baseRate : own, // действующая
    ownBaseRate: own, // null → берётся глобальная
    globalBaseRate: base.baseRate,
  };
}

export async function listCustomerDtos(options) {
  const [rows, global] = await Promise.all([listCustomers(options), getSettings()]);
  return Promise.all(rows.map((row) => toCustomerDto(row, global)));
}

export async function createCustomer(admin, input) {
  const name = parseName(input?.name);
  const baseRate = parseBaseRate(input?.baseRate);
  const rows = await db
    .insert(customers)
    .values({
      name,
      ...(baseRate === undefined ? {} : { baseRate }),
      active: input?.active === false ? false : true,
      updatedBy: admin.id,
    })
    .returning();
  return toCustomerDto(rows[0]);
}

export async function updateCustomer(admin, input) {
  const row = await getCustomer(input?.id);
  const patch = { updatedAt: new Date(), updatedBy: admin.id };
  if (input?.name !== undefined) patch.name = parseName(input.name);
  if (input?.active !== undefined) patch.active = Boolean(input.active);
  const baseRate = parseBaseRate(input?.baseRate);
  if (baseRate !== undefined) patch.baseRate = baseRate;
  const rows = await db.update(customers).set(patch).where(eq(customers.id, row.id)).returning();
  return toCustomerDto(rows[0]);
}

/**
 * Удаление заказчика. Записи журнала остаются — в них хранится снимок имени
 * и тарифов, поэтому история не ломается.
 */
export async function deleteCustomer(id) {
  const row = await getCustomer(id);
  await db.delete(customers).where(eq(customers.id, row.id)).run();
  return { id: row.id, name: row.name };
}
