// lib/leaderboard.js — недельный лидерборд и призы.
//
// Неделя — с понедельника по воскресенье включительно, время Минска (UTC+3).
// Итоги «в ночь с воскресенья на понедельник»: планировщика на платформе нет,
// поэтому итоги подводит первый запрос после полуночи понедельника
// (ensureWeeklyAwards) — и дальше они уже лежат в базе как призы.

import { db, EndpointError } from 'sdk';
import { and, asc, eq, gte, inArray, lte } from 'sdk/db';
import { awards, trips, users } from '../schema.js';
import { todayIso } from './format.js';

/** Минск: UTC+3 круглый год, переходов на летнее время нет. */
export const TZ_OFFSET_MINUTES = 180;

/** Номинации лидерборда: id, подпись и единица измерения. */
export const CATEGORIES = [
  { id: 'income', label: 'Доход', unit: 'money' },
  { id: 'points', label: 'Точки', unit: 'count' },
  { id: 'distance', label: 'Пробег', unit: 'km' },
  { id: 'hours', label: 'Время', unit: 'hours' },
];

/** Призы за места: 1 — банан, 2 — клоун, 3 — петух. */
export const PLACE_PRIZES = { 1: '🍌', 2: '🤡', 3: '🐔' };

export const PRIZE_PLACES = [1, 2, 3];

/** «YYYY-MM-DD» ± дни. */
export function addDays(isoDate, days) {
  const [y, m, d] = String(isoDate).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Понедельник недели, в которую попадает дата. */
export function weekStartOf(isoDate) {
  const [y, m, d] = String(isoDate).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const shift = (date.getUTCDay() + 6) % 7; // 0 — понедельник
  return addDays(isoDate, -shift);
}

/** Текущая дата в Минске. */
export function todayMinsk() {
  return todayIso(TZ_OFFSET_MINUTES);
}

/** Диапазон недели: { from, to } по датам включительно. */
export function weekRange(weekStart) {
  return { from: weekStart, to: addDays(weekStart, 6) };
}

/** Собирает показатели пользователей за диапазон дат. */
export async function collectWeek(from, to) {
  const rows = await db
    .select()
    .from(trips)
    .where(and(gte(trips.tripDate, from), lte(trips.tripDate, to)))
    .all();

  const byUser = new Map();
  for (const row of rows) {
    const bucket = byUser.get(row.userId) || {
      userId: row.userId,
      income: 0,
      points: 0,
      distance: 0,
      hours: 0,
      trips: 0,
    };
    bucket.income += row.income || 0;
    bucket.points += row.points || 0;
    bucket.distance += row.distance || 0;
    bucket.hours += row.hours || 0;
    bucket.trips += 1;
    byUser.set(row.userId, bucket);
  }
  return [...byUser.values()];
}

/**
 * Рейтинг по номинации: сортировка по значению, затем по userId —
 * чтобы при равенстве порядок был предсказуемым.
 */
export function rankCategory(rows, categoryId, limit = 10) {
  return rows
    .map((row) => ({ ...row, value: row[categoryId] || 0 }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value || a.userId - b.userId)
    .slice(0, limit)
    .map((row, index) => ({ ...row, place: index + 1, prize: PLACE_PRIZES[index + 1] || null }));
}

/**
 * Имена для списков: одним запросом, чтобы не ходить в базу на каждого.
 */
async function namesByIds(ids) {
  if (!ids.length) return new Map();
  const rows = await db.select().from(users).where(inArray(users.id, ids)).all();
  return new Map(
    rows.map((row) => [
      row.id,
      {
        name: [row.firstName, row.lastName].filter(Boolean).join(' ') || row.username || `ID ${row.tgId}`,
        username: row.username || null,
      },
    ]),
  );
}

/**
 * Подводит итоги завершившейся недели, если их ещё нет.
 * Идемпотентно: повторный вызов ничего не дублирует.
 * @returns {{ weekStart: string, created: number }}
 */
export async function ensureWeeklyAwards(now = todayMinsk()) {
  const lastWeekStart = addDays(weekStartOf(now), -7);
  const existing = await db.select().from(awards).where(eq(awards.weekStart, lastWeekStart)).all();
  if (existing.length) return { weekStart: lastWeekStart, created: 0 };

  const { from, to } = weekRange(lastWeekStart);
  const rows = await collectWeek(from, to);
  if (!rows.length) return { weekStart: lastWeekStart, created: 0 };

  const created = [];
  for (const category of CATEGORIES) {
    const winners = rankCategory(rows, category.id, PRIZE_PLACES.length).filter((row) => row.place <= 3);
    for (const winner of winners) {
      created.push({
        userId: winner.userId,
        weekStart: lastWeekStart,
        category: category.id,
        place: winner.place,
        value: winner.value,
      });
    }
  }
  if (created.length) {
    // Два параллельных запроса могли одновременно решить подвести итоги:
    // уникальный индекс не даст задвоить призы, второй просто уступает.
    await db
      .insert(awards)
      .values(created)
      .onConflictDoNothing()
      .run()
      .catch(() => {});
  }
  return { weekStart: lastWeekStart, created: created.length };
}

/** Призы пользователя: [{ category, place, weekStart, value, prize }]. */
export async function awardsOf(userId) {
  const rows = await db.select().from(awards).where(eq(awards.userId, userId)).orderBy(asc(awards.weekStart)).all();
  return rows.map((row) => ({ ...row, prize: PLACE_PRIZES[row.place] || null }));
}

/** Сводка призов по всем пользователям: Map<userId, ['🍌','🐔', …]>. */
export async function prizeBadgesByUser(ids = null) {
  const rows = ids?.length
    ? await db.select().from(awards).where(inArray(awards.userId, ids)).all()
    : await db.select().from(awards).all();
  const map = new Map();
  for (const row of rows) {
    const badge = PLACE_PRIZES[row.place];
    if (!badge) continue;
    const list = map.get(row.userId) || [];
    list.push(badge);
    map.set(row.userId, list);
  }
  return map;
}

/**
 * Данные экрана «Рейтинг»: текущая неделя по номинациям, итоги прошлой недели
 * и личные призы пользователя.
 */
export async function leaderboardData(userId) {
  const today = todayMinsk();
  const currentStart = weekStartOf(today);
  const { weekStart: lastStart, created } = await ensureWeeklyAwards(today);

  const currentRange = weekRange(currentStart);
  const currentRows = await collectWeek(currentRange.from, today);
  const currentIds = currentRows.map((row) => row.userId);
  const currentNames = await namesByIds(currentIds);

  const categories = CATEGORIES.map((category) => ({
    ...category,
    rows: rankCategory(currentRows, category.id, 5).map((row) => ({
      userId: row.userId,
      place: row.place,
      prize: row.prize,
      value: row.value,
      trips: row.trips,
      name: currentNames.get(row.userId)?.name || `ID ${row.userId}`,
      username: currentNames.get(row.userId)?.username || null,
    })),
  }));

  const lastAwards = await db.select().from(awards).where(eq(awards.weekStart, lastStart)).all();
  const lastNames = await namesByIds([...new Set(lastAwards.map((row) => row.userId))]);
  const lastWeek = {
    weekStart: lastStart,
    ...weekRange(lastStart),
    created,
    categories: CATEGORIES.map((category) => ({
      ...category,
      rows: lastAwards
        .filter((row) => row.category === category.id)
        .sort((a, b) => a.place - b.place)
        .map((row) => ({
          userId: row.userId,
          place: row.place,
          prize: PLACE_PRIZES[row.place] || null,
          value: row.value,
          name: lastNames.get(row.userId)?.name || `ID ${row.userId}`,
          username: lastNames.get(row.userId)?.username || null,
        })),
    })),
  };

  const mine = await awardsOf(userId);
  const myPrizes = mine.map((row) => row.prize).filter(Boolean);

  return {
    today,
    week: { weekStart: currentStart, ...currentRange, endsAt: addDays(currentStart, 6) },
    categories,
    lastWeek,
    myPrizes,
    myAwards: mine.map((row) => ({
      weekStart: row.weekStart,
      category: row.category,
      place: row.place,
      value: row.value,
      prize: row.prize,
    })),
  };
}

/** Проверка номинации (для будущих вызовов). */
export function categoryById(id) {
  const category = CATEGORIES.find((row) => row.id === id);
  if (!category) throw new EndpointError('Неизвестная номинация.', { code: 'BAD_CATEGORY' });
  return category;
}
