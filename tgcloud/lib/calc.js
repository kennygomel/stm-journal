// lib/calc.js — тарифы и расчёт дохода за рейс.
//
// Все доплаты ГЛОБАЛЬНЫЕ (таблица settings). У заказчика — только название и
// своя базовая ставка. Значения по умолчанию:
//   • база 120 ₽ (если у заказчика не задана своя);
//   • за каждую точку свыше 12 за рейс — 2 ₽;
//   • за каждый километр свыше 300 км за рейс — 20 коп.;
//   • часы свыше 8 — по 20 ₽ за каждые ПОЛНЫЕ 4 часа сверх лимита
//     (12 ч → +20 ₽, 16 ч → +40 ₽, 20 ч → +60 ₽; 11 ч → 0, 13 ч → +20 ₽).
//
// Все деньги — в копейках, пробег — в километрах, часы — целые.

import { db } from 'sdk';
import { eq } from 'sdk/db';
import { settings } from '../schema.js';

export const DEFAULT_RATES = {
  baseRate: 12000, // 120 ₽
  pointsFree: 12,
  pointRate: 200, // 2 ₽ за точку свыше лимита
  kmFree: 300,
  kmRate: 20, // 20 коп. за км свыше лимита
  hoursFree: 8,
  hourRate: 2000, // 20 ₽ за каждые полные 4 часа сверх лимита
  daysMin: 25, // рабочих дней в месяце для доплаты
  daysRate: 2000, // 20 ₽ за месяц с достаточным числом дней
};

/**
 * Доплата за дни: 20 ₽, если в календарном месяце набралось ≥ 25 рабочих дней.
 * Считается по числу РАЗНЫХ дат рейсов, поэтому одна дата — один рабочий день.
 */
export function daysBonusFor(dayCount, global) {
  const min = Number(global?.daysMin ?? DEFAULT_RATES.daysMin);
  const rate = Number(global?.daysRate ?? DEFAULT_RATES.daysRate);
  return Number(dayCount) >= min ? rate : 0;
}

/** Месяц даты «YYYY-MM-DD» → «YYYY-MM». */
export function monthOf(isoDate) {
  const value = String(isoDate ?? '');
  return /^\d{4}-\d{2}/.test(value) ? value.slice(0, 7) : null;
}

/** Шаг доплаты за часы: каждые полные 4 часа свыше лимита. */
export const HOURS_STEP = 4;

/** Сколько раз шаг укладывается в превышение по часам. */
export function hoursSteps(extraHours, step = HOURS_STEP) {
  const extra = Math.max(0, Number(extraHours) || 0);
  const size = Number(step) || HOURS_STEP;
  return Math.floor(extra / size);
}

/** Глобальные тарифы (одна строка). Дополняются значениями по умолчанию. */
export async function getSettings() {
  const row = await db.select().from(settings).where(eq(settings.id, 1)).get();
  return { ...DEFAULT_RATES, ...(row || {}) };
}

/**
 * Действующие тарифы для заказчика: глобальные доплаты + его базовая ставка.
 * Пустая ставка заказчика означает «взять глобальную».
 */
export function resolveRates(customer, global) {
  const base = { ...DEFAULT_RATES, ...(global || {}) };
  const own = customer?.baseRate;
  return {
    baseRate: own === null || own === undefined ? base.baseRate : own,
    pointsFree: base.pointsFree,
    pointRate: base.pointRate,
    kmFree: base.kmFree,
    kmRate: base.kmRate,
    hoursFree: base.hoursFree,
    hourRate: base.hourRate,
    daysMin: base.daysMin,
    daysRate: base.daysRate,
  };
}

/**
 * Доход за рейс и подробная расшифровка.
 * По точкам и километрам доплата идёт за каждую единицу сверх лимита.
 * По часам — за каждые ПОЛНЫЕ 4 часа сверх лимита (по 20 ₽ за шаг):
 * 9–12 ч → один шаг, 13–16 ч → два, и так далее.
 * Ровно на лимитах (12 точек, 300 км, 8 часов) — без доплаты.
 */
export function calcTrip({
  baseRate,
  points = 0,
  distance = 0,
  hours = 0,
  pointsFree,
  pointRate,
  kmFree,
  kmRate,
  hoursFree,
  hourRate,
}) {
  const extraPoints = Math.max(0, Number(points) - Number(pointsFree));
  const extraKm = Math.max(0, Number(distance) - Number(kmFree));
  const extraHours = Math.max(0, Number(hours) - Number(hoursFree));
  const pointsBonus = extraPoints * Number(pointRate);
  const kmBonus = extraKm * Number(kmRate);
  // Каждые полные 4 часа сверх лимита — плюс один шаг доплаты.
  const steps = hoursSteps(extraHours);
  const hoursBonus = steps * Number(hourRate);
  return {
    baseRate: Number(baseRate),
    extraPoints,
    pointsBonus,
    extraKm,
    kmBonus,
    extraHours,
    hoursSteps: steps,
    hoursBonus,
    income: Number(baseRate) + pointsBonus + kmBonus + hoursBonus,
  };
}

/** Снимок тарифов на момент записи рейса: доход не меняется при смене тарифов. */
export function ratesSnapshot(customerName, rates) {
  return {
    customerName,
    baseRate: rates.baseRate,
    pointsFree: rates.pointsFree,
    pointRate: rates.pointRate,
    kmFree: rates.kmFree,
    kmRate: rates.kmRate,
    hoursFree: rates.hoursFree,
    hourRate: rates.hourRate,
    daysMin: rates.daysMin,
    daysRate: rates.daysRate,
  };
}
