// src/views/recalc.js — владелец: пересчёт записей за период.
//
// Нужен, когда тарифы обновили задним числом или в проде нашлась ошибка:
// записи хранят снимок ставок, поэтому сами по себе не меняются. Сначала
// показываем предпросмотр (что и как изменится), применяем только по кнопке.

import { api } from '../api.js';
import { button, card, clear, el, inlineField, input, mount, placeholder, scrollFade, sectionTitle, toast } from '../dom.js';
import { fmtDate, fmtMoney, fmtNumber, plural } from '../format.js';
import { PERIODS, describeRange, rangeFor } from '../periods.js';
import { confirmAction, haptic } from '../telegram.js';

export function recalcView(root, ctx) {
  const initial = rangeFor('month');
  let range = { ...initial };
  let preview = null;

  const chips = scrollFade(el('div', { class: 'chips' }));
  const fromInput = input({ type: 'date', value: range.from || '' });
  const toInput = input({ type: 'date', value: range.to || '' });
  const result = el('div');

  for (const [node, key] of [
    [fromInput, 'from'],
    [toInput, 'to'],
  ]) {
    node.addEventListener('change', () => {
      range = { ...range, [key]: node.value || null };
      for (const chip of chips.children) chip.classList.remove('on');
      preview = null;
      clear(result);
    });
  }

  for (const period of PERIODS) {
    chips.append(
      button(period.label, {
        className: `chip${period.id === 'month' ? ' on' : ''}`,
        onClick: async (event) => {
          range = rangeFor(period.id);
          fromInput.value = range.from || '';
          toInput.value = range.to || '';
          for (const node of chips.children) node.classList.toggle('on', node === event.currentTarget);
          preview = null;
          clear(result);
        },
      }),
    );
  }

  const runButton = button('Проверить', {
    className: 'btn primary btn-block',
    onClick: async () => {
      if (!range.from && !range.to) {
        toast('Выберите период', { error: true });
        return;
      }
      try {
        preview = await api.recalc({ from: range.from, to: range.to });
        renderPreview(preview);
      } catch (error) {
        toast(error.message, { error: true });
      }
    },
  });

  /** Знак разницы отдельно от суммы — чтобы не собирать это в каждом месте. */
  function signedMoney(value) {
    return [value > 0 ? '+' : '−', ...fmtMoney(Math.abs(value))];
  }

  /** Плитки «проверено / изменится»: та же сетка, что на дашборде админки. */
  function statsBlock(data, applied = false) {
    const change = (data.delta || 0) + (data.bonusDelta || 0);
    return el('div', { class: 'stats' }, [
      el('div', { class: 'stat' }, [
        el('div', { class: 'label', text: 'Проверено записей' }),
        el('div', { class: 'value', text: fmtNumber(data.total) }),
        el('div', { class: 'stat-foot', text: describeRange(data) }),
      ]),
      el('div', { class: 'stat' }, [
        el('div', { class: 'label', text: applied ? 'Пересчитано' : 'Изменится' }),
        el('div', { class: 'value', text: fmtNumber(data.changed) }),
        change
          ? el('div', { class: `stat-foot delta ${change > 0 ? 'up' : 'down'}` }, signedMoney(change))
          : el('div', { class: 'stat-foot', text: 'суммы не меняются' }),
      ]),
    ]);
  }

  /** Карточка баланса: доход рейсов отдельно, доплаты — отдельной строкой. */
  function balanceCard(data) {
    return card([
      el('div', { class: 'muted', text: `Баланс за ${describeRange(data)}` }),
      el('div', { class: 'summary-amount' }, [
        el('span', {}, fmtMoney(data.incomeBefore)),
        el('span', { class: 'muted' }, ' → '),
        ...fmtMoney(data.incomeAfter),
      ]),
      data.delta === 0
        ? el('div', { class: 'delta-line', text: 'доход рейсов не меняется' })
        : el('div', { class: `delta-line ${data.delta > 0 ? 'up' : 'down'}` }, [
            data.delta > 0 ? 'рейсы принесут больше на ' : 'рейсы принесут меньше на ',
            ...fmtMoney(Math.abs(data.delta)),
          ]),
      data.bonusDelta
        ? el('div', { class: 'delta-line' }, [
            el('span', { class: 'muted', text: 'доплаты: ' }),
            ...fmtMoney(data.bonusBefore),
            el('span', { class: 'muted', text: ' → ' }),
            ...fmtMoney(data.bonusAfter),
          ])
        : null,
    ]);
  }

  function renderPreview(data) {
    if (!data.total) {
      mount(result, placeholder('Записей нет', 'В этом периоде никто не вносил рейсы — выберите другой период'));
      return;
    }

    const rows = data.items.map((item) => {
      const total = item.delta + (item.bonusDelta || 0);
      return el('div', { class: 'list-row' }, [
        el('div', {}, [
          el('div', { text: `${fmtDate(item.date)} · ${item.customerName}` }),
          el('div', { class: 'muted' }, [
            ...fmtMoney(item.incomeBefore),
            ' → ',
            ...fmtMoney(item.incomeAfter),
            item.customerMissing ? ' · заказчик удалён' : '',
          ]),
          // Доплата меняется отдельно от дохода рейса — её видно своей строкой,
          // иначе «изменится, но 0 ₽» выглядит как ошибка.
          item.bonusDelta
            ? el('div', { class: 'muted' }, ['доплаты ', ...fmtMoney(item.bonusBefore), ' → ', ...fmtMoney(item.bonusAfter)])
            : null,
        ]),
        total
          ? el('div', { class: `amount delta ${total > 0 ? 'up' : 'down'}` }, signedMoney(total))
          : el('div', { class: 'amount muted' }, fmtMoney(0)),
      ]);
    });

    const users = data.users
      .filter((row) => row.changed > 0)
      .map((row) =>
        el('div', { class: 'list-row' }, [
          el('div', {}, [
            el('div', { text: `Журнал #${row.userId}` }),
            el('div', { class: 'muted', text: `${fmtNumber(row.changed)} из ${fmtNumber(row.total)} записей` }),
          ]),
          row.delta
            ? el('div', { class: `amount delta ${row.delta > 0 ? 'up' : 'down'}` }, signedMoney(row.delta))
            : el('div', { class: 'amount muted', text: 'доплаты' }),
        ]),
      );

    if (!data.changed) {
      clear(result).append(
        statsBlock(data),
        card([
          el('div', { class: 'trip-name', text: 'Пересчёт не нужен' }),
          el('div', {
            class: 'muted',
            text: `Все записи за ${describeRange(data)} уже посчитаны по действующим тарифам — переписывать нечего.`,
          }),
        ]),
      );
      return;
    }

    clear(result).append(
      statsBlock(data),
      balanceCard(data),
      users.length ? sectionTitle('По журналам') : null,
      users.length ? card(users) : null,
      sectionTitle(`Записи · ${fmtNumber(data.changed)}`),
      card(rows),
      button('Пересчитать и сохранить', {
        className: 'btn primary btn-block',
        onClick: () => apply(),
      }),
      el('div', { class: 'view-hint' }, 'Действие меняет суммы уже сохранённых записей и применяется ко всем журналам за выбранный период.'),
    );
  }

  /** Итог применения: те же плитки, но без кнопки — повторять нечего. */
  function renderApplied(data) {
    const change = (data.delta || 0) + (data.bonusDelta || 0);
    clear(result).append(
      statsBlock(data, true),
      card([
        el('div', { class: 'trip-name', text: 'Готово' }),
        el('div', {
          class: 'muted',
          text: `Пересчитано ${fmtNumber(data.changed)} ${plural(data.changed, 'запись', 'записи', 'записей')} за ${describeRange(data)}.`,
        }),
        change
          ? el('div', { class: `delta-line ${change > 0 ? 'up' : 'down'}` }, [
              change > 0 ? 'суммы выросли на ' : 'суммы уменьшились на ',
              ...fmtMoney(Math.abs(change)),
            ])
          : el('div', { class: 'delta-line', text: 'суммы не изменились — обновились только тарифы в записях' }),
      ]),
      el('div', { class: 'view-hint' }, 'Нажмите «Проверить», чтобы посмотреть период заново.'),
    );
  }

  async function apply() {
    const changed = preview?.changed || 0;
    const ok = await confirmAction(
      `Пересчитать ${fmtNumber(changed)} ${plural(changed, 'запись', 'записи', 'записей')} за ${describeRange(range)}? Суммы будут перезаписаны по действующим тарифам.`,
    );
    if (!ok) return;
    try {
      const applied = await api.recalc({ from: range.from, to: range.to, apply: true });
      haptic('success');
      toast(`Пересчитано: ${fmtNumber(applied.changed)}`);
      preview = null;
      renderApplied(applied);
    } catch (error) {
      toast(error.message, { error: true });
    }
  }

  root.append(
    el('div', { class: 'view-hint' }, 'Записи хранят тарифы на момент рейса, поэтому изменение тарифов не переписывает прошлое. Этот пересчёт применяет действующие тарифы к выбранному периоду.'),
    el('div', { class: 'filters' }, [
      chips,
      el('div', { class: 'field-grid' }, [inlineField('с', fromInput), inlineField('по', toInput)]),
    ]),
    runButton,
    result,
  );
}
