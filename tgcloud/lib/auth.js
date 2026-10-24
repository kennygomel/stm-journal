// tgcloud/lib/auth.js — доступ пользователей, роли (владелец / админ) и уведомления.

import { db, api, EndpointError } from 'sdk';
import { eq } from 'sdk/db';
import { users } from '../schema.js';
import { MINI_APP_URL, OWNER_IDS, USER_STATUS } from './config.js';
import { ensureRequestNotified } from './notify.js';

export const ACCESS_DENIED_TEXT = {
  pending: '⏳ Ваш запрос на доступ ещё на рассмотрении. Я сообщу, как только админ ответит.',
  denied: '🚫 Доступ к журналу отклонён администратором.',
  blocked: '🚫 Доступ к журналу заблокирован администратором.',
};

/** Владелец — полный доступ. */
export function isOwnerRow(row) {
  return Boolean(row && (row.isOwner || OWNER_IDS.includes(Number(row.tgId))));
}

/** Админ — доступ к справочнику заказчиков. Владелец тоже админ. */
export function isAdminRow(row) {
  return Boolean(row && (isOwnerRow(row) || row.isAdmin));
}

/** Права для Mini App. */
export function permissionsOf(row) {
  const owner = isOwnerRow(row);
  const admin = isAdminRow(row);
  return {
    journal: true,
    customers: admin,
    tariffs: owner,
    users: owner,
  };
}

export async function findUser(tgId) {
  return db.select().from(users).where(eq(users.tgId, Number(tgId))).get();
}

/** Поиск по первичному ключу (users.id), а не по telegram id. */
export async function findUserById(id) {
  return db.select().from(users).where(eq(users.id, Number(id))).get();
}

/**
 * Создаёт или обновляет профиль и запоминает чат для уведомлений.
 * Возвращает { user, created }.
 */
export async function upsertUser(from, chatId) {
  const tgId = Number(from.id);
  const existing = await findUser(tgId);
  const patch = {
    chatId: chatId ? Number(chatId) : existing?.chatId ?? tgId,
    username: from.username || existing?.username || null,
    firstName: from.first_name || existing?.firstName || null,
    lastName: from.last_name || existing?.lastName || null,
    lastSeenAt: new Date(),
  };
  if (existing) {
    await db.update(users).set(patch).where(eq(users.id, existing.id)).run();
    return { user: { ...existing, ...patch }, created: false };
  }
  const owner = OWNER_IDS.includes(tgId);
  const inserted = await db
    .insert(users)
    .values({
      tgId,
      status: owner ? USER_STATUS.approved : USER_STATUS.pending,
      isAdmin: owner,
      isOwner: owner,
      ...patch,
    })
    .returning();
  return { user: inserted[0], created: true };
}

/** Ошибка доступа для Mini App. */
function deny(row) {
  const status = row?.status || USER_STATUS.pending;
  throw new EndpointError(ACCESS_DENIED_TEXT[status] || ACCESS_DENIED_TEXT.pending, {
    code: 'ACCESS_DENIED',
    status,
  });
}

/**
 * Пользователь Mini App по проверенным данным Telegram.
 * Бросает EndpointError, если доступ не одобрен.
 */
export async function requireUser(ctx) {
  const from = ctx?.initData?.user;
  if (!from?.id) {
    throw new EndpointError('Не удалось определить пользователя Telegram', { code: 'NO_USER' });
  }
  const row = await findUser(from.id);
  if (!row) {
    // Первый заход в Mini App до /start в боте — тоже регистрируем заявку
    // и уведомляем админов: раньше этот путь проходил молча.
    const { user } = await upsertUser(from, from.id);
    if (isAdminRow(user)) return user;
    try {
      await ensureRequestNotified(user);
    } catch (error) {
      console.warn('admin notify failed', { reason: error?.description || String(error) });
    }
    deny(user);
  }
  if (row.status !== USER_STATUS.approved) deny(row);
  return row;
}

/** Справочник заказчиков: владелец и админ. */
export async function requireAdmin(ctx) {
  const row = await requireUser(ctx);
  if (!isAdminRow(row)) {
    throw new EndpointError('Недостаточно прав: раздел только для администратора', {
      code: 'FORBIDDEN',
    });
  }
  return row;
}

/** Тарифы и управление пользователями: только владелец. */
export async function requireOwner(ctx) {
  const row = await requireUser(ctx);
  if (!isOwnerRow(row)) {
    throw new EndpointError('Этот раздел доступен только владельцу журнала', {
      code: 'OWNER_ONLY',
    });
  }
  return row;
}

/** Уведомление пользователю; false — если бот заблокирован пользователем. */
/** Кнопка «открыть журнал» для сообщений бота. */
export function appButton(text = '📔 Открыть журнал') {
  return { inline_keyboard: [[{ text, web_app: { url: MINI_APP_URL } }]] };
}

/** Разрешённые значения темы. */
export const THEMES = ['light', 'dark', 'system'];

export function normalizeTheme(value) {
  const theme = String(value ?? '').toLowerCase();
  return THEMES.includes(theme) ? theme : null;
}

/** Сохраняет выбранную тему за пользователем. */
export async function setUserTheme(userId, theme) {
  await db
    .update(users)
    .set({ theme: normalizeTheme(theme) })
    .where(eq(users.id, Number(userId)))
    .run();
}

export async function setUserStatus(userId, status, adminId) {
  await db
    .update(users)
    .set({
      status,
      approvedAt: status === USER_STATUS.approved ? new Date() : null,
      approvedBy: adminId ?? null,
    })
    .where(eq(users.id, Number(userId)))
    .run();
}
