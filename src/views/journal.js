// src/views/journal.js — журнал: записи, фильтр по периоду, форма рейса.
//
// Экран оптимизирован под один сценарий: водитель в рейсе вносит запись
// с телефона за пару тапов. Поэтому сверху — сумма и короткая сводка,
// затем кнопка записи, и только потом список.

import { api } from '../api.js';
import { emit, EVENTS } from '../events.js';
import { button, card, clear, el, field, inlineField, input, scrollFade, sheet, toast } from '../dom.js';
import { HOURS_STEP, hoursSteps } from '../hours.js';
import { PERIODS, rangeFor } from '../periods.js';
import {
  fmtDate,
  fmtMoney,
  fmtNumber,
  plural,
} from '../format.js';
import { metric } from '../icons.js';
import { confirmAction, haptic } from '../telegram.js';

/**
 * Расшифровка дохода: база плюс доплаты за превышение лимитов по точкам,
 * километрам и часам. Возвращает узлы, чтобы знак BYN рисовался шрифтом.
 */
function breakdown(rates, { points = 0, distance = 0, hours = 0 }) {
  const extraPoints = Math.max(0, points - rates.pointsFree);
  const extraKm = Math.max(0, distance - rates.kmFree);
  const extraHours = Math.max(0, hours - rates.hoursFree);
  const pointsBonus = extraPoints * rates.pointRate;
  const kmBonus = extraKm * rates.kmRate;
  // Каждые полные 4 часа сверх лимита — плюс один шаг доплаты.
  const steps = hoursSteps(extraHours);
  const hoursBonus = steps * rates.hourRate;

  const items = [el('span', {}, ['База ', ...fmtMoney(rates.baseRate)])];
  if (extraPoints > 0) {
    items.push(
      el('span', {}, [
        `+${extraPoints} ${plural(extraPoints, 'точка', 'точки', 'точек')} `,
        ...fmtMoney(pointsBonus),
      ]),
    );
  }
  if (extraKm > 0) {
    items.push(el('span', {}, [`+${fmtNumber(extraKm)} км `, ...fmtMoney(kmBonus)]));
  }
  if (steps > 0) {
    items.push(
      el('span', {}, [
        `${steps}×${HOURS_STEP} ч сверх лимита `,
        ...fmtMoney(hoursBonus),
      ]),
    );
  }
  if (items.length === 1) {
    items.push(
      el('span', { class: 'muted' }, [
        `в лимите: ${rates.pointsFree} т. · ${fmtNumber(rates.kmFree)} км · ${rates.hoursFree} ч`,
      ]),
    );
  }

  return {
    items,
    income: rates.baseRate + pointsBonus + kmBonus + hoursBonus,
    extraPoints,
    extraKm,
    extraHours,
    hoursSteps: steps,
  };
}

/** Последний выбранный заказчик — чтобы не искать его каждый раз. */
/** «ЧЧ:ММ» → минуты от полуночи; null, если не время. */
function parseTime(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Часы рейса по «началу» и «концу»; переход через полночь — плюс сутки. */
export function hoursBetween(start, end) {
  const from = parseTime(start);
  const to = parseTime(end);
  if (from === null || to === null) return null;
  const diff = to >= from ? to - from : to + 24 * 60 - from;
  // Часы в записи — целые; 7 ч 50 мин остаются 7 часами.
  return Math.floor(diff / 60);
}

function rememberCustomer(id) {
  try {
    window.localStorage.setItem(LAST_CUSTOMER_KEY, String(id));
  } catch {
    /* localStorage может быть недоступен */
  }
}

function lastCustomerId() {
  try {
    return window.localStorage.getItem(LAST_CUSTOMER_KEY);
  } catch {
    return null;
  }
}

/** Шторка создания/редактирования рейса. */
export function openTripForm(root, index, trip = null) {
  const customers = index.customers.filter((row) => row.active || trip?.customerId === row.id);
  if (!customers.length) {
    toast('Сначала админ должен добавить заказчиков', { error: true });
    return;
  }

  const dateInput = input({ type: 'date', value: trip?.date || index.today });
  const customerSelect = el('select');
  customerSelect.append(
    el('option', { value: '' }, 'Выберите заказчика'),
    ...customers.map((row) =>
      el('option', { value: row.id, selected: trip?.customerId === row.id }, row.name),
    ),
  );
  if (!trip) {
    const remembered = lastCustomerId();
    if (remembered && customers.some((row) => String(row.id) === remembered)) {
      customerSelect.value = remembered;
    }
  }

  const pointsInput = input({ type: 'number', inputmode: 'numeric', min: 0, step: 1, value: trip?.points ?? '' });
  const distanceInput = input({ type: 'number', inputmode: 'numeric', min: 0, step: 1, value: trip?.distance ?? '' });
  const hoursInput = input({ type: 'number', inputmode: 'numeric', min: 0, step: 1, value: trip?.hours ?? '' });
  const startInput = input({ type: 'time', value: '' });
  const endInput = input({ type: 'time', value: '' });
  // Плейсхолдер — действующий лимит из тарифов, а не захардкоженное число:
  // иначе после правки лимитов форма подсказывает устаревшие значения.
  for (const [node, limit] of [
    [pointsInput, index.settings?.pointsFree],
    [distanceInput, index.settings?.kmFree],
    [hoursInput, index.settings?.hoursFree],
  ]) {
    if (limit !== null && limit !== undefined) node.placeholder = String(limit);
  }

  // Режим времени: «часами» или «начало/конец». Часы — источник истины в
  // записи, поэтому режим влияет только на ввод.
  const switchRow = el('div', { class: 'seg' });
  const hoursPane = el('div', { class: 'field' }, [el('label', { text: 'Часов' }), hoursInput]);
  const timesPane = el('div', { class: 'field-grid' }, [
    el('div', { class: 'field' }, [el('label', { text: 'Начало' }), startInput]),
    el('div', { class: 'field' }, [el('label', { text: 'Конец' }), endInput]),
  ]);
  const computed = el('div', { class: 'hint-line' });

  let mode = 'hours';
  const setMode = (next) => {
    mode = next;
    for (const node of switchRow.children) node.classList.toggle('on', node.dataset.mode === next);
    hoursPane.hidden = next !== 'hours';
    timesPane.hidden = next !== 'times';
    computed.hidden = next !== 'times';
    if (next === 'times') syncHoursFromTimes();
  };

  for (const [id, label] of [
    ['hours', 'Часами'],
    ['times', 'Начало / конец'],
  ]) {
    const chip = button(label, { className: 'chip', onClick: () => setMode(id) });
    chip.dataset.mode = id;
    switchRow.append(chip);
  }

  function syncHoursFromTimes() {
    const value = hoursBetween(startInput.value, endInput.value);
    if (value === null) {
      computed.textContent = 'Укажите начало и конец — часы посчитаются сами';
      return;
    }
    hoursInput.value = String(value);
    computed.textContent = `В записи будет ${value} ${plural(value, 'час', 'часа', 'часов')}`;
    refresh();
  }

  for (const node of [startInput, endInput]) node.addEventListener('input', syncHoursFromTimes);

  const preview = el('div', { class: 'preview' });

  const ratesFor = (customerId) => {
    const customer = index.customers.find((row) => String(row.id) === String(customerId));
    return customer ? { ...index.settings, baseRate: customer.baseRate } : index.settings;
  };

  const refresh = () => {
    const rates = ratesFor(customerSelect.value);
    const points = Number(pointsInput.value || 0);
    const distance = Number(distanceInput.value || 0);
    const hours = Number(hoursInput.value || 0);
    const result = breakdown(rates, { points, distance, hours });
    clear(preview).append(
      el('div', { class: 'preview-total' }, [
        el('span', { class: 'muted' }, 'Доход за рейс'),
        el('b', {}, fmtMoney(result.income)),
      ]),
      el('div', { class: 'preview-parts' }, result.items),
    );
  };

  for (const node of [pointsInput, distanceInput, hoursInput]) node.addEventListener('input', refresh);
  customerSelect.addEventListener('change', refresh);
  setMode('hours');
  refresh();

  const content = [
    field('Дата', dateInput),
    field('Заказчик', customerSelect),
    el('div', { class: 'field-grid' }, [
      field('Точек', pointsInput),
      field('Пробег, км', distanceInput),
    ]),
    el('div', { class: 'field-block' }, [el('div', { class: 'seg-label', text: 'Время рейса' }), switchRow, hoursPane, timesPane, computed]),
    preview,
  ];

  sheet({
    title: trip ? 'Изменить запись' : 'Новый рейс',
    content,
    submitLabel: trip ? 'Сохранить' : 'Добавить',
    onSubmit: async () => {
      const payload = {
        date: dateInput.value,
        customerId: Number(customerSelect.value),
        points: Number(pointsInput.value || 0),
        distance: Number(distanceInput.value || 0),
        hours: Number(hoursInput.value || 0),
      };
      if (!payload.date) {
        toast('Укажите дату', { error: true });
        return false;
      }
      if (!payload.customerId) {
        toast('Выберите заказчика', { error: true });
        return false;
      }
      try {
        const result = trip ? await api.updateTrip({ id: trip.id, ...payload }) : await api.createTrip(payload);
        rememberCustomer(payload.customerId);
        haptic('success');
        toast(trip ? 'Запись обновлена' : 'Рейс добавлен');
        emit(EVENTS.journalChanged, { trip: result.trip, saved: true });
        return true;
      } catch (error) {
        toast(error.message, { error: true });
        return false;
      }
    },
  });
}

export function journalView(root, ctx) {
  const initial = rangeFor('month');
  const state = { period: 'month', from: initial.from, to: initial.to, trips: [], loading: true };

  const list = el('div');
  const chips = scrollFade(el('div', { class: 'chips' }));
  const rangeRow = el('div', { class: 'field-grid' });
  const fromInput = input({ type: 'date', value: state.from || '' });
  const toInput = input({ type: 'date', value: state.to || '' });

  for (const [node, key] of [
    [fromInput, 'from'],
    [toInput, 'to'],
  ]) {
    node.addEventListener('change', () => {
      state.period = 'custom';
      state[key] = node.value || null;
      load();
    });
  }
  rangeRow.append(inlineField('с', fromInput), inlineField('по', toInput));

  for (const period of PERIODS) {
    chips.append(
      button(period.label, {
        className: `chip${state.period === period.id ? ' on' : ''}`,
        onClick: async (event) => {
          state.period = period.id;
          const range = rangeFor(period.id);
          state.from = range.from;
          state.to = range.to;
          fromInput.value = range.from || '';
          toInput.value = range.to || '';
          for (const node of chips.children) node.classList.toggle('on', node === event.currentTarget);
          await load();
        },
      }),
    );
  }

  const addButton = button([el('span', { class: 'plus', text: '+' }), 'Рейс'], {
    className: 'btn primary btn-add',
    onClick: () => openTripForm(root, ctx, null),
  });

  const summary = el('div', { class: 'summary' });

  function renderSummary() {
    const income = state.trips.reduce((sum, trip) => sum + trip.income, 0);
    const daysBonus = state.trips.reduce((sum, trip) => sum + (trip.daysBonus || 0), 0);
    const points = state.trips.reduce((sum, trip) => sum + trip.points, 0);
    const km = state.trips.reduce((sum, trip) => sum + trip.distance, 0);
    const hours = state.trips.reduce((sum, trip) => sum + trip.hours, 0);
    clear(summary).append(
      el('div', { class: 'summary-main' }, [
        el('div', { class: 'summary-label' }, [
          'Доход за период',
          daysBonus ? el('span', { class: 'bonus-note' }, ' · с доплатой за дни') : null,
        ]),
        el('div', { class: 'summary-amount' }, fmtMoney(income + daysBonus)),
        daysBonus ? el('div', { class: 'summary-sub' }, ['рейсы ', ...fmtMoney(income), ' + дни ', ...fmtMoney(daysBonus)]) : null,
      ]),
      el('div', { class: 'summary-meta' }, [
        metric('trip', fmtNumber(state.trips.length)),
        metric('points', fmtNumber(points)),
        metric('distance', `${fmtNumber(km)} км`),
        metric('hours', `${fmtNumber(hours)} ч`),
      ]),
    );
  }

  function render() {
    renderSummary();
    const rows = state.trips.length
      ? state.trips
          .slice()
          .reverse()
          .map((trip) => tripRow(root, ctx, trip))
      : [
          el('div', { class: 'empty' }, [
            el('div', { text: 'За этот период записей нет' }),
            el('div', { class: 'muted', text: 'Нажмите «+ Рейс» — запись займёт полминуты' }),
          ]),
        ];
    list.replaceChildren(el('div', { class: 'list-head' }, [el('span', { text: 'Записи' }), el('span', { class: 'muted', text: state.trips.length ? `${fmtNumber(state.trips.length)}` : '' })]), ...rows);
  }

  async function load() {
    state.loading = true;
    list.replaceChildren(skeletonRows(3));
    clear(summary).append(el('div', { class: 'summary-label', text: 'Доход за период' }), el('div', { class: 'skeleton skeleton-amount' }));
    try {
      const result = await api.listTrips({ from: state.from, to: state.to });
      state.trips = result.trips;
    } catch (error) {
      state.trips = [];
      toast(error.message, { error: true });
    } finally {
      state.loading = false;
      render();
    }
  }

  root.append(
    el('div', { class: 'journal-top' }, [summary, addButton]),
    el('div', { class: 'filters' }, [chips, rangeRow]),
    list,
  );
  load();

  return {
    refresh: async () => {
      await load();
    },
  };
}

function skeletonRows(count) {
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    rows.push(
      el('div', { class: 'card skeleton-card' }, [
        el('div', { class: 'skeleton skeleton-line wide' }),
        el('div', { class: 'skeleton skeleton-line' }),
      ]),
    );
  }
  return el('div', {}, rows);
}

function tripRow(root, ctx, trip) {
  const rates = trip.rates;
  const result = breakdown(rates, trip);
  const details = [
    `${fmtNumber(trip.points)} ${plural(trip.points, 'точка', 'точки', 'точек')}`,
    `${fmtNumber(trip.distance)} км`,
    `${fmtNumber(trip.hours)} ${plural(trip.hours, 'час', 'часа', 'часов')}`,
  ];
  const over = [];
  if (result.extraPoints > 0) over.push(`+${result.extraPoints} к точкам`);
  if (result.extraKm > 0) over.push(`+${fmtNumber(result.extraKm)} км`);
  if (result.hoursSteps > 0) over.push(`+${result.hoursSteps * HOURS_STEP} ч сверх лимита`);

  return el('article', { class: 'trip' }, [
    el('div', { class: 'trip-head' }, [
      el('div', { class: 'trip-name', text: trip.customerName }),
      el('div', { class: 'trip-amount' }, fmtMoney(trip.income)),
    ]),
    el('div', { class: 'trip-meta' }, [
      el('span', { class: 'trip-date', text: fmtDate(trip.date) }),
      ...details.map((text) => el('span', { text })),
      ...over.map((text) => el('span', { class: 'trip-over', text })),
      trip.daysBonus ? el('span', { class: 'trip-bonus' }, ['+', ...fmtMoney(trip.daysBonus), ' за дни']) : null,
    ]),
    el('div', { class: 'trip-actions' }, [
      button('Изменить', { className: 'btn ghost', onClick: () => openTripForm(root, ctx, trip) }),
      button('Удалить', {
        className: 'btn danger',
        onClick: async () => {
          const ok = await confirmAction(`Удалить рейс ${fmtDate(trip.date)} — ${trip.customerName}?`);
          if (!ok) return;
          try {
            await api.deleteTrip(trip.id);
            haptic('warning');
            toast('Запись удалена');
            emit(EVENTS.journalChanged, { id: trip.id, deleted: true });
          } catch (error) {
            toast(error.message, { error: true });
          }
        },
      }),
    ]),
  ]);
}

export { rangeFor as periodRange };
