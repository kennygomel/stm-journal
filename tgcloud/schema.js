// tgcloud/schema.js — database schema (tables as named exports).
//
// Money is stored in kopecks (integer), distance in kilometres (integer),
// points in integer counts. No foreign keys are possible on this platform —
// integrity is enforced in the application code (see tgcloud/lib/).

import { table, integer, text, index, uniqueIndex, check, sql } from 'sdk/db';

// Journal users. Access to the bot and the Mini App is gated by `status`.
//   pending — asked for access, waiting for an admin
//   approved — may use the journal
//   denied — the admin refused access
//   blocked — access revoked after approval
export const users = table(
  'users',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tgId: integer('tg_id').notNull(),
    chatId: integer('chat_id'),
    username: text('username'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    status: text('status').notNull().default('pending'),
    isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
    // Владелец — полный доступ; остальные админы только справочник заказчиков.
    isOwner: integer('is_owner', { mode: 'boolean' }).notNull().default(false),
    // Тема оформления Mini App: 'light' | 'dark' | 'system' (хранится за пользователем).
    theme: text('theme'),
    // Фото профиля Telegram, сохранённое как data URL (сервер скачивает байты).
    photo: text('photo'),
    photoUpdatedAt: integer('photo_updated_at', { mode: 'timestamp' }),
    // Когда админам отправляли запрос на доступ — чтобы не спамить повторами.
    requestNotifiedAt: integer('request_notified_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
    approvedAt: integer('approved_at', { mode: 'timestamp' }),
    approvedBy: integer('approved_by'),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }),
  },
  (t) => ({
    tgIdUnique: uniqueIndex('uidx_users_tg_id').on(t.tgId),
    statusIdx: index('idx_users_status').on(t.status),
  }),
);

// Тарифы и доплаты. Они ГЛОБАЛЬНЫЕ: у заказчика своей доплаты нет.
// Редактирует только владелец.
//   baseRate   — базовая стоимость рейса по умолчанию, коп. (120 ₽)
//   pointsFree — включённое число точек за рейс
//   pointRate  — доплата за каждую точку свыше лимита, коп. (2 ₽)
//   kmFree     — включённый пробег за рейс, км
//   kmRate     — доплата за каждый километр свыше лимита, коп. (20 коп.)
//   daysFree?  — нет: доплата за дни считается по календарному месяцу
//   daysMin    — legacy: доплата за дни теперь по таблице, колонка не используется
//   daysRate   — legacy: см. DAYS_BONUS_TABLE в lib/calc.js
//   hoursFree  — включённые часы работы за рейс (8)
//   hourRate   — доплата за каждые полные 4 часа сверх лимита, коп. (20 ₽)
export const settings = table(
  'settings',
  {
    id: integer('id').primaryKey(),
    // DEFAULT совпадает с lib/calc.js DEFAULT_RATES (120 ₽). Приложение всегда
    // пишет значение явно, поэтому на дефолт базы не полагаемся.
    baseRate: integer('base_rate').notNull().default(12000),
    pointsFree: integer('points_free').notNull().default(12),
    pointRate: integer('point_rate').notNull().default(200),
    kmFree: integer('km_free').notNull().default(300),
    kmRate: integer('km_rate').notNull().default(20),
    hoursFree: integer('hours_free').notNull().default(8),
    hourRate: integer('hour_rate').notNull().default(2000),
    daysMin: integer('days_min').notNull().default(25).deprecated('доплата за дни теперь по таблице'),
    daysRate: integer('days_rate').notNull().default(2000).deprecated('доплата за дни теперь по таблице'),
    updatedAt: integer('updated_at', { mode: 'timestamp' }),
    updatedBy: integer('updated_by'),
  },
  (t) => ({
    idCheck: check('chk_settings_single_row', sql`${t.id} = 1`),
  }),
);

// Справочник заказчиков: только название и своя базовая ставка
// (пусто → settings.baseRate). Все доплаты — из settings.
export const customers = table(
  'customers',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    baseRate: integer('base_rate'), // коп., null → settings.baseRate
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }),
    updatedBy: integer('updated_by'),
    // Доплаты больше не задаются у заказчика — старые колонки убираем миграцией.
    pointsFree: integer('points_free').deprecated('доплаты стали глобальными'),
    pointRate: integer('point_rate').deprecated('доплаты стали глобальными'),
    kmFree: integer('km_free').deprecated('доплаты стали глобальными'),
    kmRate: integer('km_rate').deprecated('доплаты стали глобальными'),
  },
  (t) => ({
    nameIdx: index('idx_customers_name').on(t.name),
  }),
);

// Записи журнала. `income` — readonly расчёт, зафиксированный на момент записи
// (снимок ставок), чтобы правка тарифов не переписывала историю.
export const trips = table(
  'trips',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').notNull(), // users.id — связь держим в коде
    tripDate: text('trip_date').notNull(), // YYYY-MM-DD
    customerId: integer('customer_id').notNull(),
    customerName: text('customer_name').notNull(), // снимок имени для истории
    points: integer('points').notNull().default(0),
    distance: integer('distance').notNull().default(0), // км
    hours: integer('hours').notNull().default(0), // часы работы
    income: integer('income').notNull().default(0), // коп.
    baseRate: integer('base_rate').notNull().default(0), // снимок тарифов
    pointsFree: integer('points_free').notNull().default(0),
    pointRate: integer('point_rate').notNull().default(0),
    kmFree: integer('km_free').notNull().default(0),
    kmRate: integer('km_rate').notNull().default(0),
    hoursFree: integer('hours_free').notNull().default(0),
    hourRate: integer('hour_rate').notNull().default(0),
    // Доплата за дни месяца входит в доход ровно один раз: только у последней
    // записи месяца, если рабочих дней в нём не меньше лимита.
    daysBonus: integer('days_bonus').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }),
  },
  (t) => ({
    userDateIdx: index('idx_trips_user_date').on(t.userId, t.tripDate),
    customerIdx: index('idx_trips_customer').on(t.customerId),
  }),
);

// Еженедельный лидерборд: призы за 1–3 места в четырёх номинациях.
// Строка — это вручённый приз за конкретную неделю и номинацию.
//   weekStart — понедельник недели, «YYYY-MM-DD» (Europe/Minsk)
//   category  — income | points | distance | hours
//   place     — 1 (банан), 2 (клоун), 3 (петух)
//   value     — результат победителя в единицах номинации (доход — копейки)
export const awards = table(
  'awards',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').notNull(),
    weekStart: text('week_start').notNull(),
    category: text('category').notNull(),
    place: integer('place').notNull(),
    value: integer('value').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  (t) => ({
    weekIdx: index('idx_awards_week').on(t.weekStart),
    userIdx: index('idx_awards_user').on(t.userId),
    // Один приз на место в номинации за неделю: повторный подсчёт не дублирует.
    weekCategoryPlace: uniqueIndex('uidx_awards_week_place').on(t.weekStart, t.category, t.place),
  }),
);
