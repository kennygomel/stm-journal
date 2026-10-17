// lib/config.js — project-wide constants, including the owner list.

/**
 * Telegram user ids of the ВЛАДЕЛЕЦ (owner). Only owners may edit global
 * tariffs and manage users/admins; ordinary admins only keep the customer list.
 * The owner of this bot is 323173181.
 *
 * Deploy-time variables (tgcloud.jsonc → "vars") win when ADMIN_IDS is set,
 * so the list can be changed without editing this file.
 */
function configuredOwnerIds() {
  let raw = '';
  try {
    raw = (import.meta.env && import.meta.env.ADMIN_IDS) || '';
  } catch {
    raw = '';
  }
  const ids = String(raw)
    .split(/[,\s]+/)
    .map((part) => Number(part))
    .filter((id) => Number.isSafeInteger(id) && id !== 0);
  return ids.length ? ids : [323173181];
}

export const OWNER_IDS = configuredOwnerIds();

/** @deprecated оставлено для совместимости: список владельцев. */
export const ADMIN_IDS = OWNER_IDS;

/** URL of the deployed Mini App. `npx tgcloud push` prints it on static deploy. */
export const MINI_APP_URL = 'https://app8888287323.tgcloud.ai/';

export const USER_STATUS = {
  pending: 'pending',
  approved: 'approved',
  denied: 'denied',
  blocked: 'blocked',
};

export const CALLBACK = {
  approve: 'usr:ok',
  deny: 'usr:no',
};

/** Права в Mini App. */
export const PERMISSION = {
  journal: 'journal', // свой журнал
  customers: 'customers', // справочник заказчиков
  tariffs: 'tariffs', // глобальные доплаты
  users: 'users', // пользователи и админы
};
