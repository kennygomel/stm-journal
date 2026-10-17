// lib/trips.js — записи журнала и отчёты.

import { db, EndpointError } from 'sdk';
import { and, asc, eq, gte, inArray, like, lte, sql } from 'sdk/db';
import { customers, trips, users as usersTable } from '../schema.js';
import { calcTrip, daysBonusFor, getSettings, monthOf, ratesSnapshot, resolveRates } from './calc.js';
import { displayName, isIsoDate, parseInteger } from './format.js';

/** Сериализация записи для Mini App (деньги — рубли). */
export function toTripDto(row) {
  return {
    id: row.id,
    date: row.tripDate,
    customerId: row.customerId,
    customerName: row.customerName,
    points: row.points,
    distance: row.distance,
    hours: row.hours,
    income: row.income,
    daysBonus: row.daysBonus || 0,
    rates: {
      baseRate: row.baseRate,
      pointsFree: row.pointsFree,
      pointRate: row.pointRate,
      kmFree: row.kmFree,
      kmRate: row.kmRate,
      hoursFree: row.hoursFree,
      hourRate: row.hourRate,
    },
  };
}

export function tripBreakdown(row) {
  const parts = calcTrip({
    baseRate: row.baseRate,
    points: row.points,
    distance: row.distance,
    hours: row.hours,
    pointsFree: row.pointsFree,
    pointRate: row.pointRate,
    kmFree: row.kmFree,
    kmRate: row.kmRate,
    hoursFree: row.hoursFree,
    hourRate: row.hourRate,
  });
  return { ...parts, customerName: row.customerName };
}

export function inRange(range) {
  const clauses = [];
  if (isIsoDate(range?.from)) clauses.push(gte(trips.tripDate, range.from));
  if (isIsoDate(range?.to)) clauses.push(lte(trips.tripDate, range.to));
  return clauses;
}

export async function listTrips(userId, range, { limit } = {}) {
  // userId = null означает «все журналы» (нужно дашборду владельца).
  const clauses = userId === null || userId === undefined ? inRange(range) : [eq(trips.userId, userId), ...inRange(range)];
  let query = db
    .select()
    .from(trips)
    .where(and(...clauses))
    .orderBy(asc(trips.tripDate), asc(trips.id));
  if (limit) query = query.limit(limit);
  return query.all();
}

/** Проверяет и нормализует входные данные формы записи. */
export function parseTripInput(input) {
  const date = String(input?.date ?? '').trim();
  if (!isIsoDate(date)) {
    throw new EndpointError('Некорректная дата. Ожидается формат YYYY-MM-DD.', { code: 'BAD_DATE' });
  }
  const customerId = parseInteger(input?.customerId, { min: 1, max: 1e9 });
  if (!customerId) {
    throw new EndpointError('Выберите заказчика.', { code: 'BAD_CUSTOMER' });
  }
  const points = parseInteger(input?.points ?? 0, { min: 0, max: 2000 });
  if (points === null) {
    throw new EndpointError('Количество точек — целое число от 0 до 2000.', { code: 'BAD_POINTS' });
  }
  const distance = parseInteger(input?.distance ?? 0, { min: 0, max: 100000 });
  if (distance === null) {
    throw new EndpointError('Пробег — целое число километров от 0 до 100 000.', { code: 'BAD_DISTANCE' });
  }
  const hours = parseInteger(input?.hours ?? 0, { min: 0, max: 720 });
  if (hours === null) {
    throw new EndpointError('Часы работы — целое число от 0 до 720.', { code: 'BAD_HOURS' });
  }
  return { date, customerId, points, distance, hours };
}

async function loadCustomer(customerId) {
  const row = await db.select().from(customers).where(eq(customers.id, customerId)).get();
  if (!row) {
    throw new EndpointError('Заказчик не найден. Возможно, он удалён — обновите список.', {
      code: 'CUSTOMER_NOT_FOUND',
    });
  }
  return row;
}

/** Считает доход для будущей записи (предпросмотр в форме Mini App). */
export async function previewTrip(input) {
  const parsed = parseTripInput(input);
  const [customer, global] = await Promise.all([loadCustomer(parsed.customerId), getSettings()]);
  const rates = resolveRates(customer, global);
  const breakdown = calcTrip({
    baseRate: rates.baseRate,
    points: parsed.points,
    distance: parsed.distance,
    hours: parsed.hours,
    pointsFree: rates.pointsFree,
    pointRate: rates.pointRate,
    kmFree: rates.kmFree,
    kmRate: rates.kmRate,
    hoursFree: rates.hoursFree,
    hourRate: rates.hourRate,
  });
  return { parsed, rates, breakdown, customer };
}

export async function createTrip(user, input) {
  const { parsed, rates, breakdown, customer } = await previewTrip(input);
  const values = {
    userId: user.id,
    tripDate: parsed.date,
    customerId: customer.id,
    points: parsed.points,
    distance: parsed.distance,
    hours: parsed.hours,
    income: breakdown.income,
    ...ratesSnapshot(customer.name, rates),
  };
  const inserted = await db.insert(trips).values(values).returning();
  // Доплата за дни месяца зависит от всех записей месяца — переставляем её.
  const global = await getSettings();
  await syncMonthDaysBonus(user.id, monthOf(parsed.date), global);
  const fresh = await db.select().from(trips).where(eq(trips.id, inserted[0].id)).get();
  return toTripDto(fresh || inserted[0]);
}

export async function updateTrip(user, input) {
  const id = parseInteger(input?.id, { min: 1, max: 1e9 });
  if (!id) throw new EndpointError('Не указан идентификатор записи.', { code: 'BAD_ID' });
  const existing = await db
    .select()
    .from(trips)
    .where(and(eq(trips.id, id), eq(trips.userId, user.id)))
    .get();
  if (!existing) {
    throw new EndpointError('Запись не найдена.', { code: 'TRIP_NOT_FOUND' });
  }
  const { parsed, rates, breakdown, customer } = await previewTrip(input);
  const rows = await db
    .update(trips)
    .set({
      tripDate: parsed.date,
      customerId: customer.id,
      points: parsed.points,
      distance: parsed.distance,
      hours: parsed.hours,
      income: breakdown.income,
      updatedAt: new Date(),
      ...ratesSnapshot(customer.name, rates),
    })
    .where(and(eq(trips.id, id), eq(trips.userId, user.id)))
    .returning();

  // Месяц мог смениться при правке даты — переставляем доплату за дни
  // и в старом, и в новом месяце.
  const global = await getSettings();
  const months = [...new Set([monthOf(parsed.date), monthOf(existing.tripDate)].filter(Boolean))];
  for (const month of months) await syncMonthDaysBonus(user.id, month, global);

  const fresh = await db.select().from(trips).where(eq(trips.id, id)).get();
  return toTripDto(fresh || rows[0]);
}

export async function deleteTrip(user, tripId) {
  const id = parseInteger(tripId, { min: 1, max: 1e9 });
  if (!id) throw new EndpointError('Не указан идентификатор записи.', { code: 'BAD_ID' });
  const existing = await db
    .select()
    .from(trips)
    .where(and(eq(trips.id, id), eq(trips.userId, user.id)))
    .get();
  if (!existing) {
    throw new EndpointError('Запись не найдена.', { code: 'TRIP_NOT_FOUND' });
  }
  await db.delete(trips).where(and(eq(trips.id, id), eq(trips.userId, user.id))).run();

  // Месяц мог лишиться последней записи — доплату за дни переставляем.
  const global = await getSettings();
  await syncMonthDaysBonus(user.id, monthOf(existing.tripDate), global);
  return { id };
}

/**
 * Отчёт за период: сумма дохода, количество рейсов, точки и пробег,
 * а также разбивка по заказчикам. Заказчики, удалённые из справочника,
 * всё равно попадают в отчёт — по снимку имени в записи.
 */
export async function report(userId, range) {
  const rows = await listTrips(userId, range);
  const global = await getSettings();
  const byCustomer = new Map();
  let income = 0;
  let daysBonus = 0;
  let points = 0;
  let distance = 0;
  let hours = 0;
  let extraPoints = 0;
  let extraKm = 0;
  let extraHours = 0;
  for (const row of rows) {
    const breakdown = tripBreakdown(row);
    income += row.income;
    daysBonus += row.daysBonus || 0;
    points += row.points;
    distance += row.distance;
    hours += row.hours;
    extraPoints += breakdown.extraPoints;
    extraKm += breakdown.extraKm;
    extraHours += breakdown.extraHours;
    const key = row.customerId;
    const bucket = byCustomer.get(key) || {
      customerId: row.customerId,
      customerName: row.customerName,
      trips: 0,
      points: 0,
      distance: 0,
      hours: 0,
      income: 0,
    };
    bucket.trips += 1;
    bucket.points += row.points;
    bucket.distance += row.distance;
    bucket.hours += row.hours;
    bucket.income += row.income;
    bucket.customerName = row.customerName;
    byCustomer.set(key, bucket);
  }
  const byCustomerList = [...byCustomer.values()].sort((a, b) => b.income - a.income);
  // Рабочие дни — по разным датам внутри периода.
  const workingDays = new Set(rows.map((row) => row.tripDate)).size;
  return {
    from: range?.from || null,
    to: range?.to || null,
    totals: {
      trips: rows.length,
      income,
      total: income + daysBonus,
      daysBonus,
      workingDays,
      daysMin: global.daysMin,
      daysRate: global.daysRate,
      points,
      distance,
      hours,
      extraPoints,
      extraKm,
      extraHours,
      avgIncome: rows.length ? Math.round(income / rows.length) : 0,
    },
    byCustomer: byCustomerList,
    byDate: buildByDate(rows),
  };
}

/** Сводка по дням (для графика/списка в отчёте). */
function buildByDate(rows) {
  const map = new Map();
  for (const row of rows) {
    const bucket = map.get(row.tripDate) || {
      date: row.tripDate,
      trips: 0,
      income: 0,
      points: 0,
      distance: 0,
      hours: 0,
    };
    bucket.trips += 1;
    bucket.income += row.income;
    bucket.points += row.points;
    bucket.distance += row.distance;
    bucket.hours += row.hours;
    map.set(row.tripDate, bucket);
  }
  return [...map.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** Используется админкой: сколько записей ссылается на заказчика. */
export async function countTripsForCustomers(customerIds) {
  if (!customerIds.length) return new Map();
  const rows = await db
    .select({ customerId: trips.customerId, n: sql`count(*)` })
    .from(trips)
    .where(inArray(trips.customerId, customerIds))
    .groupBy(trips.customerId)
    .all();
  return new Map(rows.map((row) => [row.customerId, row.n]));
}

/**
 * Сколько РАЗНЫХ дат рейсов было у пользователя в календарном месяце.
 * Одна дата — один рабочий день, независимо от числа рейсов.
 */
export async function workingDaysInMonth(userId, month) {
  const rows = await db
    .select({ date: trips.tripDate })
    .from(trips)
    .where(and(eq(trips.userId, userId), like(trips.tripDate, `${month}-%`)))
    .all();
  return new Set(rows.map((row) => row.date)).size;
}

/**
 * Проставляет доплату за дни месяца ровно одной записи — последней в месяце.
 * Остальные записи месяца получают 0, чтобы сумма не удваивалась.
 *
 * @returns {Promise<number>} сумма проставленной доплаты (0, если лимит не набран)
 */
export async function syncMonthDaysBonus(userId, month, global) {
  const rows = await db
    .select()
    .from(trips)
    .where(and(eq(trips.userId, userId), like(trips.tripDate, `${month}-%`)))
    .orderBy(asc(trips.tripDate), asc(trips.id))
    .all();
  if (!rows.length) return 0;

  const days = new Set(rows.map((row) => row.tripDate)).size;
  const bonus = daysBonusFor(days, global);
  const lastId = rows[rows.length - 1].id;

  await Promise.all(
    rows
      .filter((row) => (row.daysBonus || 0) !== (row.id === lastId ? bonus : 0))
      .map((row) =>
        db
          .update(trips)
          .set({ daysBonus: row.id === lastId ? bonus : 0 })
          .where(and(eq(trips.id, row.id), eq(trips.userId, userId)))
          .run(),
      ),
  );
  return bonus;
}

/** Пересчитывает доплату за дни во всех месяцах, которые пересекает диапазон. */
async function syncDaysBonusInRange(userId, range, global) {
  const clauses = [eq(trips.userId, userId), ...inRange(range)];
  const rows = await db.select({ date: trips.tripDate }).from(trips).where(and(...clauses)).all();
  const months = [...new Set(rows.map((row) => monthOf(row.tripDate)).filter(Boolean))];
  let total = 0;
  for (const month of months) total += await syncMonthDaysBonus(userId, month, global);
  return total;
}

/**
 * Пересчитывает записи за период по действующим тарифам.
 *
 * Нужен после запоздалого обновления тарифов или исправления ошибок в проде:
 * записи хранят снимок ставок, поэтому сами по себе не меняются.
 *
 * `userId` ограничивает пересчёт одним журналом; без него проходим по всем.
 * База берётся по заказчику записи; если заказчик удалён — из снимка записи,
 * чтобы удаление из справочника не обнуляло ставку. Доплаты всегда текущие.
 */
export async function recalculateTrips(range, { userId = null, apply = false } = {}) {
  const clauses = inRange(range);
  if (userId) clauses.push(eq(trips.userId, userId));
  const rows = await db
    .select()
    .from(trips)
    .where(clauses.length ? and(...clauses) : undefined)
    .all();

  const global = await getSettings();
  const customerIds = [...new Set(rows.map((row) => row.customerId))];
  const customerRows = customerIds.length
    ? await db.select().from(customers).where(inArray(customers.id, customerIds)).all()
    : [];
  const byId = new Map(customerRows.map((row) => [row.id, row]));

  /** Новый расчёт для записи: ставки заказчика (или снимок) + текущие доплаты. */
  const recompute = (row) => {
    const customer = byId.get(row.customerId);
    const rates = resolveRates(customer || { baseRate: row.baseRate }, global);
    const breakdown = calcTrip({
      baseRate: rates.baseRate,
      points: row.points,
      distance: row.distance,
      hours: row.hours,
      pointsFree: rates.pointsFree,
      pointRate: rates.pointRate,
      kmFree: rates.kmFree,
      kmRate: rates.kmRate,
      hoursFree: rates.hoursFree,
      hourRate: rates.hourRate,
    });
    return { customer, rates, breakdown };
  };

  const changed = [];
  const users = new Map();
  let incomeBefore = 0;
  let incomeAfter = 0;

  for (const row of rows) {
    const { customer, rates, breakdown } = recompute(row);
    incomeBefore += row.income;
    incomeAfter += breakdown.income;

    const bucket = users.get(row.userId) || { userId: row.userId, total: 0, changed: 0, delta: 0 };
    bucket.total += 1;

    const isChanged =
      breakdown.income !== row.income ||
      (row.daysBonus || 0) !== 0 ||
      rates.baseRate !== row.baseRate ||
      rates.pointsFree !== row.pointsFree ||
      rates.pointRate !== row.pointRate ||
      rates.kmFree !== row.kmFree ||
      rates.kmRate !== row.kmRate ||
      rates.hoursFree !== row.hoursFree ||
      rates.hourRate !== row.hourRate;

    if (isChanged) {
      bucket.changed += 1;
      bucket.delta += breakdown.income - row.income;
      changed.push({
        row,
        customer,
        rates,
        incomeAfter: breakdown.income,
        delta: breakdown.income - row.income,
      });
    }
    users.set(row.userId, bucket);
  }

  if (apply && changed.length) {
    await Promise.all(
      changed.map((item) =>
        db
          .update(trips)
          .set({
            income: item.incomeAfter,
            ...ratesSnapshot(item.customer ? item.customer.name : item.row.customerName, item.rates),
            updatedAt: new Date(),
          })
          .where(and(eq(trips.id, item.row.id), eq(trips.userId, item.row.userId)))
          .run(),
      ),
    );
  }

  // Доход не включает доплату за дни — её ведём отдельно; если её проставили
  // или сняли, суммы записей поменялись и это нужно показать.
  if (apply) {
    for (const bucket of users.keys()) await syncDaysBonusInRange(bucket, range, global);
  }

  return {
    from: range?.from || null,
    to: range?.to || null,
    applied: Boolean(apply),
    total: rows.length,
    changed: changed.length,
    incomeBefore,
    incomeAfter,
    delta: incomeAfter - incomeBefore,
    users: [...users.values()].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)),
    items: changed
      .map((item) => ({
        id: item.row.id,
        date: item.row.tripDate,
        userId: item.row.userId,
        customerName: item.customer ? item.customer.name : item.row.customerName,
        customerMissing: !item.customer,
        incomeBefore: item.row.income,
        incomeAfter: item.incomeAfter,
        delta: item.delta,
      }))
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, 200),
  };
}

/**
 * Сводка для дашборда админки: журналы, записи, доход за период.
 * Возвращает только агрегаты — персональные данные внутри панели и так доступны
 * владельцу, но дашборду они не нужны.
 */
export async function dashboardStats(range) {
  const [rows, users, global] = await Promise.all([
    listTrips(null, range),
    db.select().from(usersTable).all(),
    getSettings(),
  ]);

  const byUser = new Map();
  const byDate = new Set();
  let income = 0;
  let daysBonus = 0;
  for (const row of rows) {
    income += row.income;
    daysBonus += row.daysBonus || 0;
    byDate.add(row.tripDate);
    const bucket = byUser.get(row.userId) || { userId: row.userId, trips: 0, income: 0, days: new Set(), lastDate: row.tripDate };
    bucket.trips += 1;
    bucket.income += row.income;
    bucket.days.add(row.tripDate);
    if (row.tripDate > bucket.lastDate) bucket.lastDate = row.tripDate;
    byUser.set(row.userId, bucket);
  }

  const journalOwners = new Set(rows.map((row) => row.userId));
  // Имя для заголовка журнала: подпись «Журнал #4» ничего не говорит владельцу.
  const people = new Map(users.map((row) => [row.id, row]));
  const statuses = users.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, {});

  return {
    period: { from: range?.from || null, to: range?.to || null },
    users: {
      total: users.length,
      approved: users.filter((row) => row.status === 'approved').length,
      pending: users.filter((row) => row.status === 'pending').length,
      denied: (statuses.denied || 0) + (statuses.blocked || 0),
      admins: users.filter((row) => row.isAdmin || row.isOwner).length,
    },
    trips: {
      // count — число записей; total — деньги (доход рейсов + доплата за дни).
      count: rows.length,
      journals: journalOwners.size,
      workingDays: byDate.size,
      income,
      daysBonus,
      total: income + daysBonus,
      avgIncome: rows.length ? Math.round(income / rows.length) : 0,
      daysMin: global.daysMin,
    },
    journals: [...byUser.values()]
      .map((bucket) => {
        const person = people.get(bucket.userId);
        return {
          userId: bucket.userId,
          // Имя — как в списке пользователей: имя, иначе @username, иначе ID.
          name: displayName(person || { id: bucket.userId, tgId: bucket.userId }),
          username: person?.username || null,
          trips: bucket.trips,
          income: bucket.income,
          days: bucket.days.size,
          lastDate: bucket.lastDate,
        };
      })
      .sort((a, b) => b.trips - a.trips)
      .slice(0, 8),
  };
}
