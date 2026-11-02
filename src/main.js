// src/main.js — оболочка Mini App: вкладки, доступ и точка входа.

import './styles.css';
import { api } from './api.js';
import { button, card, clear, el, mount, placeholder, scrollFade, sectionTitle, toast } from './dom.js';
import { animateMoney, animateNumber } from './counter.js';
import { fmtDate, fmtMoney, fmtNumber } from './format.js';
import { avatar } from './avatar.js';
import { EVENTS, on } from './events.js';
import { closeApp, hasTelegram, initTelegram, setHeaderTheme, tg } from './telegram.js';
import { THEMES, adoptServerTheme, applyTheme, getTheme, onThemeChange, setTheme, watchSystemTheme } from './theme.js';
import { journalView } from './views/journal.js';
import { reportView } from './views/report.js';
import { leaderboardView } from './views/leaderboard.js';
import { ratesView } from './views/rates.js';
import { customersView } from './views/customers.js';
import { usersView } from './views/users.js';
import { recalcView } from './views/recalc.js';
import { bottomNav } from './ui/nav.js';

/**
 * Корень приложения берём в момент рендера, а не один раз при загрузке модуля:
 * так перерисовка не останется привязанной к узлу, который уже убрали из DOM.
 */
const appRoot = () => document.getElementById('app');

// Тема применяется сразу, ещё до запроса профиля: иначе первый кадр мигает.
applyTheme(getTheme());
watchSystemTheme();

/** Тёмная тема в системе прямо сейчас (для «как в системе»). */
function isSystemDark() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
}

/** Иконки выбора темы — авторские SVG, а не юникод-глифы. */
function themeIcon(theme) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `theme-icon${theme === 'system' ? ' filled' : ''}`);
  const add = (tag, attrs) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    svg.append(node);
  };
  if (theme === 'light') {
    add('circle', { cx: '12', cy: '12', r: '4.2' });
    for (let i = 0; i < 8; i += 1) {
      const angle = (Math.PI / 4) * i;
      add('line', {
        x1: (12 + Math.cos(angle) * 7.4).toFixed(2),
        y1: (12 + Math.sin(angle) * 7.4).toFixed(2),
        x2: (12 + Math.cos(angle) * 9.7).toFixed(2),
        y2: (12 + Math.sin(angle) * 9.7).toFixed(2),
      });
    }
  } else if (theme === 'dark') {
    add('path', { d: 'M20.5 14.4A8.6 8.6 0 0 1 9.6 3.5a8.6 8.6 0 1 0 10.9 10.9Z' });
  } else {
    add('circle', { cx: '12', cy: '12', r: '9' });
    add('path', { d: 'M12 3a9 9 0 0 0 0 18Z' });
  }
  return svg;
}

/**
 * Дропдаун темы в шапке. Нативный <select> поверх декоративной оболочки:
 * открывается системным списком (не модалкой), свайпом выбирается тема.
 */
function themeDropdown() {
  const icon = themeIcon(getTheme());
  const select = el('select', { 'aria-label': 'Тема оформления' });
  for (const theme of THEMES) {
    select.append(el('option', { value: theme.id, selected: theme.id === getTheme() }, theme.label));
  }

  const wrap = el('div', { class: 'theme-select' }, [icon, select]);
  let previous = getTheme();

  select.addEventListener('change', async () => {
    const picked = select.value;
    const { saved } = await setTheme(picked);
    previous = picked;
    setHeaderTheme(picked === 'dark' || (picked === 'system' && isSystemDark()));
    if (!saved) toast('Тема применена, но не сохранилась на сервере', { error: true });
  });

  // Тема могла измениться не здесь (сервер, системный медиазапрос) — синхронизируем.
  onThemeChange((theme) => {
    if (select.value !== theme) select.value = theme;
    if (theme === previous) return;
    previous = theme;
    wrap.replaceChild(themeIcon(theme), wrap.firstChild);
  });

  return wrap;
}

/** Стрелка «назад» в левом слоте шапки для вложенных экранов. */
function backButton() {
  const node = el('button', {
    class: 'back-btn',
    type: 'button',
    'aria-label': 'Назад',
    onClick: () => goBack(),
  });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'back-icon');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ['M14.5 6.5 9 12l5.5 5.5']) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  node.append(svg);
  return node;
}

/**
 * Шапка: на верхнем уровне — знак бренда, во вложенном разделе — стрелка назад.
 * @param {HTMLElement} title
 * @param {{ back?: boolean }} [options]
 */
function brandRow(title, { back = false } = {}) {
  const lead = back
    ? backButton()
    : el('img', { class: 'brand-mark', src: '/brand/stm-mark.svg', alt: '', loading: 'eager' });
  return el('div', { class: 'brand-row' }, [lead, title, themeDropdown()]);
}

/** Контекст для разделов: данные загрузки + перезагрузка. */
const ctx = {
  user: null,
  permissions: { journal: true, customers: false, tariffs: false, users: false },
  settings: null,
  customers: [],
  users: [],
  today: null,
  reload: () => loadProfile(),
};

/** Есть ли право; при отсутствии профиля — нет. */
const can = (name) => Boolean(ctx.permissions?.[name]);

async function loadProfile() {
  const profile = await api.me();
  ctx.user = profile.user;
  ctx.permissions = profile.user?.permissions || {
    journal: true,
    customers: Boolean(profile.user?.isAdmin),
    tariffs: Boolean(profile.user?.isOwner),
    users: Boolean(profile.user?.isOwner),
  };
  ctx.settings = profile.settings;
  ctx.customers = profile.customers;
  ctx.today = profile.today;
  adoptServerTheme(profile.user?.theme);
  setHeaderTheme(getTheme() === 'dark' || (getTheme() === 'system' && isSystemDark()));
  return profile;
}

function screen(node) {
  const root = appRoot();
  if (!root) return;
  clear(root).append(node);
}

function fatal(title, message, { retry = false } = {}) {
  const node = el('div', { class: 'empty' }, [
    el('div', { style: { fontSize: '34px', marginBottom: '8px' }, text: '📔' }),
    el('div', { style: { fontWeight: '700', fontSize: '17px', marginBottom: '6px' }, text: title }),
    el('div', { class: 'muted', text: message }),
  ]);
  if (retry) {
    node.append(
      el('div', { style: { marginTop: '14px' } }, [
        button('Повторить', {
          className: 'btn primary',
          onClick: async () => {
            screen(el('div', { class: 'boot', text: 'Загрузка…' }));
            await boot();
          },
        }),
      ]),
    );
  }
  screen(node);
}

const TABS = [
  { id: 'journal', label: 'Журнал' },
  { id: 'report', label: 'История' },
  { id: 'board', label: 'Рейтинг' },
  { id: 'admin', label: 'Админ', adminOnly: true },
];

function parseRoute() {
  const raw = String(window.location.hash || '').replace(/^#\/?/, '');
  const [tab, sub] = raw.split('/');
  if (tab === 'report') return { tab: 'report' };
  if (tab === 'board') return { tab: 'board' };
  if (tab === 'admin') return { tab: 'admin', sub: sub || 'hub' };
  return { tab: 'journal' };
}

/**
 * Навигация. Перерисовываем экран сразу, не полагаясь на событие hashchange:
 * в WebView Telegram (особенно внутри iframe) оно приходит не всегда.
 * Адресную строку обновляем для истории и back-кнопки.
 */
function setRoute(tab, sub, { render = true } = {}) {
  const next = sub ? `#${tab}/${sub}` : `#${tab}`;
  if (currentHash() !== next) {
    try {
      window.location.hash = next;
    } catch (error) {
      console.warn('hash update failed', error);
    }
  }
  if (render) renderRoute();
}

function currentHash() {
  return String(window.location.hash || '');
}

/** Кнопка «Назад» в шапке Telegram: показываем её на вложенных экранах. */
function syncBackButton() {
  const { tab, sub } = parseRoute();
  const nested = (tab === 'admin' && sub !== 'hub') || tab === 'report';
  try {
    if (nested) {
      tg?.BackButton?.show?.();
      tg?.BackButton?.onClick?.(handleBack);
    } else {
      tg?.BackButton?.offClick?.(handleBack);
      tg?.BackButton?.hide?.();
    }
  } catch {
    /* не критично */
  }
}

function handleBack() {
  const { tab, sub } = parseRoute();
  if (tab === 'admin' && sub !== 'hub') {
    setRoute('admin');
    return;
  }
  if (tab === 'report') setRoute('journal');
}

let activeView = null;
let renderToken = 0;

async function renderRoute() {
  if (!ctx.user) return;
  // Защита от гонки: при быстрых переключениях вкладок рисует только последний вызов.
  const token = ++renderToken;
  const route = parseRoute();
  syncBackButton();

  const content = el('div');
  const header = el('div', { class: 'topbar' });

  // Навигация — внизу; в шапке только бренд, заголовок и тема.
  const visibleTabs = TABS.filter((item) => !item.adminOnly || can('customers') || can('tariffs'));
  const nav = bottomNav(visibleTabs, (id) => switchTab(id));
  nav.setActive(route.tab);
  if (can('users')) {
    const pending = ctx.users.filter((row) => row.status === 'pending').length;
    nav.setBadge('admin', pending);
  }

  screen(el('div', {}, [header, content, nav.node]));

  if (route.tab === 'report') {
    header.append(brandRow(el('h1', { text: 'История' })));
    activeView = reportView(content);
    return;
  }

  if (route.tab === 'board') {
    header.append(brandRow(el('h1', { text: 'Рейтинг' })));
    activeView = leaderboardView(content);
    return;
  }

  if (route.tab === 'admin' && (can('customers') || can('tariffs'))) {
    header.append(brandRow(adminTitle(route.sub), { back: Boolean(ADMIN_SECTIONS[route.sub]) }));
    const view = await adminRoute(content, route.sub);
    if (token !== renderToken) return; // уже переключились на другую вкладку
    activeView = view;
    return;
  }

  header.append(brandRow(el('h1', { text: 'Журнал' })));
  activeView = journalView(content, ctx);
}

/**
 * Заголовок админ-раздела: короткое имя раздела вместо длинных крошек.
 * Возврат на панель — кнопка «Назад» в шапке Telegram и вкладка «Админ» внизу,
 * поэтому дублировать навигацию текстом не нужно.
 */
function adminTitle(sub) {
  const titles = {
    rates: 'Тарифы',
    customers: 'Заказчики',
    users: 'Пользователи',
    recalc: 'Пересчёт',
  };
  return el('h1', { text: titles[sub] || 'Админ' });
}

/** Вложенные разделы админки: там лого заменяется стрелкой «назад». */
const ADMIN_SECTIONS = { rates: true, customers: true, users: true, recalc: true };

/** Назад по иерархии: из подраздела — в панель, иначе на журнал. */
function goBack() {
  const { tab, sub } = parseRoute();
  if (tab === 'admin' && ADMIN_SECTIONS[sub]) {
    setRoute('admin');
    return;
  }
  if (tab === 'report') setRoute('journal');
}

/** Переход по вкладке: всегда «на верхний уровень» вкладки. */
function switchTab(tab) {
  setRoute(tab);
}

/** Админ-раздел: хаб и подразделы. */
async function adminRoute(content, sub) {
  if (sub === 'rates' && can('tariffs')) {
    ratesView(content, ctx);
    return { refresh: () => {} };
  }
  if (sub === 'customers' && can('customers')) {
    return customersView(content, ctx);
  }
  if (sub === 'users' && can('users')) {
    return usersView(content, ctx);
  }
  if (sub === 'recalc' && can('tariffs')) {
    return recalcView(content, ctx);
  }
  return adminHub(content);
}

async function adminHub(content) {
  const pending = ctx.users.filter((row) => row.status === 'pending').length;
  const owner = can('tariffs');
  const today = ctx.today;

  // Дашборд: мониторинг до управления. Управление остаётся внизу.
  const board = el('div', { class: 'dashboard' });
  content.append(board);

  if (owner) {
    board.append(el('div', { class: 'muted', text: 'Считаем сводку…' }));
    try {
      const stats = await api.stats({ from: `${today.slice(0, 7)}-01`, to: today });
      mount(board, dashboardBlocks(stats, pending, {}));
      // Аватары догружаем следом и перерисовываем блоки, когда придут.
      api
        .avatars()
        .then(({ avatars = [] }) => {
          const photos = {};
          for (const row of avatars) if (row.photo) photos[row.userId || row.id] = row.photo;
          if (Object.keys(photos).length) mount(board, dashboardBlocks(stats, pending, photos));
        })
        .catch(() => {});
    } catch (error) {
      mount(board, placeholder('Сводка недоступна', error.message));
    }
  }

  const menu = [];
  if (can('customers')) {
    menu.push(menuRow(`Заказчики · ${ctx.customers.length}`, 'Название и базовая ставка', () => setRoute('admin', 'customers')));
  }
  if (owner) {
    menu.push(menuRow('Тарифы и доплаты', 'Точки, километры и часы', () => setRoute('admin', 'rates')));
    menu.push(menuRow('Пересчёт записей', 'Применить новые тарифы к прошлым рейсам', () => setRoute('admin', 'recalc')));
    menu.push(
      menuRow(`Пользователи${pending ? ` · ${pending} ждёт` : ''}`, 'Доступ, админы и права', () => setRoute('admin', 'users')),
    );
  }

  content.append(
    sectionTitle(owner ? 'Управление' : 'Справочник'),
    menu.length ? card(menu) : placeholder('Разделов нет', 'У вашей роли пока нет доступных разделов'),
  );

  return { refresh: () => Promise.resolve() };
}

/** Строка «подпись — значение» внутри карточки журнала. */
function statLine(label, value) {
  return el('div', { class: 'stat-line' }, [
    el('span', { class: 'stat-line-label', text: label }),
    el('span', { class: 'stat-line-value', text: value }),
  ]);
}

/** Процент изменения к прошлому месяцу для подписи под доходом. */
function deltaText(current, previous) {
  if (!previous) return null;
  const diff = ((current - previous) / previous) * 100;
  if (!Number.isFinite(diff)) return null;
  const sign = diff > 0 ? '+' : '';
  return `${sign}${diff.toFixed(0)}% к прошлому месяцу`;
}

/** Столбики дохода по дням: SVG без библиотек, ширина тянется по контейнеру. */
function incomeChart(byDate) {
  const values = byDate.map((row) => row.income);
  const max = Math.max(1, ...values);
  const width = 300;
  const height = 96;
  const gap = 2;
  const barWidth = Math.max(2, (width - gap * Math.max(0, values.length - 1)) / Math.max(1, values.length));

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', 'chart-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Доход по дням месяца');

  byDate.forEach((row, index) => {
    // Дни без дохода не рисуем: иначе по базовой линии тянется ряд точек.
    if (!row.income) return;
    const barHeight = Math.max(2, Math.round((row.income / max) * (height - 6)));
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', String(index * (barWidth + gap)));
    rect.setAttribute('y', String(height - barHeight));
    rect.setAttribute('width', String(barWidth));
    rect.setAttribute('height', String(barHeight));
    rect.setAttribute('rx', '1.5');
    rect.setAttribute('class', 'chart-bar');
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = `${fmtDate(row.date)}: ${fmtNumber(row.income / 100)} ₽`;
    rect.append(title);
    svg.append(rect);
  });

  return svg;
}

/** Карточка «Доход по дням» с датами по краям и максимумом. */
function chartCard(stats) {
  const byDate = stats.byDate || [];
  if (!byDate.length) return null;
  const max = Math.max(...byDate.map((row) => row.income));
  const first = byDate[0];
  const last = byDate[byDate.length - 1];

  return card(
    [
      el('div', { class: 'chart-head' }, [
        el('div', { class: 'chart-title', text: 'Доход по дням' }),
        el('div', { class: 'chart-max' }, ['макс ', ...fmtMoney(max)]),
      ]),
      incomeChart(byDate),
      el('div', { class: 'chart-axis' }, [
        el('span', { text: fmtDate(first.date) }),
        el('span', { class: 'muted', text: `${byDate.length} дн. с записями` }),
        el('span', { text: fmtDate(last.date) }),
      ]),
    ],
    'card chart-card',
  );
}

/** Строка водителя: доход с месячными доплатами и полоска доли. */
function driverRow(row, maxTotal, photos) {
  const total = row.total ?? row.income ?? 0;
  const share = maxTotal ? Math.round((total / maxTotal) * 100) : 0;
  return el('div', { class: 'driver-row' }, [
    el('div', { class: 'driver-head' }, [
      el('div', { class: 'journal-person' }, [
        avatar({ name: row.name, photo: photos[row.userId] || null, seed: row.userId, size: 'sm' }),
        el('div', { class: 'journal-main' }, [
          el('div', { class: 'journal-name', text: row.name }),
          row.username ? el('div', { class: 'journal-user', text: `@${row.username}` }) : null,
        ]),
      ]),
      el('div', { class: 'journal-income' }, fmtMoney(total)),
    ]),
    el('div', { class: 'driver-bar' }, [el('span', { class: 'driver-bar-fill', style: { width: `${share}%` } })]),
    el('div', { class: 'driver-meta' }, [
      `${fmtNumber(row.trips)} записей · ${fmtNumber(row.days)} дн. · ${fmtNumber(row.distance || 0)} км`,
      row.daysBonus || row.monthKmBonus
        ? ` · доплаты ${fmtNumber(((row.daysBonus || 0) + (row.monthKmBonus || 0)) / 100)} ₽`
        : '',
    ]),
  ]);
}

/** Блоки дашборда: сводка, график, водители, заявки и управление. */
function dashboardBlocks(stats, pending, photos = {}) {
  const delta = deltaText(stats.trips.total, stats.previous?.income);
  const kmBonus = stats.trips.kmBonus || 0;

  const blocks = [
    el('div', { class: 'stats' }, [
      el('div', { class: 'stat' }, [
        el('div', { class: 'label', text: 'Пользователи' }),
        (() => {
          const value = el('div', { class: 'value' });
          animateNumber(value, stats.users.total);
          return value;
        })(),
        el('div', { class: 'stat-foot' }, [
          `${stats.users.approved} с доступом`,
          pending ? ` · ${pending} ждёт` : '',
        ]),
      ]),
      el('div', { class: 'stat' }, [
        el('div', { class: 'label', text: 'Журналы' }),
        (() => {
          const value = el('div', { class: 'value' });
          animateNumber(value, stats.trips.journals);
          return value;
        })(),
        el('div', { class: 'stat-foot' }, [`${stats.trips.workingDays} раб. дней`]),
      ]),
      el('div', { class: 'stat' }, [
        el('div', { class: 'label', text: 'Записи за месяц' }),
        (() => {
          const value = el('div', { class: 'value' });
          animateNumber(value, stats.trips.count);
          return value;
        })(),
        el('div', { class: 'stat-foot' }, [`${fmtNumber(stats.trips.distance || 0)} км`]),
      ]),
      el('div', { class: 'stat stat-accent' }, [
        el('div', { class: 'label', text: 'Доход за месяц' }),
        (() => {
          const value = el('div', { class: 'value' });
          animateMoney(value, stats.trips.total);
          return value;
        })(),
        el('div', { class: 'stat-foot' }, [
          delta || (kmBonus ? `включая пробег ${fmtNumber(kmBonus / 100)} ₽` : 'без месячных доплат'),
        ]),
      ]),
    ]),
  ];

  const chart = chartCard(stats);
  if (chart) blocks.push(chart);

  if (stats.journals.length) {
    const maxTotal = Math.max(...stats.journals.map((row) => row.total ?? row.income ?? 0), 1);
    blocks.push(
      sectionTitle('Водители за месяц'),
      card(stats.journals.map((row) => driverRow(row, maxTotal, photos))),
    );
  } else {
    blocks.push(sectionTitle('Водители за месяц'), placeholder('Пока нет записей', 'Записи появятся, когда водители внесут рейсы'));
  }

  if (pending) {
    blocks.push(
      sectionTitle(`Заявки на доступ · ${pending}`),
      card([
        el('button', {
          class: 'list-row row-link',
          type: 'button',
          onClick: () => setRoute('admin', 'users'),
        }, [
          el('div', {}, [
            el('div', { text: 'Одобрить или отклонить' }),
            el('div', { class: 'muted', text: `${pending} чел. ждут решения` }),
          ]),
          el('div', { class: 'row-chevron' }),
        ]),
      ]),
    );
  }

  return blocks;
}

function menuRow(title, subtitle, onClick) {
  return el('div', { class: 'list-row', style: { cursor: 'pointer' }, onClick }, [
    el('div', {}, [el('div', { text: title }), el('div', { class: 'muted', text: subtitle })]),
    el('div', { class: 'row-chevron' }),
  ]);
}

async function loadAdminData() {
  if (!can('users')) return;
  try {
    const [users] = await Promise.all([api.users('list')]);
    ctx.users = users.users;
  } catch (error) {
    console.warn('admin data failed', error);
  }
}

async function boot() {
  if (!hasTelegram()) {
    fatal(
      'Откройте журнал в Telegram',
      'Эта страница работает как Mini App внутри бота. В обычном браузере нет данных для входа — откройте бота и нажмите «Открыть журнал».',
    );
    return;
  }

  initTelegram();

  try {
    await loadProfile();
  } catch (error) {
    const status = error.parameters?.status;
    if (error.parameters?.code === 'ACCESS_DENIED') {
      fatal(
        'Доступ ещё не одобрен',
        status === 'denied'
          ? 'Администратор отклонил запрос. Напишите ему в Telegram.'
          : status === 'blocked'
            ? 'Доступ к журналу закрыт администратором.'
            : 'Заявка отправлена администратору. Обновите страницу после одобрения.',
        { retry: true },
      );
      return;
    }
    fatal('Не удалось загрузить данные', error.message || 'Попробуйте ещё раз', { retry: true });
    return;
  }

  await loadAdminData();

  on(EVENTS.journalChanged, async () => {
    try {
      await loadProfile();
    } catch (error) {
      console.warn('profile refresh failed', error);
    }
    activeView?.refresh?.();
  });

  window.addEventListener('hashchange', () => {
    renderRoute();
  });

  await renderRoute();
}

boot();
