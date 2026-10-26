// lib/users.js — админские операции со списком пользователей.

import { db, EndpointError } from 'sdk';
import { desc, eq } from 'sdk/db';
import { trips, users } from '../schema.js';
import { MINI_APP_URL, USER_STATUS } from './config.js';
import { displayName } from './format.js';
import { isAdminRow, isOwnerRow, setUserStatus } from './auth.js';
import { ensureWeeklyAwards, prizeBadgesByUser } from './leaderboard.js';
import { notifyUser } from './notify.js';

/** Даты отдаём строкой: в JSON они всё равно станут ISO, а так предсказуемо. */
function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function toUserDto(row) {
  return {
    id: row.id,
    tgId: row.tgId,
    username: row.username,
    name: displayName(row),
    status: row.status,
    isAdmin: isAdminRow(row),
    isOwner: isOwnerRow(row),
    createdAt: toIso(row.createdAt),
    approvedAt: toIso(row.approvedAt),
    lastSeenAt: toIso(row.lastSeenAt),
  };
}

export async function listUsers() {
  // Заодно подводим итоги завершившейся недели, если понедельник уже наступил.
  await ensureWeeklyAwards().catch(() => {});
  const rows = await db.select().from(users).orderBy(desc(users.createdAt)).all();
  const badges = await prizeBadgesByUser(rows.map((row) => row.id)).catch(() => new Map());
  const rank = { pending: 0, approved: 1, blocked: 2, denied: 3 };
  return rows
    .map((row) => ({ ...toUserDto(row), prizes: badges.get(row.id) || [] }))
    .sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || b.id - a.id);
}

/**
 * Применяет решение админа: уведомляет пользователя и обновляет статус.
 * Отклонение заявки удаляет пользователя и весь его журнал — «отклонить»
 * значит «здесь такого человека нет», а не «пусть висит в списке».
 */
export async function applyStatus(admin, target, status) {
  if (!target) throw new EndpointError('Пользователь не найден.', { code: 'USER_NOT_FOUND' });
  if (isOwnerRow(target) && status !== USER_STATUS.approved) {
    throw new EndpointError('Нельзя закрыть доступ владельцу журнала.', { code: 'OWNER_LOCK' });
  }

  // Сообщаем до удаления: после удаления строки не останется chatId.
  if (target.status !== status) await notifyStatusChange(target, status);

  if (status === USER_STATUS.denied) {
    await db.delete(trips).where(eq(trips.userId, target.id)).run();
    await db.delete(users).where(eq(users.id, target.id)).run();
    return { ...toUserDto({ ...target, status }), deleted: true };
  }

  await setUserStatus(target.id, status, admin?.id ?? null);
  return toUserDto({ ...target, status });
}

export async function setStatus(admin, input) {
  const userId = Number(input?.userId);
  const status = String(input?.status ?? '');
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new EndpointError('Некорректный пользователь.', { code: 'BAD_USER' });
  }
  if (!Object.values(USER_STATUS).includes(status)) {
    throw new EndpointError('Некорректный статус.', { code: 'BAD_STATUS' });
  }
  const target = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!target) throw new EndpointError('Пользователь не найден.', { code: 'USER_NOT_FOUND' });
  return applyStatus(admin, target, status);
}

/** Сообщает пользователю о решении админа (в т.ч. из панели Mini App). */
async function notifyStatusChange(target, status) {
  if (target.status === status) return;
  if (status === USER_STATUS.approved) {
    await notifyUser(
      target,
      ['✅ <b>Доступ к журналу рейсов открыт!</b>', '', 'Открывайте Mini App и вносите рейсы: дата, заказчик, точки, пробег.'].join(
        '\n',
      ),
      { reply_markup: { inline_keyboard: [[{ text: '📔 Открыть журнал', web_app: { url: MINI_APP_URL } }]] } },
    );
    return;
  }
  if (status === USER_STATUS.denied) {
    await notifyUser(target, '🚫 Администратор отклонил доступ к журналу рейсов.');
    return;
  }
  if (status === USER_STATUS.blocked) {
    await notifyUser(target, '🚫 Доступ к журналу рейсов закрыт администратором.');
  }
}

/**
 * Выдать/снять права. Владельца из config нельзя разжаловать.
 * Роли: owner (полный доступ) · admin (только заказчики) · обычный пользователь.
 */
export async function setRole(admin, input) {
  const userId = Number(input?.userId);
  const role = String(input?.role ?? (input?.isAdmin ? 'admin' : 'user'));
  if (!['owner', 'admin', 'user'].includes(role)) {
    throw new EndpointError('Некорректная роль.', { code: 'BAD_ROLE' });
  }
  const target = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!target) throw new EndpointError('Пользователь не найден.', { code: 'USER_NOT_FOUND' });
  if (isOwnerRow(target) && role !== 'owner') {
    throw new EndpointError('Нельзя снять права владельца журнала.', { code: 'OWNER_LOCK' });
  }
  if (target.id === admin.id && role !== 'owner') {
    throw new EndpointError('Нельзя снять права у самого себя.', { code: 'SELF_LOCK' });
  }
  const patch = { isOwner: role === 'owner', isAdmin: role !== 'user' };
  await db.update(users).set(patch).where(eq(users.id, target.id)).run();
  return toUserDto({ ...target, ...patch });
}

/** Сколько ждёт одобрения — для бейджа в админке. */
export async function pendingCount() {
  const rows = await db.select().from(users).where(eq(users.status, USER_STATUS.pending)).all();
  return rows.length;
}
