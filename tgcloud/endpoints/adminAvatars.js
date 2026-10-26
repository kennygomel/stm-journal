// endpoints/adminAvatars.js — догрузка аватаров для админских списков.
//
// Список пользователей отдаётся сразу из базы (без сети), а фото подтягиваются
// этим вызовом: так экран не ждёт Bot API. Только владелец.

import { db } from 'sdk';
import { users } from '../schema.js';
import { requireOwner } from '../lib/auth.js';
import { avatarNeedsRefresh, refreshUserPhoto } from '../lib/avatars.js';

/** Сколько пользователей догружаем за один вызов — чтобы не упереться в лимиты. */
const BATCH = 20;

export default async function (input, ctx) {
  await requireOwner(ctx);
  const before = await db.select().from(users).all();
  const stale = before.filter(avatarNeedsRefresh).slice(0, BATCH);
  for (const row of stale) await refreshUserPhoto(row);

  // Отдаём ВСЕ сохранённые фото, а не только что скачанные: иначе уже
  // загруженные аватары не доходили до интерфейса и все выглядели одинаково.
  const rows = stale.length ? await db.select().from(users).all() : before;
  const avatars = rows.map((row) => ({ id: row.id, photo: row.photo || null }));
  const remaining = rows.filter((row) => avatarNeedsRefresh(row)).length;
  return { avatars, remaining };
}
