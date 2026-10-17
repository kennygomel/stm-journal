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

  function renderPreview(data) {
    if (!data.total) {
      mount(result, placeholder('Записей нет', 'В этом периоде никто не вносил рейсы — выберите другой период'));
      return;
    }
    if (!data.changed) {
      clear(result).append(
        card([
          el('div', { class: 'trip-name', text: 'Пересчёт не нужен' }),
          el('div', {
            class: 'muted',
            text: `Проверено ${fmtNumber(data.total)} ${plural(data.total, 'запись', 'записи', 'записей')} за ${describeRange(data)} — всё уже посчитано по действующим тарифам.`,
          }),
        ]),
      );
      return;
    }

    const rows = data.items.map((item) =>
      el('div', { class: 'list-row' }, [
        el('div', {}, [
          el('div', { text: `${fmtDate(item.date)} · ${item.customerName}` }),
          el('div', { class: 'muted' }, [
            ...fmtMoney(item.incomeBefore),
            ' → ',
            ...fmtMoney(item.incomeAfter),
            item.customerMissing ? ' · заказчик удалён' : '',
          ]),
        ]),
        el('div', { class: `amount delta ${item.delta > 0 ? 'up' : 'down'}` }, [
          item.delta > 0 ? '+' : '−',
          ...fmtMoney(Math.abs(item.delta)),
        ]),
      ]),
    );

    const users = data.users
      .filter((row) => row.changed > 0)
      .map((row) =>
        el('div', { class: 'list-row' }, [
          el('div', {}, [
            el('div', { text: `Журнал #${row.userId}` }),
            el('div', { class: 'muted', text: `${fmtNumber(row.changed)} из ${fmtNumber(row.total)} записей` }),
          ]),
          el('div', { class: `amount delta ${row.delta > 0 ? 'up' : 'down'}` }, [
            row.delta > 0 ? '+' : '−',
            ...fmtMoney(Math.abs(row.delta)),
          ]),
        ]),
      );

    clear(result).append(
      el('div', { class: 'stats' }, [
        el('div', { class: 'stat' }, [
          el('div', { class: 'label', text: 'Проверено записей' }),
          el('div', { class: 'value', text: fmtNumber(data.total) }),
        ]),
        el('div', { class: 'stat' }, [
          el('div', { class: 'label', text: 'Изменится' }),
          el('div', { class: 'value', text: fmtNumber(data.changed) }),
        ]),
      ]),
      card([
        el('div', { class: 'muted', text: `Баланс за ${describeRange(data)}` }),
        el('div', { class: 'summary-amount' }, [
          el('span', {}, fmtMoney(data.incomeBefore)),
          el('span', { class: 'muted' }, ' → '),
          ...fmtMoney(data.incomeAfter),
        ]),
        el('div', { class: `delta-line ${data.delta >= 0 ? 'up' : 'down'}` }, [
          data.delta >= 0 ? 'станет больше на ' : 'станет меньше на ',
          ...fmtMoney(Math.abs(data.delta)),
        ]),
      ]),
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
      preview = applied;
      renderPreview(applied);
    } catch (error) {
      toast(error.message, { error: true });
    }
  }

  root.append(
    el('div', { class: 'view-hint' }, 'Записи хранят тарифы на момент рейса, поэтому изменение тарифов не переписывает прошлое. Этот пересчёт применяет действующие тарифы к выбранному периоду.'),
    chips,
    el('div', { class: 'field-grid' }, [inlineField('с', fromInput), inlineField('по', toInput)]),
    runButton,
    result,
  );
}
