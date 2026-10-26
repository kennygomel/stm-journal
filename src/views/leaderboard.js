// src/views/leaderboard.js — недельный рейтинг в четырёх номинациях.
//
// Неделя идёт с понедельника по воскресенье; итоги подводятся в ночь
// с воскресенья на понедельник и остаются в профилях как призы:
// 1 место — 🍌, 2 — 🤡, 3 — 🐔.

import { api } from '../api.js';
import { avatar } from '../avatar.js';
import { animateMoney } from '../counter.js';
import { card, clear, el, mount, placeholder, scrollFade, sectionTitle, toast } from '../dom.js';
import { bynSign, fmtDate, fmtNumber, moneyText } from '../format.js';
import { haptic } from '../telegram.js';

const PRIZE_TITLES = { 1: 'Банан', 2: 'Клоун', 3: 'Петух' };

/** Значение номинации в читаемом виде (доход — деньгами). */
function valueNodes(category, value) {
  if (category.unit === 'money') return [moneyText(value), bynSign()];
  if (category.unit === 'km') return [fmtNumber(value), ' км'];
  if (category.unit === 'hours') return [fmtNumber(value), ' ч'];
  return [fmtNumber(value)];
}

/** Число в статистике анимируем, деньги — счётчиком. */
function valueNode(category, value) {
  const node = el('div', { class: 'board-value' });
  if (category.unit === 'money') {
    animateMoney(node, value);
  } else {
    node.append(...valueNodes(category, value));
  }
  return node;
}

export function leaderboardView(root) {
  let data = null;
  let active = 'income';

  const chips = scrollFade(el('div', { class: 'chips board-chips' }));
  const standings = el('div');
  const result = el('div');
  const myPrizes = el('div');

  function renderChips() {
    clear(chips);
    for (const category of data.categories) {
      chips.append(
        el(
          'button',
          {
            class: `chip${category.id === active ? ' on' : ''}`,
            type: 'button',
            onClick: () => {
              active = category.id;
              haptic('light');
              renderChips();
              renderStandings();
            },
          },
          category.label,
        ),
      );
    }
  }

  function renderStandings() {
    const category = data.categories.find((row) => row.id === active);
    if (!category?.rows.length) {
      mount(standings, placeholder('На этой неделе пока пусто', 'Рейтинг появится, как только появятся рейсы'));
      return;
    }
    mount(
      standings,
      card(
        category.rows.map((row) =>
          el('div', { class: `board-row${row.place <= 3 ? ' board-top' : ''}` }, [
            el('div', { class: 'board-place' }, row.prize || String(row.place)),
            avatar({ name: row.name, photo: row.photo || null, seed: row.userId, size: 'sm' }),
            el('div', { class: 'board-person' }, [
              el('div', { class: 'board-name', text: row.name }),
              row.username ? el('div', { class: 'board-user', text: `@${row.username}` }) : null,
            ]),
            valueNode(category, row.value),
          ]),
        ),
      ),
    );
  }

  function renderLastWeek(lastWeek) {
    const blocks = lastWeek.categories
      .filter((category) => category.rows.length)
      .map((category) =>
        el('div', { class: 'board-last' }, [
          el('div', { class: 'board-last-title', text: category.label }),
          ...category.rows.map((row) =>
            el('div', { class: 'board-last-row' }, [
              el('span', { class: 'board-prize', text: row.prize || '' }),
              el('span', { class: 'board-last-name', text: row.name }),
              el('span', { class: 'board-last-value' }, valueNodes(category, row.value)),
            ]),
          ),
        ]),
      );

    if (!blocks.length) {
      mount(result, sectionTitle('Итоги прошлой недели'), placeholder('Пока без победителей', 'Первые призы появятся после первой полной недели'));
      return;
    }
    mount(
      result,
      sectionTitle(`Итоги прошлой недели · ${fmtDate(lastWeek.from)} — ${fmtDate(lastWeek.to)}`),
      card(blocks),
    );
  }

  function render(root2) {
    mount(
      root2,
      el('div', { class: 'view-hint' }, [
        `Неделя ${fmtDate(data.week.from)} — ${fmtDate(data.week.to)}. `,
        'Призы: 🍌 — первое место, 🤡 — второе, 🐔 — третье. Итоги подводим в ночь с воскресенья на понедельник.',
      ]),
      chips,
      standings,
      result,
      sectionTitle('Мои призы'),
      myPrizes,
    );
  }

  function renderMyPrizes() {
    if (!data.myPrizes.length) {
      mount(myPrizes, el('div', { class: 'view-hint' }, 'Пока без призов — всё впереди.'));
      return;
    }
    const counts = data.myAwards.reduce((acc, row) => {
      acc[row.prize] = (acc[row.prize] || 0) + 1;
      return acc;
    }, {});
    mount(
      myPrizes,
      card([
        el(
          'div',
          { class: 'board-my' },
          Object.entries(counts).map(([prize, count]) =>
            el('span', { class: 'board-my-prize' }, [prize, el('span', { class: 'board-my-count', text: `×${count}` })]),
          ),
        ),
      ]),
    );
  }

  async function load() {
    mount(result, el('div', { class: 'muted', text: 'Считаем рейтинг…' }));
    try {
      data = await api.leaderboard();
      renderChips();
      renderStandings();
      renderLastWeek(data.lastWeek);
      renderMyPrizes();
    } catch (error) {
      toast(error.message, { error: true });
      mount(result, placeholder('Рейтинг недоступен', error.message));
    }
  }

  const body = el('div');
  mount(root, body);
  mount(body, placeholder('Считаем рейтинг…', 'Немного магии — и увидим, кто впереди'));

  async function start() {
    await load();
    render(body);
  }

  start();

  return { refresh: start };
}
