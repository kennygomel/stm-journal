// src/views/rates.js — владелец: глобальные тарифы и доплаты.
//
// Форма отправляет СЫРЫЕ значения в рублях: сервер сам умножает на 100.
// Раньше рубли превращались в копейки здесь и на сервере повторно — сумма
// вырастала в 100 раз.

import { api } from '../api.js';
import { button, card, el, field, input, sectionTitle, sheet, toast } from '../dom.js';
import { bynSign, fmtMoney, fmtNumber, intInput, moneyInput } from '../format.js';
import { haptic } from '../telegram.js';

/** Поля тарифов: деньги — в рублях, лимиты — целые. */
function tariffFields(values) {
  const baseRate = input({ type: 'text', inputmode: 'decimal', value: moneyInput(values.baseRate) });
  const pointsFree = input({ type: 'number', inputmode: 'numeric', min: 0, value: values.pointsFree ?? '' });
  const pointRate = input({ type: 'text', inputmode: 'decimal', value: moneyInput(values.pointRate) });
  const kmFree = input({ type: 'number', inputmode: 'numeric', min: 0, value: values.kmFree ?? '' });
  const kmRate = input({ type: 'text', inputmode: 'decimal', value: moneyInput(values.kmRate) });
  const hoursFree = input({ type: 'number', inputmode: 'numeric', min: 0, value: values.hoursFree ?? '' });
  const hourRate = input({ type: 'text', inputmode: 'decimal', value: moneyInput(values.hourRate) });
  const daysMin = input({ type: 'number', inputmode: 'numeric', min: 0, max: 31, value: values.daysMin ?? '' });
  const daysRate = input({ type: 'text', inputmode: 'decimal', value: moneyInput(values.daysRate) });

  const labelWithSign = (text) => el('label', {}, [text, bynSign()]);

  const content = [
    field('Базовая ставка по умолчанию', baseRate, 'Для заказчиков без своей ставки'),
    el('div', { class: 'field-grid' }, [
      field('Точек в лимите', pointsFree),
      el('div', { class: 'field' }, [labelWithSign('Доплата за точку, '), pointRate]),
    ]),
    el('div', { class: 'field-grid' }, [
      field('Километров в лимите', kmFree),
      el('div', { class: 'field' }, [labelWithSign('Доплата за км, '), kmRate]),
    ]),
    el('div', { class: 'field-grid' }, [
      field('Часов в лимите', hoursFree),
      el('div', { class: 'field' }, [labelWithSign('За 4 часа сверх лимита, '), hourRate]),
    ]),
    el('div', { class: 'field-grid' }, [
      field('Рабочих дней в месяце', daysMin, 'Сколько дней даёт доплату'),
      el('div', { class: 'field' }, [labelWithSign('Доплата за дни, '), daysRate]),
    ]),
  ];

  return {
    content,
    nodes: { baseRate, pointsFree, pointRate, kmFree, kmRate, hoursFree, hourRate, daysMin, daysRate },
  };
}

/** Сырые значения формы в рублях (сервер сам переведёт в копейки). */
export function readTariffInputs(nodes) {
  return {
    baseRate: String(nodes.baseRate.value).trim(),
    pointsFree: intInput(nodes.pointsFree.value),
    pointRate: String(nodes.pointRate.value).trim(),
    kmFree: intInput(nodes.kmFree.value),
    kmRate: String(nodes.kmRate.value).trim(),
    hoursFree: intInput(nodes.hoursFree.value),
    hourRate: String(nodes.hourRate.value).trim(),
    daysMin: intInput(nodes.daysMin.value),
    daysRate: String(nodes.daysRate.value).trim(),
  };
}

export function ratesView(root, ctx) {
  const body = el('div');

  function rateRow(label, value, hint) {
    return el('div', { class: 'list-row' }, [
      el('div', {}, [el('div', { text: label }), hint ? el('div', { class: 'muted', text: hint }) : null]),
      el('div', { class: 'amount' }, value),
    ]);
  }

  function render(settings) {
    ctx.settings = settings;
    body.replaceChildren(
      sectionTitle('Действующие тарифы'),
      card([
        rateRow('Базовая ставка по умолчанию', fmtMoney(settings.baseRate), 'для заказчиков без своей ставки'),
        rateRow('Точек в лимите', fmtNumber(settings.pointsFree), 'включено в базовую ставку'),
        rateRow('Доплата за точку', fmtMoney(settings.pointRate), 'за каждую точку сверх лимита'),
        rateRow('Километров в лимите', `${fmtNumber(settings.kmFree)} км`, 'включено в базовую ставку'),
        rateRow('Доплата за километр', fmtMoney(settings.kmRate), 'за каждый км сверх лимита'),
        rateRow('Часов в лимите', `${fmtNumber(settings.hoursFree)} ч`, 'включено в базовую ставку'),
        rateRow('За 4 часа сверх лимита', fmtMoney(settings.hourRate), 'за каждые полные 4 часа'),
        rateRow('Рабочих дней для доплаты', fmtNumber(settings.daysMin), 'в календарном месяце'),
        rateRow('Доплата за дни месяца', fmtMoney(settings.daysRate), 'если дней не меньше лимита'),
      ]),
      button('Изменить тарифы', { className: 'btn primary btn-block', onClick: () => openForm(settings) }),
      sectionTitle('Пример'),
      card([
        el('div', { class: 'example' }, [
          el('div', { class: 'muted', text: 'Рейс: 15 точек, 500 км, 14 часов' }),
          el('div', { class: 'example-amount' }, fmtMoney(exampleIncome(settings))),
        ]),
      ]),
    );
  }

  function openForm(settings) {
    const { content, nodes } = tariffFields(settings);
    sheet({
      title: 'Тарифы и доплаты',
      content,
      submitLabel: 'Сохранить',
      onSubmit: async () => {
        const values = readTariffInputs(nodes);
        const money = [values.baseRate, values.pointRate, values.kmRate, values.hourRate, values.daysRate];
        if (money.some((value) => value === '')) {
          toast('Заполните все суммы', { error: true });
          return false;
        }
        try {
          const result = await api.rates('save', { settings: values });
          haptic('success');
          toast('Тарифы сохранены');
          render(result.settings);
          return true;
        } catch (error) {
          toast(error.message, { error: true });
          return false;
        }
      },
    });
  }

  function exampleIncome(settings) {
    const extraPoints = Math.max(0, 15 - settings.pointsFree);
    const extraKm = Math.max(0, 500 - settings.kmFree);
    const hours = Math.max(0, 14 - settings.hoursFree);
    const hoursBonus = Math.floor(hours / 4) * settings.hourRate;
    return settings.baseRate + extraPoints * settings.pointRate + extraKm * settings.kmRate + hoursBonus;
  }

  root.append(
    el('div', { class: 'view-hint' }, 'Доплаты общие для всех заказчиков. У заказчика настраивается только его базовая ставка.'),
    body,
  );
  render(ctx.settings);
}
