// src/views/report.js — история и баланс за выбранный промежуток.

import { api } from '../api.js';
import { add, card, clear, el, inlineField, input, mount, scrollFade, sectionTitle, toast } from '../dom.js';
import { metric } from '../icons.js';
import { PERIODS, rangeFor } from '../periods.js';
import {
  endOfMonth,
  fmtDate,
  fmtDateLong,
  fmtMoney,
  fmtNumber,
  isoDaysAgo,
  plural,
  startOfMonth,
  todayIso,
} from '../format.js';

export function reportView(root) {
  let range = rangeFor('month');
  const result = el('div');
  const chips = scrollFade(el('div', { class: 'chips' }));
  const fromInput = input({ type: 'date', value: range.from || '' });
  const toInput = input({ type: 'date', value: range.to || '' });
  const custom = el('div', { class: 'field-grid' }, [inlineField('с', fromInput), inlineField('по', toInput)]);
  const filters = el('div', { class: 'report-filters' }, [chips, custom]);

  async function load() {
    mount(result, el('div', { class: 'muted', text: 'Считаем…' }));
    try {
      const data = await api.report(range);
      render(data);
    } catch (error) {
      mount(result, el('div', { class: 'muted', text: error.message }));
      toast(error.message, { error: true });
    }
  }

  function render(data) {
    const { totals } = data;
    const period = data.from || data.to ? `${fmtDate(data.from) || '…'} — ${fmtDate(data.to) || 'сегодня'}` : 'Всё время';

    const balance = card(
      [
        el('div', { class: 'balance-head' }, [
          el('div', { class: 'balance-label', text: `Баланс за период · ${period}` }),
          el('div', { class: 'balance-amount' }, fmtMoney(totals.total ?? totals.income)),
          totals.daysBonus
            ? el('div', { class: 'summary-sub' }, [
                'рейсы ',
                ...fmtMoney(totals.income),
                ' + дни ',
                ...fmtMoney(totals.daysBonus),
              ])
            : null,
          el('div', { class: 'balance-foot' }, [
            metric('trip', `${fmtNumber(totals.trips)} ${plural(totals.trips, 'рейс', 'рейса', 'рейсов')}`),
            el('span', { class: 'muted' }, ['в среднем ', ...fmtMoney(totals.avgIncome), ' за рейс']),
          ]),
        ]),
        el('div', { class: 'balance-meta' }, [
          metric('calendar', `${fmtNumber(totals.workingDays || 0)} дн.`),
          metric('points', `${fmtNumber(totals.points)}${totals.extraPoints ? ` (+${fmtNumber(totals.extraPoints)})` : ''}`),
          metric('distance', `${fmtNumber(totals.distance)} км${totals.extraKm ? ` (+${fmtNumber(totals.extraKm)})` : ''}`),
          metric('hours', `${fmtNumber(totals.hours || 0)} ч${totals.extraHours ? ` (+${fmtNumber(totals.extraHours)})` : ''}`),
        ]),
        totals.workingDays
          ? el(
              'div',
              { class: 'balance-days' },
              totals.daysBonus
                ? [
                    `Доплата за дни: ${fmtNumber(totals.workingDays)} дн. ≥ ${fmtNumber(totals.daysMin)} — `,
                    ...fmtMoney(totals.daysBonus),
                  ]
                : [`Рабочих дней: ${fmtNumber(totals.workingDays)} из ${fmtNumber(totals.daysMin)}`],
            )
          : null,
      ],
      'card balance',
    );

    const byCustomer = data.byCustomer.length
      ? data.byCustomer.map((row) =>
          el('div', { class: 'list-row' }, [
            el('div', {}, [
              el('div', { text: row.customerName }),
              el('div', {
                class: 'muted',
                text: `${fmtNumber(row.trips)} ${plural(row.trips, 'рейс', 'рейса', 'рейсов')} · ${fmtNumber(row.points)} т. · ${fmtNumber(row.distance)} км · ${fmtNumber(row.hours || 0)} ч`,
              }),
            ]),
            el('div', { class: 'amount' }, fmtMoney(row.income)),
          ]),
        )
      : [el('div', { class: 'muted', text: 'Нет данных за период' })];

    const byDate = data.byDate.length
      ? data.byDate.map((row) =>
          el('div', { class: 'list-row' }, [
            el('div', {}, [
              el('div', { text: fmtDateLong(row.date) }),
              el('div', { class: 'muted', text: `${fmtNumber(row.trips)} рейс(а) · ${fmtNumber(row.distance)} км · ${fmtNumber(row.hours || 0)} ч` }),
            ]),
            el('div', { class: 'amount' }, fmtMoney(row.income)),
          ]),
        )
      : [];

    mount(
      result,
      balance,
      sectionTitle('По заказчикам'),
      card(byCustomer),
      byDate.length ? sectionTitle('По дням') : null,
      byDate.length ? card(byDate) : null,
    );
  }

  for (const preset of PERIODS) {
    chips.append(
      el(
        'button',
        {
          class: `chip${preset.id === 'month' ? ' on' : ''}`,
          onClick: async (event) => {
            range = rangeFor(preset.id);
            fromInput.value = range.from || '';
            toInput.value = range.to || '';
            for (const node of chips.children) node.classList.toggle('on', node === event.currentTarget);
            await load();
          },
        },
        preset.label,
      ),
    );
  }

  fromInput.addEventListener('change', async () => {
    range = { ...range, from: fromInput.value || null };
    await load();
  });
  toInput.addEventListener('change', async () => {
    range = { ...range, to: toInput.value || null };
    await load();
  });

  root.append(filters, result);
  load();

  return {
    refresh: async () => {
      await load();
    },
  };
}
