// tests/ui-smoke.mjs — прогоняет собранный бандл Mini App в поддельном DOM
// и проверяет, что основные экраны рендерятся и считают суммы.
//
//   npm run build && node tests/ui-smoke.mjs

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`  ✗ ${name}\n      ${error.message}`);
  }
}

// --------------------------------------------------------------- мини-DOM

class FakeClassList {
  constructor(node) {
    this.node = node;
  }
  _list() {
    return String(this.node.className || '')
      .split(/\s+/)
      .filter(Boolean);
  }
  contains(name) {
    return this._list().includes(name);
  }
  add(...names) {
    this.node.className = [...new Set([...this._list(), ...names])].join(' ');
  }
  remove(...names) {
    this.node.className = this._list()
      .filter((item) => !names.includes(item))
      .join(' ');
  }
  toggle(name, force) {
    const on = force === undefined ? !this.contains(name) : Boolean(force);
    if (on) this.add(name);
    else this.remove(name);
    return on;
  }
}

class FakeNode {
  constructor(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.style = {};
    this.dataset = {};
    this._text = '';
    this._html = '';
    this.listeners = {};
    this.classList = new FakeClassList(this);
    this.disabled = false;
    this.value = '';
    this.checked = false;
    this.hidden = false;
    this.className = '';
    this.id = '';
    this.type = '';
    this.placeholder = '';
  }
  get firstChild() {
    return this.children[0] || null;
  }
  get textContent() {
    if (this._text) return this._text;
    return this.children.map((child) => child.textContent ?? '').join('');
  }
  set textContent(value) {
    this.children = [];
    this._text = String(value ?? '');
  }
  get innerHTML() {
    return this._html;
  }
  set innerHTML(value) {
    this._html = String(value ?? '');
    this.children = [];
    this._text = '';
  }
  append(...nodes) {
    for (const node of nodes) {
      if (node === null || node === undefined || node === false) continue;
      const child = node instanceof FakeNode ? node : Object.assign(new FakeNode('#text'), { textContent: String(node) });
      // Как настоящий DOM: append переносит узел, а не клонирует.
      if (child.parentNode && child.parentNode !== this) child.parentNode.removeChild(child);
      if (child.parentNode === this) continue;
      child.parentNode = this;
      this.children.push(child);
    }
  }
  appendChild(node) {
    this.append(node);
    return node;
  }
  replaceChildren(...nodes) {
    this.children = [];
    this._text = '';
    this._html = '';
    this.append(...nodes);
  }
  removeChild(node) {
    const index = this.children.indexOf(node);
    if (index >= 0) this.children.splice(index, 1);
    node.parentNode = null;
    return node;
  }
  replaceChild(next, previous) {
    const index = this.children.indexOf(previous);
    if (index < 0) return previous;
    this.children[index] = next;
    next.parentNode = this;
    previous.parentNode = null;
    return previous;
  }
  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }
  addEventListener(type, handler) {
    const name = String(type).toLowerCase();
    (this.listeners[name] ||= []).push(handler);
  }
  removeEventListener(type, handler) {
    const name = String(type).toLowerCase();
    this.listeners[name] = (this.listeners[name] || []).filter((item) => item !== handler);
  }
  async click() {
    for (const handler of this.listeners.click || []) {
      await handler({ preventDefault() {}, currentTarget: this, target: this });
    }
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'class') this.className = String(value);
    if (name === 'id') this.id = String(value);
    if (name === 'value') this.value = String(value);
  }
  getAttribute(name) {
    return this.attributes[name];
  }
  removeAttribute(name) {
    delete this.attributes[name];
  }
  querySelector() {
    return null;
  }
  querySelectorAll() {
    return [];
  }
  get isConnected() {
    return true;
  }
  walk() {
    return [this, ...this.children.flatMap((child) => child.walk())];
  }
  text() {
    return this.textContent;
  }
  find(predicate) {
    return this.walk().find(predicate) || null;
  }
  findAll(predicate) {
    return this.walk().filter(predicate);
  }
}

const byId = new Map();
const body = new FakeNode('body');
const rootElement = new FakeNode('html');
rootElement.style.setProperty = () => {};
rootElement.style.removeProperty = () => {};
const documentStub = {
  body,
  documentElement: rootElement,
  createElement: (tag) => new FakeNode(tag),
  createElementNS: (_namespace, tag) => new FakeNode(tag),
  createTextNode: (text) => Object.assign(new FakeNode('#text'), { textContent: text }),
  getElementById: (id) => byId.get(id) || null,
  addEventListener() {},
  removeEventListener() {},
  querySelector: () => null,
  querySelectorAll: () => [],
};

function resetDocument() {
  byId.clear();
  body.replaceChildren();
  const app = new FakeNode('div');
  app.id = 'app';
  byId.set('app', app);
  body.append(app);
  const toast = new FakeNode('div');
  toast.id = 'toast';
  toast.hidden = true;
  byId.set('toast', toast);
}

// ------------------------------------------------------ Telegram + эндпоинты

const callLog = [];
let lastRatePayload = null;
let lastRecalc = null;
let initData = { user: { id: 323173181, first_name: 'Ignat', username: 'owner' } };
const windowListeners = new Map();

const telegram = {
  initData: 'query_id=test',
  initDataUnsafe: initData,
  themeParams: { bg_color: '#ffffff', text_color: '#000000' },
  ready() {},
  expand() {},
  close() {},
  disableVerticalSwipes() {},
  setHeaderColor() {},
  setBackgroundColor() {},
  onEvent() {},
  showConfirm(_message, cb) {
    cb(true);
  },
  showAlert() {},
  /** Выбор в нативном попапе: тест подставляет нужный id. */
  showPopup(_params, cb) {
    cb(globalThis.__popupChoice ?? null);
  },
  HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
  BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
  Serverless: {
    callAsync(name, payload) {
      callLog.push({ name, payload });
      return handlers[name] ? handlers[name](payload) : Promise.resolve({});
    },
  },
};

const RATES = { baseRate: 250000, pointsFree: 12, pointRate: 200, kmFree: 300, kmRate: 20, hoursFree: 8, hourRate: 2000, daysMin: 23, daysBonusTable: { 23: 2500, 24: 5000, 25: 10000, 26: 15000, 27: 20000, 28: 25000, 29: 30000, 30: 40000, 31: 50000 } };
const GLOBAL = { baseRate: 12000, pointsFree: 12, pointRate: 200, kmFree: 300, kmRate: 20, hoursFree: 8, hourRate: 2000, daysMin: 23, daysBonusTable: { 23: 2500, 24: 5000, 25: 10000, 26: 15000, 27: 20000, 28: 25000, 29: 30000, 30: 40000, 31: 50000 } };

const store = {
  customers: [
    { id: 1, name: 'СТМ-Логистика', active: true, baseRate: 250000, ownBaseRate: 250000, globalBaseRate: 12000 },
    { id: 2, name: 'Евротранс', active: true, baseRate: 12000, ownBaseRate: null, globalBaseRate: 12000 },
  ],
  // 15 точек, 500 км, 14 часов по ставкам СТМ
  trips: [
    { id: 1, date: '2026-10-05', customerId: 1, customerName: 'СТМ-Логистика', points: 15, distance: 500, hours: 14, income: 256600, daysBonus: 15000, rates: RATES },
  ],
  settings: GLOBAL,
  users: [{ id: 4, tgId: 323173181, name: 'Ignat', username: 'owner', status: 'approved', isAdmin: true, isOwner: true, createdAt: '2026-10-01T00:00:00.000Z' }],
};

let currentUser = {
  id: 4,
  tgId: 323173181,
  name: 'Ignat',
  username: 'owner',
  isAdmin: true,
  isOwner: true,
  permissions: { journal: true, customers: true, tariffs: true, users: true },
};

const handlers = {
  me: async () => ({
    user: currentUser,
    settings: store.settings,
    customers: store.customers,
    today: '2026-10-11',
  }),
  listTrips: async () => ({ range: {}, trips: store.trips }),
  createTrip: async (payload) => {
    const customer = store.customers.find((row) => row.id === payload.customerId);
    const rates = { ...store.settings, baseRate: customer.baseRate };
    const extraHours = Math.max(0, (payload.hours || 0) - rates.hoursFree);
    const income =
      rates.baseRate +
      Math.max(0, payload.points - rates.pointsFree) * rates.pointRate +
      Math.max(0, payload.distance - rates.kmFree) * rates.kmRate +
      (extraHours > 0 ? rates.hourRate : 0);
    const trip = { id: store.trips.length + 1, ...payload, customerName: customer.name, income, rates };
    store.trips.push(trip);
    return { trip };
  },
  updateTrip: async (payload) => ({ trip: { ...payload } }),
  deleteTrip: async () => ({ id: 1 }),
  report: async () => ({
    from: '2026-10-01',
    to: '2026-10-31',
    totals: {
      trips: 1,
      income: 256600,
      total: 271600,
      daysBonus: 15000,
      workingDays: 26,
      daysMin: 23,
      points: 15,
      distance: 500,
      hours: 14,
      extraPoints: 3,
      extraKm: 200,
      extraHours: 2,
      avgIncome: 256600,
    },
    byCustomer: [
      { customerId: 1, customerName: 'СТМ-Логистика', trips: 1, points: 15, distance: 500, hours: 14, income: 256600 },
    ],
    byDate: [{ date: '2026-10-05', trips: 1, income: 256600, points: 15, distance: 500, hours: 14 }],
    today: '2026-10-11',
  }),
  adminCustomers: async (payload = {}) => {
    if (payload.action === 'create') {
      const own = payload.baseRate === '' || payload.baseRate === undefined ? null : Math.round(Number(String(payload.baseRate).replace(',', '.')) * 100);
      const created = {
        id: store.customers.length + 1,
        name: payload.name,
        active: true,
        baseRate: own === null ? store.settings.baseRate : own,
        ownBaseRate: own,
        globalBaseRate: store.settings.baseRate,
      };
      store.customers.push(created);
      return { customer: created };
    }
    return { customers: store.customers, settings: store.settings };
  },
  // сервер принимает РУБЛИ и сам переводит в копейки
  adminRates: async (payload = {}) => {
    if (payload.action === 'save') {
      const rub = (value) => Math.round(Number(String(value).replace(',', '.')) * 100);
      const raw = payload.settings || {};
      store.settings = {
        ...store.settings,
        baseRate: rub(raw.baseRate),
        pointsFree: Number(raw.pointsFree),
        pointRate: rub(raw.pointRate),
        kmFree: Number(raw.kmFree),
        kmRate: rub(raw.kmRate),
        hoursFree: Number(raw.hoursFree),
        hourRate: rub(raw.hourRate),
      };
      lastRatePayload = raw;
    }
    return { settings: store.settings };
  },
  adminUsers: async () => ({ users: store.users }),
  leaderboard: async () => ({
    today: '2026-10-19',
    week: { weekStart: '2026-10-19', from: '2026-10-19', to: '2026-10-25', endsAt: '2026-10-25' },
    categories: [
      { id: 'income', label: 'Доход', unit: 'money', rows: [
        { userId: 4, place: 1, prize: '🍌', value: 256600, trips: 3, name: 'Ignat Rychkov', username: 'ignatrychkov', photo: 'data:image/jpeg;base64,BBBB' },
        { userId: 9, place: 2, prize: '🤡', value: 100000, trips: 2, name: 'Торнике', username: 'nik_nagibatel' },
        { userId: 5, place: 3, prize: '🐔', value: 50000, trips: 1, name: 'Третий', username: null },
      ] },
      { id: 'points', label: 'Точки', unit: 'count', rows: [{ userId: 9, place: 1, prize: '🍌', value: 120, trips: 5, name: 'Торнике', username: 'nik_nagibatel' }] },
      { id: 'distance', label: 'Пробег', unit: 'km', rows: [{ userId: 5, place: 1, prize: '🍌', value: 700, trips: 2, name: 'Третий', username: null }] },
      { id: 'hours', label: 'Время', unit: 'hours', rows: [{ userId: 4, place: 1, prize: '🍌', value: 32, trips: 3, name: 'Ignat Rychkov', username: 'ignatrychkov' }] },
    ],
    lastWeek: { weekStart: '2026-10-12', from: '2026-10-12', to: '2026-10-18', created: 0, categories: [
      { id: 'income', label: 'Доход', unit: 'money', rows: [{ userId: 9, place: 1, prize: '🍌', value: 500000, name: 'Торнике', username: 'nik_nagibatel' }] },
    ] },
    myPrizes: ['🍌'],
    myAwards: [{ weekStart: '2026-10-12', category: 'income', place: 1, value: 500000, prize: '🍌' }],
  }),
  adminAvatars: async () => ({ avatars: [{ id: 4, photo: 'data:image/jpeg;base64,AAAA' }] }),
  adminStats: async () => ({
    period: { from: '2026-10-01', to: '2026-10-15' },
    users: { total: 7, approved: 5, pending: 1, denied: 1, admins: 2 },
    trips: { count: 48, journals: 3, workingDays: 26, income: 480000, daysBonus: 15000, total: 495000, avgIncome: 10000, daysMin: 23 },
    journals: [
      { userId: 4, name: 'Торнике', username: 'nik_nagibatel', trips: 20, income: 200000, days: 9, lastDate: '2026-10-14' },
      { userId: 5, name: 'Александрович', username: null, trips: 18, income: 180000, days: 8, lastDate: '2026-10-13' },
    ],
  }),
  adminRecalc: async (payload = {}) => {
    lastRecalc = payload;
    if (payload.apply) {
      // имитируем применение: суммы записей становятся «новыми»
      for (const trip of store.trips) trip.income = 260000;
      return { from: payload.from, to: payload.to, applied: true, total: store.trips.length, changed: store.trips.length, incomeBefore: 254600, incomeAfter: 260000, delta: 5400, users: [{ userId: 4, total: 1, changed: 1, delta: 5400 }], items: [] };
    }
    return {
      from: payload.from, to: payload.to, applied: false, total: 3, changed: 2,
      incomeBefore: 254600, incomeAfter: 260000, delta: 5400,
      users: [{ userId: 4, total: 2, changed: 1, delta: 3000 }, { userId: 5, total: 1, changed: 1, delta: 2400 }],
      items: [
        { id: 1, date: '2026-10-05', userId: 4, customerName: 'СТМ-Логистика', customerMissing: false, incomeBefore: 254600, incomeAfter: 257600, delta: 3000 },
        { id: 2, date: '2026-10-04', userId: 5, customerName: 'Евротранс', customerMissing: true, incomeBefore: 0, incomeAfter: 2400, delta: 2400 },
      ],
    };
  },
};

// Vite's module-preload polyfill использует MutationObserver.
globalThis.MutationObserver = class {
  observe() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
};

/** Как настоящий location: установка hash уведомляет слушателей (как браузер). */
const fakeLocation = {
  _hash: '',
  get hash() {
    return this._hash;
  },
  set hash(value) {
    const next = String(value);
    this._hash = next;
    dispatchWindow('hashchange');
  },
};

function dispatchWindow(type) {
  // WebView Telegram может не прислать hashchange — тест это умеет эмулировать.
  if (type === 'hashchange' && globalThis.__ignoreHashchange) return;
  for (const handler of windowListeners.get(type) || []) handler({ type });
}

const localStorageData = new Map();
const fakeLocalStorage = {
  getItem: (key) => (localStorageData.has(key) ? localStorageData.get(key) : null),
  setItem: (key, value) => localStorageData.set(key, String(value)),
  removeItem: (key) => localStorageData.delete(key),
  clear: () => localStorageData.clear(),
};

globalThis.window = {
  Telegram: { WebApp: telegram },
  localStorage: fakeLocalStorage,
  matchMedia: (query) => ({ matches: String(query).includes('prefers-reduced-motion'), addEventListener() {}, removeEventListener() {} }),
  get location() {
    return fakeLocation;
  },
  addEventListener(type, handler) {
    (windowListeners.get(type) || windowListeners.set(type, []).get(type)).push(handler);
  },
  removeEventListener() {},
  confirm: () => true,
  alert() {},
};

function setHash(value) {
  fakeLocation._hash = String(value);
}
globalThis.document = documentStub;
globalThis.Node = FakeNode;

const flush = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

/** Закрывает все открытые шторки: проверки не должны влиять друг на друга. */
function closeSheets() {
  for (const sheet of body.findAll((node) => node.classList.contains('sheet-backdrop'))) sheet.remove();
}

// ------------------------------------------------------------------ прогон

const assetsDir = new URL('../dist/assets/', import.meta.url);
const bundleFile = readdirSync(assetsDir).find((file) => file.endsWith('.js'));
const code = readFileSync(new URL(bundleFile, assetsDir), 'utf8');

resetDocument();
await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
await flush(60);

// Ссылка на корень — динамическая: между проверками DOM пересоздаётся.
const appNode = () => byId.get('app');
const allText = () => appNode().textContent;

console.log('\nMini App (собранный бандл, поддельный DOM)');

await check('в CSS есть отступы сверху, контент не липнет к шапке', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync('src/styles.css', 'utf8');
  assert.match(css, /#app\s*\{[^}]*padding:[^;]*env\(safe-area-inset-top\)/s, 'у #app есть верхний отступ');
  assert.match(css, /margin: 0 calc\(var\(--s3\) \* -1\) var\(--s4\)/, 'шапка отделена снизу');
  assert.match(css, /\.topbar \{[^}]*padding: var\(--s4\)/s, 'у шапки вертикальные отступы');
  assert.match(css, /\.summary-meta \{[^}]*gap: var\(--s2\) var\(--s4\)/s, 'у показателей есть отступы');
  assert.match(css, /\.metric-icon \{/s, 'иконки показателей описаны в стилях');
});

await check('загружает профиль и список рейсов', () => {
  assert.ok(callLog.some((entry) => entry.name === 'me'), 'me вызван');
  assert.ok(callLog.some((entry) => entry.name === 'listTrips'), 'listTrips вызван');
});

await check('журнал показывает записи и сумму за период', () => {
  const text = allText();
  assert.match(text, /СТМ-Логистика/, 'имя заказчика на экране');
  assert.match(text, /2\s?566/, 'сумма на экране');
  assert.match(text, /Журнал/, 'заголовок');
  assert.match(text, /15\s?точек|15 точек/, 'точки в строке записи');
  assert.match(text, /500 км/, 'пробег в строке записи');
  assert.match(text, /14 часов/, 'часы в строке записи');
  assert.match(text, /\+4 ч сверх лимита/, 'видно превышение по часам (один шаг × 4)');
});

await check('сводка журнала: показатели с иконками и отступами', () => {
  const meta = appNode().find((node) => node.classList.contains('summary-meta'));
  assert.ok(meta, 'блок показателей есть');
  const metrics = meta.findAll((node) => node.classList.contains('metric'));
  assert.equal(metrics.length, 4, 'четыре показателя: рейсы, точки, пробег, часы');
  const icons = meta.findAll((node) => node.classList.contains('metric-icon'));
  assert.equal(icons.length, 4, 'у каждого показателя своя иконка');
  // В настоящем DOM tagName у SVG — 'svg', заглушка отдаёт верхний регистр.
  assert.ok(
    icons.every((node) => node.tagName.toLowerCase() === 'svg' && node.children.length > 0),
    'иконки — это SVG с контуром, а не текст',
  );
  const values = metrics.map((node) => node.textContent);
  assert.ok(values.some((value) => /км/.test(value)), 'пробег с единицей измерения');
  assert.ok(values.some((value) => /ч/.test(value)), 'часы с единицей измерения');
  assert.ok(!/т\./.test(meta.textContent), 'текстовых подписей «т.» больше нет');
});

await check('знак BYN рисуется шрифтом nbrb (нет символа ₽)', () => {
  const text = allText();
  assert.ok(!text.includes('₽'), 'старый символ рубля убран');
  const signs = appNode().findAll((node) => node.classList.contains('nbrb-icon'));
  assert.ok(signs.length > 0, 'знак BYN отрисован');
  for (const sign of signs) assert.equal(sign.textContent, '\uE901', 'шрифтовой код U+E901');
});

await check('шапка: бренд, заголовок и селект темы в одну строку', async () => {
  const row = appNode().find((node) => node.classList.contains('brand-row'));
  assert.ok(row, 'строка бренда есть');
  const select = row.find((node) => node.classList.contains('theme-select'));
  assert.ok(select, 'селект темы в шапке');
  assert.ok(select.classList.contains('theme-select'), 'стили селекта на месте');
  const { readFileSync } = await import('node:fs');
  const css = readFileSync('src/styles.css', 'utf8');
  assert.match(css, /\.theme-select \{[^}]*min-width: 132px/s, 'у селекта есть место под подпись');
  assert.match(css, /\.brand-row \{[^}]*display: flex/s, 'шапка — одна строка');
});

await check('в шапке знак бренда и кнопка темы', () => {
  const mark = appNode().find((node) => node.classList.contains('brand-mark'));
  assert.ok(mark, 'знак бренда в шапке');
  assert.match(mark.getAttribute('src'), /stm-mark\.svg$/, 'используется icon-only SVG');
  const themeSelect = appNode().find((node) => node.classList.contains('theme-select'));
  assert.ok(themeSelect, 'дропдаун темы есть');
  const select = themeSelect.find((node) => node.tagName.toLowerCase() === 'select');
  assert.ok(select, 'внутри дропдауна нативный select');
  const options = select.findAll((node) => node.tagName.toLowerCase() === 'option').map((node) => node.textContent);
  assert.deepEqual(options, ['Светлая', 'Тёмная', 'Системная'], 'три варианта темы');
  assert.ok(themeSelect.find((node) => node.classList.contains('theme-icon')), 'у дропдауна есть иконка');
});

await check('выбор в дропдауне применяет и сохраняет тему', async () => {
  const select = appNode()
    .find((node) => node.classList.contains('theme-select'))
    .find((node) => node.tagName.toLowerCase() === 'select');

  select.value = 'dark';
  for (const handler of select.listeners.change || []) await handler({});
  await flush(40);

  assert.equal(rootElement.getAttribute('data-theme'), 'dark', 'тема применилась к <html>');
  assert.equal(localStorageData.get('journal:theme'), 'dark', 'запомнили локально');
  assert.equal(
    callLog.filter((entry) => entry.name === 'saveTheme').at(-1)?.payload?.theme,
    'dark',
    'отправили на сервер',
  );

  // «как в системе» — атрибут снимается, решает медиазапрос
  select.value = 'system';
  for (const handler of select.listeners.change || []) await handler({});
  await flush(40);
  assert.equal(rootElement.getAttribute('data-theme'), undefined, 'system → атрибут снят');
  assert.equal(localStorageData.get('journal:theme'), 'system');
});

await check('серверная тема сильнее локальной при запуске', async () => {
  localStorageData.set('journal:theme', 'light');
  currentUser = { ...currentUser, theme: 'dark' };
  resetDocument();
  setHash('');
  await import(`data:text/javascript;base64,${Buffer.from(`${code}\n// theme from server`).toString('base64')}`);
  await flush(60);
  assert.equal(rootElement.getAttribute('data-theme'), 'dark', 'применилась тема из профиля');
  currentUser = { ...currentUser, theme: null };
  localStorageData.set('journal:theme', 'light');
});

await check('нижний бар: Журнал, История, Рейтинг и Админ', () => {
  const tabs = appNode()
    .findAll((node) => node.tagName.toLowerCase() === 'button' && node.classList.contains('nav-item'))
    .map((node) => node.textContent);
  assert.deepEqual(tabs, ['Журнал', 'История', 'Рейтинг', 'Админ']);
});

await check('форма рейса открывается и считает доход с надбавками', async () => {
  closeSheets();
  const addButton = appNode().find((node) => node.tagName.toLowerCase() === 'button' && /Рейс/.test(node.textContent) && node.classList.contains('btn-add'));
  assert.ok(addButton, 'кнопка записи рейса найдена');
  await addButton.click();
  const sheet = body.find((node) => node.classList.contains('sheet'));
  assert.ok(sheet, 'шторка открыта');
  assert.match(sheet.textContent, /Новый рейс/);

  const inputs = sheet.findAll((node) => node.tagName.toLowerCase() === 'input');
  const [date, points, distance, hours] = inputs;
  assert.ok(date && points && distance, 'поля даты, точек и пробега');
  assert.ok(hours, 'поле часов есть в форме рейса');
  const labels = sheet.findAll((node) => node.tagName.toLowerCase() === 'label').map((node) => node.textContent);
  assert.ok(labels.some((text) => /Часов/.test(text)), 'подпись «Часов» найдена');
  const select = sheet.find((node) => node.tagName.toLowerCase() === 'select');
  select.value = '1';
  for (const handler of select.listeners.change || []) await handler({});
  points.value = '15';
  distance.value = '500';
  hours.value = '14';
  for (const handler of points.listeners.input || []) await handler({});
  const preview = sheet.find((node) => node.classList.contains('preview'));
  // 15 точек (3 сверх), 500 км (100 сверх), 14 ч (6 сверх лимита 8 → 1 шаг по 4 ч)
  assert.match(preview.textContent, /2\s?566/, 'предпросмотр: 2 566 ₽ за рейс');
  assert.match(preview.textContent, /1×4 ч сверх лимита/, 'часы считаются шагами по 4');
  assert.equal(hours.value, '14', 'часы попадают в форму');
  closeSheets();
  assert.ok(
    preview.findAll((node) => node.classList.contains('nbrb-icon')).length >= 4,
    'в расшифровке есть знаки BYN (база, точки, км, часы)',
  );
});

// Регрессия: вкладки должны работать по обычному клику, без опоры на hashchange
// (в WebView Telegram это событие приходит не всегда).
await check('клик по «История» в нижнем баре переключает экран без hashchange', async () => {
  const tab = byId
    .get('app')
    .findAll((node) => node.tagName.toLowerCase() === 'button' && node.classList.contains('nav-item'))
    .find((node) => node.textContent === 'История');
  assert.ok(tab, 'вкладка «История» найдена');
  globalThis.__ignoreHashchange = true;
  await tab.click();
  globalThis.__ignoreHashchange = false;
  await flush(60);
  assert.match(appNode().textContent, /Баланс за период|Считаем/, 'экран истории отрисован');
});

await check('клик по «Админ» в нижнем баре переключает экран без hashchange', async () => {
  const tab = byId
    .get('app')
    .findAll((node) => node.tagName.toLowerCase() === 'button' && node.classList.contains('nav-item'))
    .find((node) => node.textContent.startsWith('Админ'));
  assert.ok(tab, 'вкладка «Админ» найдена');
  globalThis.__ignoreHashchange = true;
  await tab.click();
  globalThis.__ignoreHashchange = false;
  await flush(60);
  assert.match(appNode().textContent, /Админ/, 'открылась панель управления');
});

await check('раздел «История» показывает баланс за период', async () => {
  setHash('#report');
  dispatchWindow('hashchange');
  await flush(60);
  const text = allText();
  assert.match(text, /Баланс за период/, 'заголовок баланса');
  assert.match(text, /2\s?716/, 'сумма баланса с доплатой за дни');
  assert.match(text, /По заказчикам/, 'разбивка по заказчикам');
  assert.match(text, /По дням/, 'разбивка по дням');

  const balance = appNode().find((node) => node.classList.contains('amount'));
  const meta = appNode().find((node) => node.classList.contains('balance-meta'));
  assert.ok(meta, 'показатели баланса есть');
  assert.equal(meta.findAll((node) => node.classList.contains('metric-icon')).length, 4, 'дни, точки, пробег, часы');
  const foot = appNode().find((node) => node.classList.contains('balance-foot'));
  assert.ok(foot, 'строка с рейсами есть');
  assert.ok(foot.findAll((node) => node.classList.contains('metric-icon')).length >= 1, 'рейсы с иконкой');
  assert.ok(balance, 'сумма баланса на месте');
});

await check('в разметке нет текстового «null»', async () => {
  setHash('#report');
  dispatchWindow('hashchange');
  await flush(60);
  const { readFileSync } = await import('node:fs');
  const dom = readFileSync('src/dom.js', 'utf8');
  assert.match(dom, /export function mount\(/, 'есть безопасная вставка mount');
  assert.match(dom, /export function add\(/, 'есть безопасное добавление add');
  // на экране истории нет текстового «null»
  assert.ok(!/null/.test(appNode().textContent), 'нет «null» в тексте истории');
  setHash('#admin');
  dispatchWindow('hashchange');
  await flush(60);
  assert.ok(!/null/.test(appNode().textContent), 'нет «null» в админке');
});

await check('плейсхолдеры вместо пустоты в пользователях', async () => {
  // без заявок: сначала проверяем ветку пустого списка
  store.users = [{ id: 4, tgId: 323173181, name: 'Ignat', username: 'owner', status: 'approved', isAdmin: true, isOwner: true, createdAt: '2026-10-01T00:00:00.000Z' }];
  setHash('#admin/users');
  dispatchWindow('hashchange');
  await flush(60);
  const text = appNode().textContent;
  assert.match(text, /Заявок нет/, 'плейсхолдер вместо пустого блока заявок');
  assert.match(text, /после \/start в боте/, 'подсказка, что делать дальше');
  assert.ok(!/null|undefined/i.test(text), 'никаких null/undefined на экране');
  // возвращаем заявку для последующих проверок
  store.users.push({ id: 5, tgId: 555, name: 'Очень Длинное Имя Пользователя Для Проверки', username: 'verylongusername', status: 'pending', isAdmin: false, isOwner: false, createdAt: '2026-10-01T00:00:00.000Z' });
  setHash('#admin');
  dispatchWindow('hashchange');
  await flush(60);
});

await check('градиент затухания у горизонтальных лент с обеих сторон', async () => {
  setHash('#report');
  dispatchWindow('hashchange');
  await flush(60);
  const chips = appNode().find((node) => node.classList.contains('chips'));
  assert.ok(chips, 'лента фильтров есть');

  const { readFileSync } = await import('node:fs');
  const css = readFileSync('src/styles.css', 'utf8');
  const block = css.slice(css.indexOf('.chips {'), css.indexOf('.chips.at-start'));
  assert.match(block, /-webkit-mask-image:[^;]*linear-gradient\(to right/, 'гаснет правый край');
  assert.match(block, /-webkit-mask-composite: source-in/, 'маски пересекаются (WebKit)');
  assert.match(block, /mask-composite: intersect/, 'маски пересекаются (стандарт)');
  // левый и правый градиент описаны в одной маске
  const gradients = block.match(/linear-gradient/g) || [];
  assert.ok(gradients.length >= 4, 'две маски: слева и справа');
  // у краёв затухание снимается соответствующей стороной
  assert.match(css, /\.chips\.at-start \{[^}]*to right, #000/s, 'в начале ленты левый край не гасится');
  assert.match(css, /\.chips\.at-end \{[^}]*to left, #000/s, 'в конце ленты правый край не гасится');
});

await check('админ-раздел: короткий заголовок без крошек', async () => {
  setHash('#admin/recalc');
  dispatchWindow('hashchange');
  await flush(60);
  const title = appNode().find((node) => node.tagName.toLowerCase() === 'h1');
  assert.ok(title, 'заголовок есть');
  assert.equal(title.textContent, 'Пересчёт', 'короткий заголовок раздела');
  assert.ok(!appNode().find((node) => node.classList.contains('crumbs')), 'хлебных крошек нет');
  const { readFileSync } = await import('node:fs');
  const main = readFileSync('src/main.js', 'utf8');
  assert.ok(!/breadcrumbs\(/.test(main), 'крошки больше не рендерятся');
});

await check('история: фильтры и сводка разведены по воздуху', async () => {
  setHash('#report');
  dispatchWindow('hashchange');
  await flush(60);
  const { readFileSync } = await import('node:fs');
  const css = readFileSync('src/styles.css', 'utf8');
  assert.match(css, /\.report-filters[^}]*gap: var\(--s3\)/s, 'фильтры с зазором');
  assert.match(css, /\.card\.balance[^}]*gap: var\(--s4\)/s, 'сводка с зазором между частями');
  assert.match(css, /\.balance-meta[^}]*border-top/s, 'показатели отделены линией');
  assert.match(css, /\.balance-days[^}]*border-top/s, 'доплата за дни отделена линией');
  const filters = appNode().find((node) => node.classList.contains('report-filters'));
  assert.ok(filters, 'блок фильтров на экране');
  const balance = appNode().find((node) => node.classList.contains('balance'));
  assert.ok(balance, 'карточка баланса на экране');
});

await check('дни: в истории есть рабочие дни и доплата за дни', async () => {
  setHash('#report');
  dispatchWindow('hashchange');
  await flush(60);
  const text = appNode().textContent;
  assert.match(text, /дн\./, 'показатель рабочих дней');
  assert.match(text, /Доплата за дни: 26 дн\./, 'доплата за дни по таблице');
  assert.match(text, /150/, '26 дней → 150 ₽');
  assert.match(text, /2\s?716/, 'баланс с доплатой за дни');
});

await check('тарифы: таблица доплат за дни 23 → 25 ₽ … 31 → 500 ₽', async () => {
  closeSheets();
  setHash('#admin/rates');
  dispatchWindow('hashchange');
  await flush(80);
  const text = appNode().textContent;
  assert.match(text, /Доплата за дни месяца/, 'блок таблицы');
  assert.match(text, /23 дня/, 'первая строка — 23 дня');
  assert.match(text, /31 день/, 'последняя строка — 31 день');
  assert.match(text, /500/, '31 день → 500 ₽');
  assert.match(text, /Меньше 23 рабочих дней/, 'пояснение про порог');
  const { readFileSync } = await import('node:fs');
  const days = readFileSync('src/days.js', 'utf8');
  for (const kopecks of ['2500', '5000', '10000', '50000']) {
    assert.ok(days.includes(`${kopecks}`), `значение ${kopecks} в таблице клиента`);
  }
});

await check('у каждого показателя сводки есть своя нарисованная иконка', async () => {
  setHash('#report');
  dispatchWindow('hashchange');
  await flush(60);
  const meta = appNode().find((node) => node.classList.contains('balance-meta'));
  assert.ok(meta, 'строка показателей есть');

  const metrics = meta.findAll((node) => node.classList.contains('metric'));
  assert.equal(metrics.length, 4, 'дни, точки, пробег, часы');
  for (const metric of metrics) {
    const svg = metric.find((node) => node.classList.contains('metric-icon'));
    assert.ok(svg, `иконка у показателя «${metric.textContent}»`);
    // Пустой SVG значит, что имя иконки не найдено в PATHS.
    assert.ok((svg.children || []).length > 0, `иконка «${metric.textContent}» нарисована`);
  }

  const { readFileSync } = await import('node:fs');
  const icons = readFileSync('src/icons.js', 'utf8');
  const used = new Set(
    Array.from(readFileSync('src/views/report.js', 'utf8').matchAll(/metric\('(\w+)'/g)).map((m) => m[1]),
  );
  for (const name of used) {
    assert.match(icons, new RegExp(`\\b${name}: \\[`), `иконка «${name}» описана в icons.js`);
  }
  assert.match(icons, /calendar: \[/, 'календарь в наборе');
});

await check('админ-панель открывается и показывает настройки', async () => {
  setHash('#admin');
  dispatchWindow('hashchange');
  await flush(60);
  const text = allText();
  assert.match(text, /Админ/, 'заголовок панели');
  assert.match(text, /Тарифы и доплаты/, 'пункт тарифов');
  assert.match(text, /Заказчики/, 'пункт заказчиков');
  assert.match(text, /Пользователи/, 'пункт пользователей');
});

await check('аватары: фото из Telegram и плейсхолдер с инициалами', async () => {
  store.users = [
    { id: 4, tgId: 323173181, name: 'Ignat Rychkov', username: 'ignatrychkov', status: 'approved', isAdmin: true, isOwner: true, createdAt: '2026-10-01T00:00:00.000Z' },
    { id: 5, tgId: 555, name: 'Очень Длинное Имя', username: 'verylong', status: 'approved', isAdmin: false, isOwner: false, createdAt: '2026-10-01T00:00:00.000Z' },
  ];
  setHash('#admin/users');
  dispatchWindow('hashchange');
  await flush(120);
  const avatars = appNode().findAll((node) => node.classList.contains('avatar'));
  assert.equal(avatars.length, 2, 'аватар у каждого пользователя');
  const withPhoto = avatars.find((node) => node.classList.contains('avatar')).children || [];
  const images = appNode().findAll((node) => node.classList.contains('avatar-img'));
  assert.ok(images.length >= 1, 'фото вставлено, когда сервер его отдал');
  const fallback = avatars.find((node) => node.classList.contains('avatar-fallback'));
  assert.ok(fallback, 'без фото — плейсхолдер');
  assert.equal(fallback.textContent, 'ОИ', 'инициалы из имени и фамилии');
  const gradient = String(fallback.style.backgroundImage || fallback.style.background || '');
  assert.ok(gradient.includes('linear-gradient'), 'градиентный фон');

  // возвращаем заявку: следующим проверкам нужен pending
  store.users = [
    { id: 4, tgId: 323173181, name: 'Ignat Rychkov', username: 'ignatrychkov', status: 'approved', isAdmin: true, isOwner: true, createdAt: '2026-10-01T00:00:00.000Z' },
    { id: 5, tgId: 555, name: 'Очень Длинное Имя', username: 'verylong', status: 'pending', isAdmin: false, isOwner: false, createdAt: '2026-10-01T00:00:00.000Z' },
  ];
});

await check('рейтинг: неделя, номинации и призы', async () => {
  setHash('#board');
  dispatchWindow('hashchange');
  await flush(150);
  const text = appNode().textContent;
  assert.match(text, /Рейтинг/, 'заголовок экрана');
  assert.match(text, /Неделя/, 'границы недели');
  assert.match(text, /Доход/, 'номинация доход');
  assert.match(text, /Точки/, 'номинация точки');
  assert.match(text, /Пробег/, 'номинация пробег');
  assert.match(text, /Время/, 'номинация время');
  assert.match(text, /🍌/, 'банан за первое место');
  assert.ok(
    appNode().findAll((node) => node.classList.contains('avatar-img')).length >= 1,
    'фото участника используется в рейтинге',
  );
  assert.match(text, /🤡/, 'клоун за второе');
  assert.match(text, /🐔/, 'петух за третье');
  assert.match(text, /2\s?566/, 'доход победителя');
  assert.match(text, /Итоги прошлой недели/, 'итоги прошлой недели');
  assert.match(text, /Мои призы/, 'личные призы');

  // переключение номинации меняет список
  const chips = appNode().findAll((node) => node.classList.contains('chip'));
  const distance = chips.find((node) => node.textContent === 'Пробег');
  await distance.click();
  await flush(60);
  assert.match(appNode().textContent, /700 км/, 'пробег победителя');
});

await check('счётчик: суммы выводятся по итогу после анимации', async () => {
  setHash('#journal');
  dispatchWindow('hashchange');
  await flush(120);
  const amount = appNode().find((node) => node.classList.contains('summary-amount'));
  assert.ok(amount, 'блок суммы есть');
  const number = amount.find((node) => node.classList.contains('money-number'));
  assert.ok(number, 'число в отдельном узле счётчика');
  assert.match(number.textContent, /2\s?716/, 'итог совпадает с расчётом (доход + дни)');

  setHash('#report');
  dispatchWindow('hashchange');
  await flush(120);
  const balance = appNode().find((node) => node.classList.contains('balance-amount'));
  assert.ok(balance?.find((node) => node.classList.contains('money-number')), 'баланс тоже через счётчик');
});

await check('список записей: заголовок с отступами', async () => {
  setHash('#journal');
  dispatchWindow('hashchange');
  await flush(120);
  const head = appNode().find((node) => node.classList.contains('list-head'));
  assert.ok(head, 'заголовок «Записи» есть');
  assert.match(head.textContent, /Записи/, 'подпись на месте');
  const { readFileSync } = await import('node:fs');
  const css = readFileSync('src/styles.css', 'utf8');
  assert.match(css, /\.list-head \{[^}]*margin: var\(--s6\) var\(--s4\) var\(--s2\)/s, 'отступы как у заголовков групп');
});

await check('дашборд админки: сводка, заявки и управление внизу', async () => {
  closeSheets();
  // список пользователей обновляет ctx.users — дашборд читает заявки оттуда
  setHash('#admin/users');
  dispatchWindow('hashchange');
  await flush(80);
  setHash('#admin');
  dispatchWindow('hashchange');
  await flush(100);
  const text = appNode().textContent;
  assert.match(text, /Пользователи/, 'метрика пользователей');
  assert.match(text, /Журналы/, 'метрика журналов');
  assert.match(text, /Записи за месяц/, 'метрика записей');
  assert.match(text, /Доход за месяц/, 'метрика дохода');
  assert.match(text, /48/, 'число записей из сводки');
  assert.match(text, /Торнике/, 'журнал подписан именем владельца');
  assert.match(text, /@nik_nagibatel/, 'видно username');
  assert.match(text, /Записи/, 'статистика журнала построчно: записи');
  assert.match(text, /Рабочих дней/, 'статистика журнала построчно: дни');
  assert.match(text, /Последняя/, 'статистика журнала построчно: последняя дата');
  assert.match(text, /2\s?000/, 'доход журнала');
  assert.match(text, /Одобрить или отклонить/, 'переход к заявкам');

  const lines = appNode().findAll((node) => node.classList.contains('stat-line'));
  assert.ok(lines.length >= 3, 'строки статистики отдельными элементами');
  const row = appNode().find((node) => node.classList.contains('journal-row'));
  assert.ok(row, 'карточка журнала');
  assert.ok(row.find((node) => node.classList.contains('journal-income')), 'доход отдельной колонкой');

  // статистика — не в колонке рядом с суммой, а на всю ширину карточки
  assert.ok(row.find((node) => node.classList.contains('journal-head')), 'шапка: имя и доход в одной строке');
  const stats = row.find((node) => node.classList.contains('journal-stats'));
  assert.ok(stats, 'блок статистики');
  assert.ok(!stats.find((node) => node.classList.contains('journal-income')), 'сумма не внутри статистики');
  assert.ok(!row.find((node) => node.classList.contains('journal-main'))?.find?.((n) => n.classList?.contains('journal-stats')),
    'статистика вынесена из колонки имени');

  const { readFileSync } = await import('node:fs');
  const css = readFileSync('src/styles.css', 'utf8');
  assert.match(css, /\.journal-row \{[^}]*border-bottom: 1px solid var\(--divider\)/s, 'у строк журналов лёгкий бордер снизу');
  assert.match(css, /\.journal-row:last-child \{[^}]*border-bottom: 0/s, 'у последней строки линии нет');
  assert.match(css, /\.journal-stats \{[^}]*flex-direction: column/s, 'статистика построчно на всю ширину');
  assert.match(text, /Управление/, 'блок управления');
  assert.ok(!/Служебное/.test(text), 'блок «Служебное» убран');
  assert.ok(!/Ваш Telegram ID/.test(text), 'служебный текст убран');

  // управление — ниже дашборда
  const statsTop = appNode().find((node) => node.classList.contains('stats'))?.getBoundingClientRect?.().top;
  const title = appNode().findAll((node) => node.classList.contains('section-title')).map((n) => n.textContent);
  const manageIndex = title.findIndex((t) => /Управление/.test(t));
  const journalsIndex = title.findIndex((t) => /Журналы/.test(t));
  assert.ok(manageIndex > journalsIndex, '«Управление» идёт после блоков дашборда');
});

await check('в подразделе вместо лого — стрелка назад', async () => {
  setHash('#admin/rates');
  dispatchWindow('hashchange');
  await flush(80);
  const back = appNode().find((node) => node.classList.contains('back-btn'));
  assert.ok(back, 'кнопка «назад» в шапке подраздела');
  assert.ok(!appNode().find((node) => node.classList.contains('brand-mark')), 'лого заменено стрелкой');
  await back.click();
  await flush(80);
  assert.equal(fakeLocation.hash, '#admin', 'возврат в панель');
  assert.ok(appNode().find((node) => node.classList.contains('brand-mark')), 'на верхнем уровне лого вернулось');
});

await check('форма рейса: режимы «часами» и «начало/конец»', async () => {
  setHash('#journal');
  dispatchWindow('hashchange');
  await flush(80);
  closeSheets();
  const add = appNode().find((node) => node.classList.contains('btn-add'));
  await add.click();
  await flush(40);
  const sheet = body.find((node) => node.classList.contains('sheet'));
  assert.ok(sheet, 'шторка открыта');

  // плейсхолдеры берутся из тарифов: 12 точек / 300 км / 8 часов
  const numberInputs = sheet.findAll((node) => node.tagName.toLowerCase() === 'input' && (node.type || node.getAttribute('type')) === 'number');
  assert.equal(numberInputs[0].placeholder, '12', 'плейсхолдер точек из тарифов');
  assert.equal(numberInputs[1].placeholder, '300', 'плейсхолдер километров из тарифов');
  assert.equal(numberInputs[2].placeholder, '8', 'плейсхолдер часов из тарифов');

  const seg = sheet.find((node) => node.classList.contains('seg'));
  const modes = seg.findAll((node) => node.tagName.toLowerCase() === 'button').map((n) => n.textContent);
  assert.deepEqual(modes, ['Часами', 'Начало / конец'], 'два режима времени');
  // отступы у переключателя — те же, что у ленты табов
  const { readFileSync } = await import('node:fs');
  const css = readFileSync('src/styles.css', 'utf8');
  assert.match(css, /\.chips,\s*\n\.seg \{[^}]*gap: var\(--s1\)/s, 'у режимов тот же зазор, что у табов');
  assert.match(sheet.textContent, /Время рейса/, 'подпись группы');

  // переключаемся на «начало/конец»
  const timesMode = seg.findAll((node) => node.tagName.toLowerCase() === 'button')[1];
  await timesMode.click();
  await flush(30);

  const typeOf = (node) => node.type || node.getAttribute('type');
  const times = sheet.findAll((node) => node.tagName.toLowerCase() === 'input' && typeOf(node) === 'time');
  assert.equal(times.length, 2, 'два поля времени');
  times[0].value = '08:30';
  times[1].value = '20:10';
  for (const handler of times[0].listeners.input || []) await handler({});
  const hoursField = sheet.findAll((node) => node.tagName.toLowerCase() === 'input' && typeOf(node) === 'number')[2];
  assert.equal(hoursField.value, '11', 'часы посчитались из времени');
  assert.match(sheet.textContent, /В записи будет 11 часов/, 'подсказка про расчёт');
  closeSheets();
});

await check('в группах симметричные отступы — пункты не смещены вверх', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync('src/styles.css', 'utf8');
  // Содержимое карточки-меню не должно «всплывать» вверх: карточка держит
  // одинаковый вертикальный паддинг (--s3 сверху и снизу), а первый и
  // последний пункты не добавляют собственный вертикальный отступ. Равенство
  // задаётся самими правилами, поэтому проверяем их наличие/отсутствие.
  assert.match(css, /\.card \{[^}]*padding: var\(--s3\) var\(--s4\)/s, 'у карточки одинаковый вертикальный паддинг');
  assert.match(
    css,
    /\.card > \.list-row:first-child \{[^}]*padding-top: 0/s,
    'первый пункт группы без верхнего отступа',
  );
  assert.match(
    css,
    /\.list-row:last-child \{[^}]*padding-bottom: 0/s,
    'последний пункт группы без нижнего отступа',
  );
  assert.ok(
    !/\.card:has\(> \.list-row\) \{[^}]*padding-top/s.test(css),
    'верхний паддинг карточки-списка не уменьшается отдельно от нижнего',
  );
});

await check('заголовки групп выровнены по содержимому карточек', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync('src/styles.css', 'utf8');
  // Заголовок группы и подсказка должны стоять на той же левой линии, что и
  // текст пунктов внутри карточки (левый паддинг карточки — --s4). Иначе
  // заголовок «висит» между краем карточки и её содержимым.
  assert.match(
    css,
    /\.section-title \{[^}]*margin: var\(--s6\) var\(--s4\) var\(--s2\)/s,
    'заголовок группы выровнен по содержимому карточки',
  );
  assert.match(
    css,
    /\.view-hint \{[^}]*margin: 0 var\(--s4\)/s,
    'подсказка выровнена по содержимому карточки',
  );
});

await check('в панели нет блока «Действующие доплаты»', async () => {
  setHash('#admin');
  dispatchWindow('hashchange');
  await flush(60);
  const text = allText();
  assert.ok(!/Действующие доплаты/.test(text), 'сводка доплат убрана с главного экрана панели');
  assert.ok(!/часы\s/.test(text), 'нет строки с тарифами часов');
  // Тарифы при этом доступны отдельным разделом
  assert.match(text, /Тарифы и доплаты/, 'раздел тарифов остался');
});

await check('тарифы: подписи со знаком BYN, суммы уходят в рублях (регрессия ×100)', async () => {
  closeSheets();
  setHash('#admin/rates');
  dispatchWindow('hashchange');
  await flush(60);
  const button = byId
    .get('app')
    .find((node) => node.tagName.toLowerCase() === 'button' && /Изменить тарифы/.test(node.textContent));
  assert.ok(button, 'кнопка «Изменить тарифы» найдена');
  await button.click();
  const sheet = body.find((node) => node.classList.contains('sheet'));
  assert.ok(sheet, 'шторка тарифов открыта');
  assert.ok(!sheet.textContent.includes('₽'), 'символ ₽ не используется');
  const signCount = sheet.findAll((node) => node.classList.contains('nbrb-icon')).length;
  assert.ok(signCount >= 3, `в подписях полей есть знаки BYN (найдено ${signCount})`);

  // вводим 112 в «Базовая ставка по умолчанию» и сохраняем
  const tariffLabels = sheet.findAll((node) => node.tagName.toLowerCase() === 'label').map((node) => node.textContent.trim());
  assert.ok(
    tariffLabels.some((text) => text.startsWith('За 4 часа сверх лимита')),
    `есть поле доплаты за 4 часа (${tariffLabels.join(' | ')})`,
  );
  assert.ok(
    !tariffLabels.some((text) => text.startsWith('Рабочих дней в месяце')),
    'правки дней из формы убраны',
  );
  assert.ok(
    !tariffLabels.some((text) => text.startsWith('Доплата за дни,')),
    'доплата за дни больше не поле формы',
  );
  const baseInput = sheet.findAll((node) => node.tagName.toLowerCase() === 'input')[0];
  assert.equal(baseInput.value, '120', 'поле показывает действующую ставку в рублях');
  baseInput.value = '112';
  const save = sheet
    .findAll((node) => node.tagName.toLowerCase() === 'button')
    .find((node) => /Сохранить/.test(node.textContent));
  await save.click();
  await flush(40);
  assert.ok(lastRatePayload, 'запрос на сохранение ушёл');
  assert.equal(String(lastRatePayload.baseRate), '112', 'на сервер уходят рубли, а не копейки');
  assert.equal(store.settings.baseRate, 11200, 'и сохраняются как 112 ₽ (11 200 коп.)');
});

await check('заказчики: только название и базовая ставка', async () => {
  closeSheets();
  setHash('#admin/customers');
  dispatchWindow('hashchange');
  await flush(60);
  const text = allText();
  assert.match(text, /СТМ-Логистика/);
  assert.match(text, /2\s?500/, 'базовая ставка в строке заказчика');
  assert.ok(!/точек в лимите|доплата за точку/i.test(text), 'доплат у заказчика нет');

  const create = byId
    .get('app')
    .find((node) => node.tagName.toLowerCase() === 'button' && /\+ Заказчик/.test(node.textContent));
  await create.click();
  const sheet = body.find((node) => node.classList.contains('sheet'));
  const labels = sheet.findAll((node) => node.tagName.toLowerCase() === 'label').map((node) => node.textContent.trim());
  assert.equal(labels[0], 'Название', 'первое поле — название');
  assert.ok(labels[1].startsWith('Базовая ставка'), `второе поле — базовая ставка (${labels[1]})`);
  assert.ok(!labels.some((text) => /точк|километр|часов/i.test(text)), 'полей доплат у заказчика нет');
  assert.equal(sheet.findAll((node) => node.tagName.toLowerCase() === 'input').length, 3, 'название, ставка и переключатель');
  assert.ok(
    sheet.findAll((node) => node.classList.contains('nbrb-icon')).length >= 1,
    'у подписи ставки есть знак BYN',
  );
});

await check('экран пересчёта: предпросмотр и применение', async () => {
  setHash('#admin/recalc');
  dispatchWindow('hashchange');
  await flush(60);
  closeSheets();

  const text = () => appNode().textContent;
  assert.match(text(), /Пересчёт/, 'заголовок раздела');
  assert.match(text(), /Записи хранят тарифы на момент рейса/, 'пояснение про снимок тарифов');

  const run = appNode()
    .findAll((node) => node.tagName.toLowerCase() === 'button')
    .find((node) => /Проверить/.test(node.textContent));
  assert.ok(run, 'кнопка «Проверить» есть');
  await run.click();
  await flush(60);

  assert.equal(lastRecalc.apply, false, 'предпросмотр не применяет');
  assert.match(text(), /Проверено записей/, 'показана сводка');
  assert.match(text(), /Изменится/, 'показано число изменений');
  assert.match(text(), /30\s?₽|30\s/, 'видна дельта по записи');
  assert.match(text(), /заказчик удалён/, 'помечена запись с удалённым заказчиком');
  assert.match(text(), /Пересчитать и сохранить/, 'есть кнопка применения');

  const apply = appNode()
    .findAll((node) => node.tagName.toLowerCase() === 'button')
    .find((node) => /Пересчитать и сохранить/.test(node.textContent));
  await apply.click();
  await flush(80);
  assert.equal(lastRecalc.apply, true, 'применение ушло на сервер');
  // тост живёт вне #app, поэтому проверяем его отдельный узел
  assert.match(byId.get('toast').textContent, /Пересчитано/, 'тост о результате');
});

await check('пересчёт доступен только владельцу', async () => {
  currentUser = { ...currentUser, isOwner: false, permissions: { journal: true, customers: true, tariffs: false, users: false } };
  localStorageData.set('journal:theme', 'light');
  resetDocument();
  setHash('');
  await import(`data:text/javascript;base64,${Buffer.from(`${code}\n// recalc guard`).toString('base64')}`);
  await flush(60);
  setHash('#admin');
  dispatchWindow('hashchange');
  await flush(60);
  const text = appNode().textContent;
  assert.ok(!/Пересчёт записей/.test(text), 'не-владелец не видит пункт пересчёта');
  currentUser = { id: 4, tgId: 323173181, name: 'Ignat', username: 'owner', isAdmin: true, isOwner: true, permissions: { journal: true, customers: true, tariffs: true, users: true } };
  localStorageData.set('journal:theme', 'light');
  resetDocument();
  setHash('');
  await import(`data:text/javascript;base64,${Buffer.from(`${code}\n// back to owner`).toString('base64')}`);
  await flush(60);
});

await check('админ без прав владельца не видит тарифы и пользователей', async () => {
  currentUser = {
    id: 5,
    tgId: 555,
    name: 'Админ',
    username: null,
    isAdmin: true,
    isOwner: false,
    permissions: { journal: true, customers: true, tariffs: false, users: false },
  };
  callLog.length = 0;
  resetDocument();
  setHash('');
  await import(`data:text/javascript;base64,${Buffer.from(`${code}\n// admin pass`).toString('base64')}`);
  await flush(60);
  const root = appNode();
  const tabs = root
    .findAll((node) => node.tagName.toLowerCase() === 'button' && node.classList.contains('nav-item'))
    .map((node) => node.textContent);
  assert.deepEqual(tabs, ['Журнал', 'История', 'Рейтинг', 'Админ']);
  setHash('#admin');
  dispatchWindow('hashchange');
  await flush(60);
  const text = appNode().textContent;
  assert.match(text, /Заказчики/, 'справочник доступен');
  assert.ok(!/Тарифы и доплаты/.test(text), 'тарифов нет');
  assert.ok(!/Пользователи/.test(text), 'управления пользователями нет');
  assert.ok(!callLog.some((entry) => entry.name === 'adminUsers'), 'и запроса к adminUsers нет');
});

await check('не-админ не видит вкладку «Админ»', async () => {
  currentUser = { id: 5, tgId: 555, name: 'Другой', username: null, isAdmin: false };
  store.users = [{ ...currentUser, status: 'approved' }];
  callLog.length = 0;
  resetDocument();
  setHash('');
  await import(`data:text/javascript;base64,${Buffer.from(`${code}\n// second run`).toString('base64')}`);
  await flush(60);
  const tabs = byId
    .get('app')
    .findAll((node) => node.tagName.toLowerCase() === 'button' && node.classList.contains('nav-item'))
    .map((node) => node.textContent);
  assert.deepEqual(tabs, ['Журнал', 'История', 'Рейтинг']);
});

console.log(`\nИтог: ${failures ? 'есть ошибки' : 'все проверки пройдены'}\n`);
process.exit(failures ? 1 : 0);
