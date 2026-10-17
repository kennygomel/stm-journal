// src/views/customers.js — админ: справочник заказчиков.
//
// У заказчика только название и своя базовая ставка (пусто → глобальная).
// Все доплаты за точки, километры и часы — глобальные, в разделе «Тарифы».

import { api } from '../api.js';
import { button, card, el, input, placeholder, sheet, toast } from '../dom.js';
import { bynSign, fmtMoney, moneyInput } from '../format.js';
import { confirmAction, haptic } from '../telegram.js';
import { emit, EVENTS } from '../events.js';

export function customersView(root, ctx) {
  const body = el('div');

  function render(customers) {
    ctx.customers = customers;
    const rows = customers.length
      ? customers.map((customer) => customerRow(customer))
      : [placeholder('Справочник пуст', 'Добавьте первого заказчика — он появится в форме рейса')];

    body.replaceChildren(
      button('+ Заказчик', { className: 'btn primary btn-block', onClick: () => openForm(null) }),
      el('div', { class: 'section-title', text: `Заказчики · ${customers.length}` }),
      ...rows,
    );
  }

  function customerRow(customer) {
    const base = customer.ownBaseRate === null ? 'по умолчанию' : null;
    return card([
      el('div', { class: 'trip-head' }, [
        el('div', {}, [
          el('div', { class: 'trip-name' }, [
            customer.name,
            customer.active ? null : el('span', { class: 'muted', text: ' · скрыт' }),
          ]),
          el('div', { class: 'muted', text: base ? `базовая ставка ${base}` : 'своя базовая ставка' }),
        ]),
        el('div', { class: 'trip-amount' }, fmtMoney(customer.baseRate)),
      ]),
      el('div', { class: 'trip-actions' }, [
        button('Изменить', { className: 'btn ghost', onClick: () => openForm(customer) }),
        button('Удалить', {
          className: 'btn danger',
          onClick: async () => {
            const ok = await confirmAction(
              `Удалить заказчика «${customer.name}» из справочника? Записи журнала останутся.`,
            );
            if (!ok) return;
            try {
              await api.customers('delete', { id: customer.id });
              toast('Заказчик удалён');
              await refresh();
              emit(EVENTS.journalChanged, { customerChanged: true });
            } catch (error) {
              toast(error.message, { error: true });
            }
          },
        }),
      ]),
    ]);
  }

  function openForm(customer) {
    const nameInput = input({ type: 'text', value: customer?.name || '' });
    nameInput.placeholder = 'Например, СТМ-Логистика';
    const baseRateInput = input({
      type: 'text',
      inputmode: 'decimal',
      value: customer && customer.ownBaseRate !== null ? moneyInput(customer.ownBaseRate) : '',
    });
    baseRateInput.placeholder = moneyInput(ctx.settings.baseRate);
    const activeToggle = el('input', { type: 'checkbox', checked: customer ? customer.active : true });

    sheet({
      title: customer ? 'Заказчик' : 'Новый заказчик',
      content: [
        el('div', { class: 'field' }, [el('label', { text: 'Название' }), nameInput]),
        el('div', { class: 'field' }, [
          el('label', {}, ['Базовая ставка, ', bynSign()]),
          baseRateInput,
          el('div', {
            class: 'hint-line',
            text: `Пусто — берётся общая ставка ${new Intl.NumberFormat('ru-RU').format(ctx.settings.baseRate / 100)}`,
          }),
        ]),
        el('label', { class: 'switch' }, [activeToggle, el('span', { text: 'Показывать в форме рейса' })]),
      ],
      submitLabel: customer ? 'Сохранить' : 'Добавить',
      onSubmit: async () => {
        const name = nameInput.value.trim();
        if (name.length < 2) {
          toast('Укажите название заказчика', { error: true });
          return false;
        }
        const payload = {
          name,
          baseRate: baseRateInput.value.trim(), // пусто → глобальная ставка
          active: activeToggle.checked,
        };
        try {
          if (customer) await api.customers('update', { id: customer.id, ...payload });
          else await api.customers('create', payload);
          haptic('success');
          toast(customer ? 'Заказчик обновлён' : 'Заказчик добавлен');
          await refresh();
          emit(EVENTS.journalChanged, { customerChanged: true });
          return true;
        } catch (error) {
          toast(error.message, { error: true });
          return false;
        }
      },
    });
  }

  async function refresh() {
    try {
      const result = await api.customers('list');
      render(result.customers);
    } catch (error) {
      toast(error.message, { error: true });
    }
  }

  root.append(body);
  refresh();

  return { refresh };
}
