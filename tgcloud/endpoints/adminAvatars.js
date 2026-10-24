// endpoints/adminAvatars.js — догрузка аватаров для админских списков.
//
// Список пользователей отдаётся сразу из базы (без сети), а фото подтягиваются
// этим вызовом: так экран не ждёт Bot API. Только владелец.

import { db } from 'sdk';
import { users } from '../schema.js';
import { requireOwner } from '../lib/auth.js';
import { avatarNeedsRefresh, refreshUserPhoto } from '../lib/avatars.js';

/** Сколько пользователей догружаем за один вызов — чтобы не упереться в лимиты. */
const BATCH = 8;

export default async function (input, ctx) {
  await requireOwner(ctx);
  const rows = await db.select().from(users).all();
  const stale = rows.filter(avatarNeedsRefresh).slice(0, BATCH);

  const avatars = [];
  for (const row of stale) {
    const photo = await refreshUserPhoto(row);
    avatars.push({ id: row.id, photo: photo || null });
  }
  const remaining = rows.filter((row) => avatarNeedsRefresh(row)).length - stale.length;
  return { avatars, remaining: Math.max(0, remaining) };
}
