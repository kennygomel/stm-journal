// lib/settings.js — глобальные тарифы (доплаты). Правит только владелец.

import { db, EndpointError } from 'sdk';
import { eq } from 'sdk/db';
import { settings } from '../schema.js';
import { DAYS_BONUS_MIN, DAYS_BONUS_TABLE, DEFAULT_RATES, getSettings } from './calc.js';
import { parseInteger, rublesToKopecks } from './format.js';

/** DTO для Mini App: деньги в копейках, лимиты — целые. */
export function toSettingsDto(row) {
  const value = { ...DEFAULT_RATES, ...(row || {}) };
  return {
    baseRate: value.baseRate,
    pointsFree: value.pointsFree,
    pointRate: value.pointRate,
    kmFree: value.kmFree,
    kmRate: value.kmRate,
    hoursFree: value.hoursFree,
    hourRate: value.hourRate,
    // Доплата за дни — фиксированная лестница, а не настройка.
    // Массив, а не объект: ключи-числа платформа не сериализует в ответ.
    daysMin: DAYS_BONUS_MIN,
    daysBonusTable: Object.entries(DAYS_BONUS_TABLE).map(([days, kopecks]) => ({
      days: Number(days),
      kopecks,
    })),
    updatedAt: value.updatedAt || null,
  };
}

/**
 * Сумма в рублях → копейки. Значение приходит из формы как рубли
 * («112» или «0,20»), поэтому умножаем ровно один раз — здесь.
 */
function parseKopecks(value, label) {
  const kopecks = rublesToKopecks(value, { min: 0, max: 100000000 });
  if (kopecks === null) {
    throw new EndpointError(`${label}: укажите сумму в рублях, например 2 или 0,20`, { code: 'BAD_RATE' });
  }
  return kopecks;
}

function parseLimit(value, label, max) {
  const num = parseInteger(value, { min: 0, max });
  if (num === null) {
    throw new EndpointError(`${label}: целое число от 0 до ${max}`, { code: 'BAD_LIMIT' });
  }
  return num;
}

/** Обновляет единственную строку тарифов (создаёт её при необходимости). */
export async function saveSettings(admin, input) {
  const current = await getSettings();
  const money = (value, label, fallback) =>
    value === undefined || value === null || value === '' ? fallback : parseKopecks(value, label);

  const next = {
    baseRate: money(input?.baseRate, 'Базовая стоимость по умолчанию', current.baseRate),
    pointsFree: parseLimit(input?.pointsFree, 'Включённые точки', 10000),
    pointRate: parseKopecks(input?.pointRate, 'Доплата за точку'),
    kmFree: parseLimit(input?.kmFree, 'Включённый пробег', 100000),
    kmRate: parseKopecks(input?.kmRate, 'Доплата за километр'),
    hoursFree: parseLimit(input?.hoursFree, 'Часов в лимите', 10000),
    hourRate: parseKopecks(input?.hourRate, 'Доплата за 4 часа сверх лимита'),
    updatedAt: new Date(),
    updatedBy: admin.id,
  };

  const existing = await db.select().from(settings).where(eq(settings.id, 1)).get();
  if (existing) {
    await db.update(settings).set(next).where(eq(settings.id, 1)).run();
  } else {
    await db.insert(settings).values({ id: 1, ...next }).run();
  }
  return toSettingsDto({ ...existing, ...next });
}
