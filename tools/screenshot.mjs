// tools/screenshot.mjs — скриншот экрана Mini App в headless Chrome.
//
// Поднимает dist/ с заглушкой Telegram WebApp и снимает выбранный маршрут.
// Нужен для глазной проверки вёрстки: тесты видят разметку, но не картинку.
//
//   node tools/screenshot.mjs --screen board --out /tmp/board.png
//   node tools/screenshot.mjs --screen admin/users --height 900 --hide-nav
//   CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node tools/screenshot.mjs
//
// Переменные: CHROME (путь), PORT/DEBUG_PORT, SCREEN, OUT, HEIGHT, HIDE_NAV.

import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(PROJECT, 'dist');
const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] ?? true : fallback;
};
const has = (name) => args.includes(`--${name}`);

const PORT = Number(flag('port', 4193));
const DEBUG_PORT = Number(flag('debug-port', 9473));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SCREEN = flag('screen', 'journal');
const OUT = flag('out', '/tmp/dscreen.png');
const HEIGHT = Number(flag('height', 1000));
const HIDE_NAV = has('hide-nav');
const PROFILE = flag('profile', '/tmp/dsh-shot-profile');

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

const TABLE = { 23: 2500, 24: 5000, 25: 10000, 26: 15000, 27: 20000, 28: 25000, 29: 30000, 30: 40000, 31: 50000 };
const RATES = {
  baseRate: 12000,
  pointsFree: 12,
  pointRate: 200,
  kmFree: 300,
  kmRate: 20,
  hoursFree: 8,
  hourRate: 2000,
  daysMin: 23,
  daysBonusTable: TABLE,
};
const USERS = [
  { id: 4, tgId: 323173181, name: 'Ignat Rychkov', username: 'ignatrychkov', status: 'approved', isAdmin: true, isOwner: true, prizes: ['🍌'], createdAt: '2026-10-01T00:00:00.000Z' },
  { id: 9, tgId: 465395732, name: 'Торнике', username: 'nik_nagibatel', status: 'approved', isAdmin: true, isOwner: false, prizes: ['🍌', '🐔'], createdAt: '2026-10-12T00:00:00.000Z' },
  { id: 5, tgId: 555, name: 'Очень Длинное Имя', username: 'verylong', status: 'pending', isAdmin: false, isOwner: false, prizes: [], createdAt: '2026-10-18T00:00:00.000Z' },
];
const TRIP = {
  id: 1,
  date: '2026-10-05',
  customerId: 3,
  customerName: 'Дзержинский (ММК)',
  points: 15,
  distance: 500,
  hours: 14,
  income: 256600,
  daysBonus: 15000,
};
const HANDLERS = {
  me: {
    user: { id: 4, tgId: 323173181, name: 'Ignat Rychkov', username: 'ignatrychkov', isAdmin: true, isOwner: true, permissions: { journal: true, customers: true, tariffs: true, users: true }, theme: 'light', photo: null, prizes: ['🍌'] },
    settings: RATES,
    customers: [{ id: 3, name: 'Дзержинский (ММК)', baseRate: 11200, active: true }],
    today: '2026-10-19',
  },
  listTrips: { range: {}, trips: [TRIP] },
  report: {
    from: '2026-10-01',
    to: '2026-10-31',
    totals: { trips: 12, income: 161100, total: 176100, daysBonus: 15000, workingDays: 26, daysMin: 23, points: 120, distance: 4200, hours: 160, extraPoints: 0, extraKm: 200, extraHours: 32, avgIncome: 13425 },
    byCustomer: [],
    byDate: [],
    today: '2026-10-19',
  },
  adminUsers: { users: USERS },
  adminRates: { settings: RATES },
  adminCustomers: { customers: [], settings: RATES },
  adminAvatars: { avatars: [], remaining: 0 },
  adminStats: {
    period: { from: '2026-10-01', to: '2026-10-19' },
    users: { total: 7, approved: 5, pending: 1, denied: 1, admins: 2 },
    trips: { count: 48, journals: 3, workingDays: 26, income: 480000, daysBonus: 15000, total: 495000, avgIncome: 10000 },
    journals: [
      { userId: 9, name: 'Торнике', username: 'nik_nagibatel', trips: 20, income: 200000, days: 26, lastDate: '2026-10-14' },
      { userId: 4, name: 'Ignat Rychkov', username: 'ignatrychkov', trips: 18, income: 180000, days: 20, lastDate: '2026-10-13' },
    ],
  },
  adminRecalc: { from: '2026-10-01', to: '2026-10-19', applied: false, total: 1, changed: 1, incomeBefore: 100000, incomeAfter: 120000, delta: 20000, users: [], items: [] },
  leaderboard: {
    today: '2026-10-19',
    week: { weekStart: '2026-10-19', from: '2026-10-19', to: '2026-10-25', endsAt: '2026-10-25' },
    categories: [
      { id: 'income', label: 'Доход', unit: 'money', rows: [
        { userId: 4, place: 1, prize: '🍌', value: 256600, trips: 3, name: 'Ignat Rychkov', username: 'ignatrychkov' },
        { userId: 9, place: 2, prize: '🤡', value: 100000, trips: 2, name: 'Торнике', username: 'nik_nagibatel' },
        { userId: 5, place: 3, prize: '🐔', value: 50000, trips: 1, name: 'Очень Длинное Имя', username: null },
      ] },
      { id: 'points', label: 'Точки', unit: 'count', rows: [{ userId: 9, place: 1, prize: '🍌', value: 120, trips: 5, name: 'Торнике', username: 'nik_nagibatel' }] },
      { id: 'distance', label: 'Пробег', unit: 'km', rows: [{ userId: 5, place: 1, prize: '🍌', value: 700, trips: 2, name: 'Очень Длинное Имя', username: null }] },
      { id: 'hours', label: 'Время', unit: 'hours', rows: [{ userId: 4, place: 1, prize: '🍌', value: 32, trips: 3, name: 'Ignat Rychkov', username: 'ignatrychkov' }] },
    ],
    lastWeek: { weekStart: '2026-10-12', from: '2026-10-12', to: '2026-10-18', created: 0, categories: [
      { id: 'income', label: 'Доход', unit: 'money', rows: [{ userId: 9, place: 1, prize: '🍌', value: 500000, name: 'Торнике', username: 'nik_nagibatel' }] },
    ] },
    myPrizes: ['🍌'],
    myAwards: [{ weekStart: '2026-10-12', category: 'income', place: 1, value: 500000, prize: '🍌' }],
  },
};

const STUB = `
window.Telegram = { WebApp: {
  initData: 'query_id=test&user=1', initDataUnsafe: { user: { id: 323173181 } }, themeParams: {},
  ready(){}, expand(){}, close(){}, disableVerticalSwipes(){}, setHeaderColor(){}, setBackgroundColor(){}, onEvent(){},
  showConfirm(_m, cb){ cb(true); }, showAlert(){}, showPopup(){},
  HapticFeedback: { impactOccurred(){}, notificationOccurred(){} },
  Serverless: { callAsync(name){ return Promise.resolve(H[name] || {}); } }
} };
var H = ${JSON.stringify(HANDLERS)};
`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let file = path.join(DIST, decodeURIComponent(url.pathname));
  if (!existsSync(file) || url.pathname === '/') file = path.join(DIST, 'index.html');
  try {
    let body = await readFile(file);
    if (file.endsWith('.html')) {
      body = Buffer.from(String(body).replace(/<head([^>]*)>/, `<head$1><script>${STUB}</script>`), 'utf8');
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));

const chrome = spawn(CHROME, [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--disable-breakpad',
  '--disable-crash-reporter',
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${PROFILE}`,
  'about:blank',
], { stdio: 'ignore' });
await new Promise((resolve) => setTimeout(resolve, 2500));

const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
const ws = new WebSocket(targets.find((target) => target.type === 'page').webSocketDebuggerUrl);
await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));

let id = 0;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.method === 'Fetch.requestPaused') {
    const { requestId, request } = message.params;
    const isTelegram = request.url.includes('telegram-web-app');
    send(isTelegram ? 'Fetch.fulfillRequest' : 'Fetch.continueRequest', isTelegram
      ? { requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'text/javascript' }], body: Buffer.from('window.Telegram=window.Telegram||{};').toString('base64') }
      : { requestId });
    return;
  }
  const resolver = pending.get(message.id);
  if (resolver) {
    pending.delete(message.id);
    resolver(message.result);
  }
});
function send(method, params = {}) {
  const messageId = ++id;
  return new Promise((resolve) => {
    pending.set(messageId, resolve);
    ws.send(JSON.stringify({ id: messageId, method, params }));
  });
}

await send('Page.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
await new Promise((resolve) => setTimeout(resolve, 1200));
if (SCREEN) {
  await send('Runtime.evaluate', { expression: `(location.hash = '#${SCREEN}', null)` });
  await new Promise((resolve) => setTimeout(resolve, 900));
}
if (HIDE_NAV) {
  await send('Runtime.evaluate', { expression: `(document.querySelector('.bottom-nav')?.remove(), null)` });
}
const shot = await send('Page.captureScreenshot', {
  format: 'png',
  captureBeyondViewport: true,
  clip: { x: 0, y: 0, width: 390, height: HEIGHT, scale: 2 },
});
await writeFile(OUT, Buffer.from(shot.data, 'base64'));
console.log('saved', OUT);
chrome.kill();
server.close();
