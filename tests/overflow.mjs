// tests/overflow.mjs — ищет горизонтальный скролл настоящим браузером.
//
// Поднимает статику dist/, подмешивает в index.html заглушку Telegram.WebApp
// с «тяжёлыми» данными, гоняет headless Chrome через DevTools Protocol и меряет
// scrollWidth документа на всех экранах и размерах.
//
//   npm run build && node tests/overflow.mjs

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const DIST = path.join(path.resolve(import.meta.dirname, '..'), 'dist');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 4173;
const DEBUG_PORT = 9333;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

/* Заглушка Telegram. Внедряется первой в <head>, поэтому к моменту выполнения
   бандла window.Telegram уже существует. Названия и суммы нарочно «тяжёлые». */
const STUB = `
window.__stubRan = true;
(function () {
  var rates = { baseRate: 1200000, pointsFree: 12, pointRate: 200, kmFree: 300, kmRate: 20, hoursFree: 12, hourRate: 2000 };
  var longName = 'Белвнешрыбторг-транспортно-логистическая-компания';
  var customers = [
    { id: 1, name: longName, active: true, baseRate: 1200000, ownBaseRate: 1200000, globalBaseRate: 12000 },
    { id: 2, name: 'ММК', active: true, baseRate: 11200, ownBaseRate: 11200, globalBaseRate: 12000 }
  ];
  var trip = {
    id: 1, date: '2026-10-05', customerId: 1, customerName: longName,
    points: 1588, distance: 12500, hours: 114, income: 1234567, rates: rates
  };
  var user = {
    id: 4, tgId: 323173181, name: 'Ignat Rychkov', username: 'ignatrychkov',
    isAdmin: true, isOwner: true, theme: 'system',
    permissions: { journal: true, customers: true, tariffs: true, users: true }
  };
  var handlers = {
    me: { user: user, settings: rates, customers: customers, today: '2026-10-11' },
    listTrips: { range: {}, trips: [trip, Object.assign({}, trip, { id: 2, date: '2026-10-04' })] },
    report: {
      from: '2026-10-01', to: '2026-10-31',
      totals: { trips: 199, income: 19876543, points: 1580, distance: 125000, hours: 1140, extraPoints: 1400, extraKm: 121000, extraHours: 1100, avgIncome: 99999 },
      byCustomer: [{ customerId: 1, customerName: longName, trips: 99, points: 1580, distance: 125000, hours: 1140, income: 19876543 }],
      byDate: [{ date: '2026-10-05', trips: 9, income: 9876543, points: 158, distance: 12500, hours: 114 }],
      today: '2026-10-11'
    },
    adminCustomers: { customers: customers, settings: rates },
    adminRates: { settings: rates },
    leaderboard: { today: '2026-10-19', week: { weekStart: '2026-10-19', from: '2026-10-19', to: '2026-10-25' }, categories: [
    { id: 'income', label: 'Доход', unit: 'money', rows: [{ userId: 4, place: 1, prize: '🍌', value: 256600, name: longName, username: 'verylongusername' }, { userId: 5, place: 2, prize: '🤡', value: 100000, name: 'Второй', username: null }] },
    { id: 'points', label: 'Точки', unit: 'count', rows: [] },
    { id: 'distance', label: 'Пробег', unit: 'km', rows: [] },
    { id: 'hours', label: 'Время', unit: 'hours', rows: [] },
  ], lastWeek: { weekStart: '2026-10-12', from: '2026-10-12', to: '2026-10-18', categories: [{ id: 'income', label: 'Доход', unit: 'money', rows: [{ userId: 9, place: 1, prize: '🍌', value: 500000, name: longName, username: null }] }] }, myPrizes: ['🍌'], myAwards: [] },
  adminUsers: { users: [user, { id: 5, tgId: 555, name: 'Очень Длинное Имя Пользователя Для Проверки', username: 'verylongusername', status: 'pending', isAdmin: false, isOwner: false, createdAt: '2026-10-01T00:00:00.000Z' }] },
    adminRecalc: {
      from: '2026-10-01', to: '2026-10-31', applied: false, total: 128, changed: 96,
      incomeBefore: 19876543, incomeAfter: 21543210, delta: 1666667,
      users: [{ userId: 4, total: 60, changed: 44, delta: 900000 }, { userId: 5, total: 68, changed: 52, delta: 766667 }],
      items: [
        { id: 1, date: '2026-10-05', userId: 4, customerName: longName, customerMissing: false, incomeBefore: 254600, incomeAfter: 260000, delta: 5400 },
        { id: 2, date: '2026-10-04', userId: 5, customerName: 'Удалённый заказчик с очень длинным названием', customerMissing: true, incomeBefore: 12000, incomeAfter: 4000, delta: -8000 }
      ]
    }
  };

  // Настоящий telegram-web-app.js выполняется ПОСЛЕ нас и создаёт свой WebApp
  // без initData (мы не в Telegram). Поэтому window.Telegram — аксессор: любое
  // присваивание проходит через заглушку.
  window.Telegram = {
    WebApp: {
      initData: 'query_id=test&user=%7B%22id%22%3A323173181%7D',
      initDataUnsafe: { user: { id: 323173181, first_name: 'Ignat' } },
      themeParams: {},
      ready: function () {}, expand: function () {}, close: function () {},
      disableVerticalSwipes: function () {}, setHeaderColor: function () {},
      setBackgroundColor: function () {}, onEvent: function () {},
      showConfirm: function (_m, cb) { cb(true); },
      showAlert: function () {}, showPopup: function () {},
      HapticFeedback: { impactOccurred: function () {}, notificationOccurred: function () {} },
      Serverless: { callAsync: function (name) { return Promise.resolve(handlers[name] || {}); } }
    }
  };

})();
`;

/** Отдаёт dist/. В index.html подмешивает заглушку перед всеми скриптами. */
function startServer() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let file = path.join(DIST, decodeURIComponent(url.pathname));
    if (!existsSync(file) || url.pathname === '/') file = path.join(DIST, 'index.html');
    // SDK Telegram тянется с telegram.org; подменяем его заглушкой, чтобы
    // приложение увидело «мы внутри Telegram» с валидным initData.
    // SDK Telegram тянется с telegram.org; отдаём вместо него заглушку
    // (Chrome перехватывает этот запрос через CDP Fetch — см. ниже).
    if (url.pathname.endsWith('telegram-web-app.js')) {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      res.end(STUB);
      return;
    }
    try {
      let body = await readFile(file);
      if (path.extname(file) === '.html') {
        const html = String(body).replace(/<head([^>]*)>/, `<head$1><script>${STUB}</script>`);
        body = Buffer.from(html, 'utf8');
      }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

async function waitForDevtools(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      if (res.ok) return res.json();
    } catch {
      /* ещё не поднялся */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Chrome DevTools не ответил');
}

/** Минимальный клиент CDP поверх WebSocket из Node. */
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.notes = [];
    this.onPaused = null;
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.exceptionThrown') {
        this.notes.push(`[page] ${message.params.exceptionDetails.text}`);
      }
      if (message.method === 'Fetch.requestPaused' && this.onPaused) {
        this.onPaused(message.params);
        return;
      }
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
    });
  }

  send(method, params = {}) {
    this.id += 1;
    const id = this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function connect() {
  const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
  const page = targets.find((target) => target.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  return new Cdp(ws);
}

const MEASURE = `(() => {
  const de = document.documentElement;
  const vw = de.clientWidth;
  const offenders = [];

  const inScroller = (node) => {
    for (let el = node.parentElement; el; el = el.parentElement) {
      const overflow = getComputedStyle(el).overflowX;
      if (overflow === 'auto' || overflow === 'scroll' || overflow === 'hidden') return true;
    }
    return false;
  };

  for (const el of document.querySelectorAll('body *')) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    if (getComputedStyle(el).position === 'fixed') continue;
    if (rect.right <= vw + 0.5 && rect.left >= -0.5) continue;
    if (inScroller(el)) continue;
    offenders.push({
      tag: el.tagName.toLowerCase(),
      cls: typeof el.className === 'string' ? el.className : '',
      left: Math.round(rect.left * 10) / 10,
      right: Math.round(rect.right * 10) / 10,
      width: Math.round(rect.width * 10) / 10,
    });
  }

  return { viewport: vw, scrollWidth: de.scrollWidth, overflowPx: de.scrollWidth - vw, offenders: offenders.slice(0, 8) };
})()`;

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

const SCREENS = [
  ['журнал', '#journal'],
  ['история', '#report'],
  ['рейтинг', '#board'],
  ['админка', '#admin'],
  ['тарифы', '#admin/rates'],
  ['заказчики', '#admin/customers'],
  ['пользователи', '#admin/users'],
  ['пересчёт', '#admin/recalc'],
];

const SIZES = [
  ['Узкий 320', 320, 568],
  ['Узкий 360', 360, 740],
  ['iPhone SE', 375, 667],
  ['iPhone 14', 390, 844],
  ['Pro Max', 430, 932],
  ['Планшет', 768, 1024],
  ['Десктоп', 1280, 800],
];

function report(label, data, state) {
  const bad = data.overflowPx > 0;
  console.log(
    `${bad ? '✗' : '✓'} ${label.padEnd(26)} вьюпорт ${String(data.viewport).padStart(4)} · документ ${String(data.scrollWidth).padStart(4)} · переполнение ${data.overflowPx}px`,
  );
  for (const item of data.offenders) {
    console.log(`     ${item.tag}.${item.cls || '(без класса)'} — left ${item.left}, right ${item.right}, ширина ${item.width}`);
  }
  return bad ? state.failures + 1 : state.failures;
}

async function main() {
  const server = await startServer();
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${DEBUG_PORT}`,
      '--user-data-dir=/tmp/dsh-overflow-profile',
      '--no-first-run',
      '--no-default-browser-check',
      // В песочнице DSH Chrome не может поднять свою песочницу и crashpad —
      // для локального замера это не нужно.
      '--no-sandbox',
      '--disable-crash-reporter',
      '--disable-breakpad',
      '--disable-gpu',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  const state = { failures: 0 };
  let cdp;
  try {
    await waitForDevtools();
    cdp = await connect();
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');

    // Настоящий SDK с telegram.org перезаписывает window.Telegram и обнуляет
    // initData вне Telegram — подменяем ответ сети на заглушку.
    cdp.onPaused = ({ requestId, request }) => {
      if (request.url.includes('telegram-web-app.js')) {
        cdp.send('Fetch.fulfillRequest', {
          requestId,
          responseCode: 200,
          responseHeaders: [{ name: 'content-type', value: 'text/javascript; charset=utf-8' }],
          body: Buffer.from(STUB, 'utf8').toString('base64'),
        });
      } else {
        cdp.send('Fetch.continueRequest', { requestId });
      }
    };
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });

    for (const [name, width, height] of SIZES) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 2,
        mobile: width < 768,
      });
      await cdp.send('Network.setUserAgentOverride', {
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 TelegramBot/10.0',
      });
      await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
      await new Promise((resolve) => setTimeout(resolve, 900));

      const booted = await evaluate(cdp, `Boolean(document.querySelector('.brand-row'))`);
      if (!booted) {
        const info = await evaluate(
          cdp,
          `({ stub: Boolean(window.__stubRan), init: String(window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp.initData : '').length, text: (document.getElementById('app') || {}).textContent })`,
        );
        console.log(`! ${name}: приложение не отрисовалось`, JSON.stringify(info).slice(0, 200));
        state.failures += 1;
        continue;
      }

      for (const [screen, hash] of SCREENS) {
        await evaluate(cdp, `(location.hash = '${hash}', null)`);
        await new Promise((resolve) => setTimeout(resolve, 350));
        if (process.env.DBG_GAP && screen === process.env.DBG_GAP) {
          const gap = await evaluate(
            cdp,
            `(() => {
              // берём карточку, которая реально содержит список .list-row
              const card = Array.from(document.querySelectorAll('.card')).find((el) => el.querySelectorAll(':scope > .list-row').length > 0);
              if (!card) return null;
              const rows = Array.from(card.children).map((el, i) => {
                const r = el.getBoundingClientRect();
                const cs = getComputedStyle(el);
                return { i, cls: (el.className || el.tagName).toString().slice(0, 22), top: Math.round(r.top * 10) / 10, h: Math.round(r.height), borderTop: cs.borderTopWidth, padTop: cs.paddingTop, marginTop: cs.marginTop, first: el.matches(':first-child') };
              });
              const cs = getComputedStyle(card);
              return { cardTop: Math.round(card.getBoundingClientRect().top), cardPad: cs.padding, cardGap: cs.gap, cardDisplay: cs.display, rows };
            })()`,
          );
          console.log(`   [${screen}]`, JSON.stringify(gap, null, 1).slice(0, 1400));
        }
        state.failures = report(`${name} · ${screen}`, await evaluate(cdp, MEASURE), state);
      }

      await evaluate(cdp, `(location.hash = '#journal', null)`);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await evaluate(cdp, `(document.querySelector('.btn-add').click(), null)`);
      await new Promise((resolve) => setTimeout(resolve, 350));
      state.failures = report(`${name} · форма рейса`, await evaluate(cdp, MEASURE), state);

      // Результаты пересчёта: сводка, дельты и список изменённых записей.
      await evaluate(cdp, `(document.querySelector('.sheet-backdrop')?.remove(), null)`);
      await evaluate(cdp, `(location.hash = '#admin/recalc', null)`);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await evaluate(
        cdp,
        `(Array.from(document.querySelectorAll('button')).find((b) => /Проверить/.test(b.textContent))?.click(), null)`,
      );
      await new Promise((resolve) => setTimeout(resolve, 400));
      state.failures = report(`${name} · пересчёт (результат)`, await evaluate(cdp, MEASURE), state);
    }

    for (const note of cdp.notes.slice(0, 5)) console.log(note);
    console.log(
      state.failures ? `\nПереполнение в ${state.failures} случаях` : '\nГоризонтального скролла нет ни на одном экране',
    );
    process.exitCode = state.failures ? 1 : 0;
  } finally {
    try {
      await cdp?.send('Browser.close');
    } catch {
      /* закрываем как получится */
    }
    chrome.kill();
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
