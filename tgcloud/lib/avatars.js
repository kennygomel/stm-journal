// lib/avatars.js — фото профиля Telegram для списков и дашборда.
//
// Клиенту нельзя отдавать токен бота, поэтому сервер сам скачивает байты
// (api.getFileContent) и хранит маленький data URL прямо в строке пользователя.
// Обновляем не чаще раза в неделю: фото меняется редко, а лишние запросы
// к Bot API ни к чему.

import { api } from 'sdk';
import { db } from 'sdk';
import { eq } from 'sdk/db';
import { users } from '../schema.js';

/** Больше этого не сохраняем: аватар в списке и так рисуется 40×40. */
const MAX_BYTES = 400 * 1024;
/** Через сколько считаем фото устаревшим. */
const REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
/** Предпочтительный размер: ближе к 160 px, чтобы не тянуть 640. */
const TARGET_SIZE = 160;

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Uint8Array → base64 без Buffer (в изоляте его нет). */
export function toBase64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += BASE64_ALPHABET[a >> 2];
    out += BASE64_ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? '=' : BASE64_ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? '=' : BASE64_ALPHABET[c & 63];
  }
  return out;
}

/** Из набора размеров берём ближайший к TARGET_SIZE. */
export function pickPhotoSize(sizes) {
  if (!Array.isArray(sizes) || !sizes.length) return null;
  return sizes.reduce((best, size) => {
    if (!best) return size;
    const bestDelta = Math.abs((best.width || 0) - TARGET_SIZE);
    const sizeDelta = Math.abs((size.width || 0) - TARGET_SIZE);
    return sizeDelta < bestDelta ? size : best;
  }, null);
}

/** Пора ли перезапрашивать фото. */
export function avatarNeedsRefresh(row) {
  if (!row) return false;
  if (!row.photoUpdatedAt) return true;
  const updated = row.photoUpdatedAt instanceof Date ? row.photoUpdatedAt : new Date(row.photoUpdatedAt);
  if (Number.isNaN(updated.getTime())) return true;
  return Date.now() - updated.getTime() > REFRESH_AFTER_MS;
}

/**
 * Скачивает актуальное фото пользователя и сохраняет его в базе.
 * Молча возвращает null, если фото нет или Telegram не ответил.
 */
export async function refreshUserPhoto(row) {
  if (!row?.tgId || !row?.id) return null;
  try {
    const result = await api.getUserProfilePhotos({ user_id: Number(row.tgId), limit: 1 });
    const size = pickPhotoSize(result?.photos?.[0]);
    if (!size) {
      // Фото нет (или скрыто) — запоминаем попытку, чтобы не дёргать API каждый раз.
      await db.update(users).set({ photo: null, photoUpdatedAt: new Date() }).where(eq(users.id, row.id)).run();
      return null;
    }
    const bytes = await api.getFileContent(size.file_id);
    if (!bytes || !bytes.length || bytes.length > MAX_BYTES) return null;
    const photo = `data:image/jpeg;base64,${toBase64(bytes)}`;
    await db.update(users).set({ photo, photoUpdatedAt: new Date() }).where(eq(users.id, row.id)).run();
    return photo;
  } catch (error) {
    console.warn('avatar refresh failed', { tgId: row.tgId, reason: error?.description || String(error) });
    return null;
  }
}
