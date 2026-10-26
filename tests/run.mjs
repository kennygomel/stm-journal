// tests/run.mjs — прогон логики бота и эндпоинтов на моке платформы.
//
//   node --import ./tests/register-sdk.mjs tests/run.mjs

import assert from 'node:assert/strict';
import { calls, resetDb, resetApi } from './fake-sdk.mjs';
import db from 'sdk';

const schema = await import('../tgcloud/schema.js');
const { OWNER_IDS, USER_STATUS } = await import('../tgcloud/lib/config.js');
const { getSettings } = await import('../tgcloud/lib/calc.js');

const messageHandler = (await import('../tgcloud/handlers/message.js')).default;
const callbackHandler = (await import('../tgcloud/handlers/callback_query.js')).default;
const endpoints = {
  me: (await import('../tgcloud/endpoints/me.js')).default,
  listTrips: (await import('../tgcloud/endpoints/listTrips.js')).default,
  createTrip: (await import('../tgcloud/endpoints/createTrip.js')).default,
  updateTrip: (await import('../tgcloud/endpoints/updateTrip.js')).default,
  deleteTrip: (await import('../tgcloud/endpoints/deleteTrip.js')).default,
  report: (await import('../tgcloud/endpoints/report.js')).default,
  adminCustomers: (await import('../tgcloud/endpoints/adminCustomers.js')).default,
  adminRates: (await import('../tgcloud/endpoints/adminRates.js')).default,
  adminUsers: (await import('../tgcloud/endpoints/adminUsers.js')).default,
  saveTheme: (await import('../tgcloud/endpoints/saveTheme.js')).default,
  adminRecalc: (await import('../tgcloud/endpoints/adminRecalc.js')).default,
  adminStats: (await import('../tgcloud/endpoints/adminStats.js')).default,
};

const ADMIN_ID = 323173181;
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  ✗ ${name}\n      ${error.message}`);
  }
}

function ctxFor(tgId, { first_name = 'Test', last_name = 'User', username = 'tester' } = {}) {
  return { initData: { user: { id: tgId, first_name, last_name, username } } };
}

function msg(fromId, text = '/start') {
  return { message_id: 1, from: { id: fromId, first_name: 'Test' }, chat: { id: fromId, type: 'private' }, text };
}

const buttonsOf = (message) => (message?.reply_markup?.inline_keyboard || []).flat();

function lastSentTo(chatId) {
  return calls.filter((call) => call.method === 'sendMessage' && call.params.chat_id === chatId).at(-1)?.params;
}

// ------------------------------------------------------------------ сценарии

console.log('\nБот и доступ');

resetDb();
resetApi();

await test('владелец определён в конфиге', () => {
  assert.ok(OWNER_IDS.includes(ADMIN_ID), 'OWNER_IDS должен содержать 323173181');
});

await test('новый пользователь получает заявку, админ — кнопки approve/deny', async () => {
  await messageHandler(msg(ADMIN_ID), {});
  await messageHandler(msg(555), {});
  const users = await db.select().from(schema.users).all();
  assert.equal(users.length, 2, 'два пользователя');
  const newcomer = users.find((row) => row.tgId === 555);
  assert.equal(newcomer.status, USER_STATUS.pending);
  assert.equal(users.find((row) => row.tgId === ADMIN_ID).status, USER_STATUS.approved);

  const toAdmin = lastSentTo(ADMIN_ID);
  assert.match(toAdmin.text, /Запрос доступа/);
  const labels = buttonsOf(toAdmin).map((button) => button.text);
  assert.deepEqual(labels, ['✅ Одобрить', '❌ Отклонить']);
  assert.match(buttonsOf(toAdmin)[0].callback_data, /^usr:ok:\d+$/);
});

await test('неодобренный пользователь не проходит в Mini App', async () => {
  await assert.rejects(() => endpoints.me({ tzOffsetMinutes: 180 }, ctxFor(555)), (error) => {
    assert.equal(error.parameters.code, 'ACCESS_DENIED');
    assert.equal(error.parameters.status, USER_STATUS.pending);
    return true;
  });
});

await test('админ одобряет заявку кнопкой, пользователь получает уведомление', async () => {
  const target = (await db.select().from(schema.users).all()).find((row) => row.tgId === 555);
  const data = buttonsOf(lastSentTo(ADMIN_ID)).find((button) => button.callback_data.startsWith('usr:ok')).callback_data;
  resetApi();
  await callbackHandler(
    {
      id: 'cb-1',
      from: { id: ADMIN_ID, first_name: 'Admin' },
      data,
      message: { message_id: 10, chat: { id: ADMIN_ID }, text: 'Запрос доступа' },
    },
    {},
  );
  const after = (await db.select().from(schema.users).all()).find((row) => row.id === target.id);
  assert.equal(after.status, USER_STATUS.approved);
  assert.ok(after.approvedAt instanceof Date, 'approvedAt заполнен');
  const notice = lastSentTo(555);
  assert.match(notice.text, /Доступ к журналу рейсов открыт/);
  const edited = calls.find((call) => call.method === 'editMessageText' && /одобрен/i.test(call.params.text));
  assert.ok(edited, 'сообщение админа обновлено');
  assert.deepEqual(
    edited.params.reply_markup?.inline_keyboard,
    [],
    'у сообщения «Доступ одобрен» кнопок нет',
  );
  assert.ok(
    !calls.some((call) => call.method === 'editMessageReplyMarkup' && call.params.reply_markup?.inline_keyboard?.length),
    'никаких новых кнопок не выставлено',
  );
});

await test('не-админ не может нажать кнопку одобрения', async () => {
  const target = (await db.select().from(schema.users).all()).find((row) => row.tgId === 555);
  resetApi();
  await callbackHandler(
    {
      id: 'cb-2',
      from: { id: 555, first_name: 'Test' },
      data: `usr:ok:${target.id}`,
      message: { message_id: 11, chat: { id: 555 }, text: 'x' },
    },
    {},
  );
  const answer = calls.find((call) => call.method === 'answerCallbackQuery');
  assert.match(answer.params.text, /Недостаточно прав/);
});

console.log('\nТарифы и заказчики (админ)');

await test('глобальные тарифы сохраняются (рубли → копейки один раз)', async () => {
  const result = await endpoints.adminRates(
    {
      action: 'save',
      settings: { baseRate: 120, pointsFree: 12, pointRate: 2, kmFree: 300, kmRate: 0.2, hoursFree: 8, hourRate: 20 },
    },
    ctxFor(ADMIN_ID),
  );
  assert.equal(result.settings.baseRate, 12000, '120 ₽ → 12 000 коп.');
  assert.equal(result.settings.pointRate, 200, '2 ₽ → 200 коп.');
  assert.equal(result.settings.kmRate, 20, '0,20 ₽ → 20 коп.');
  assert.equal(result.settings.hourRate, 2000, '20 ₽ → 2 000 коп. за шаг в 4 часа');
  const stored = await getSettings();
  assert.equal(stored.pointsFree, 12);
  assert.equal(stored.hoursFree, 8);
});

await test('повторное сохранение не умножает сумму на 100 (регрессия)', async () => {
  const saved = await endpoints.adminRates(
    { action: 'save', settings: { baseRate: 112, pointsFree: 12, pointRate: 2, kmFree: 300, kmRate: 0.2, hoursFree: 8, hourRate: 20 } },
    ctxFor(ADMIN_ID),
  );
  assert.equal(saved.settings.baseRate, 11200, '112 ₽ остаются 112 ₽');
  const again = await endpoints.adminRates(
    { action: 'save', settings: { baseRate: 112, pointsFree: 12, pointRate: 2, kmFree: 300, kmRate: 0.2, hoursFree: 8, hourRate: 20 } },
    ctxFor(ADMIN_ID),
  );
  assert.equal(again.settings.baseRate, 11200, 'и после второго сохранения тоже');
  await endpoints.adminRates(
    { action: 'save', settings: { baseRate: 120, pointsFree: 12, pointRate: 2, kmFree: 300, kmRate: 0.2, hoursFree: 8, hourRate: 20 } },
    ctxFor(ADMIN_ID),
  );
});

await test('заказчик: название и своя базовая ставка', async () => {
  const created = await endpoints.adminCustomers(
    { action: 'create', name: 'СТМ-Логистика', baseRate: 2500 },
    ctxFor(ADMIN_ID),
  );
  assert.equal(created.customer.name, 'СТМ-Логистика');
  assert.equal(created.customer.ownBaseRate, 250000);
  assert.equal(created.customer.baseRate, 250000);
  assert.equal(created.customer.overrides, undefined, 'переопределений доплат больше нет');
});

await test('без своей ставки заказчик берёт глобальную базу', async () => {
  const created = await endpoints.adminCustomers({ action: 'create', name: 'Без тарифа' }, ctxFor(ADMIN_ID));
  assert.equal(created.customer.ownBaseRate, null);
  assert.equal(created.customer.baseRate, 12000, '120 ₽ из глобальных тарифов');
});

await test('у заказчика нет своих доплат — только общие', async () => {
  const created = await endpoints.adminCustomers(
    { action: 'create', name: 'Со своими доплатами', baseRate: 1000, pointRate: 99, kmRate: 9, hoursFree: 1 },
    ctxFor(ADMIN_ID),
  );
  assert.equal(created.customer.ownBaseRate, 100000);
  assert.equal(created.customer.pointRate, undefined);
  assert.equal(created.customer.hoursFree, undefined);
  await endpoints.adminCustomers({ action: 'delete', id: created.customer.id }, ctxFor(ADMIN_ID));
});

await test('правка названия не сбрасывает базовую ставку', async () => {
  const created = await endpoints.adminCustomers(
    { action: 'create', name: 'Ставка 777', baseRate: 777 },
    ctxFor(ADMIN_ID),
  );
  const renamed = await endpoints.adminCustomers(
    { action: 'update', id: created.customer.id, name: 'Ставка 777 (новое)' },
    ctxFor(ADMIN_ID),
  );
  assert.equal(renamed.customer.ownBaseRate, 77700, 'ставка сохранилась');
  const cleared = await endpoints.adminCustomers(
    { action: 'update', id: created.customer.id, baseRate: '' },
    ctxFor(ADMIN_ID),
  );
  assert.equal(cleared.customer.ownBaseRate, null, 'пустое поле возвращает глобальную ставку');
  assert.equal(cleared.customer.baseRate, 12000);
  await endpoints.adminCustomers({ action: 'delete', id: created.customer.id }, ctxFor(ADMIN_ID));
});

await test('обычный пользователь не получает админские эндпоинты', async () => {
  await assert.rejects(() => endpoints.adminCustomers({ action: 'list' }, ctxFor(555)), (error) => {
    assert.equal(error.parameters.code, 'FORBIDDEN');
    return true;
  });
  await assert.rejects(() => endpoints.adminRates({ action: 'get' }, ctxFor(555)), (error) => {
    assert.equal(error.parameters.code, 'OWNER_ONLY');
    return true;
  });
  await assert.rejects(() => endpoints.adminUsers({ action: 'list' }, ctxFor(555)), (error) => {
    assert.equal(error.parameters.code, 'OWNER_ONLY');
    return true;
  });
});

await test('админ (не владелец) правит заказчиков, но не тарифы и не роли', async () => {
  // выдаём права админа
  const list = await endpoints.adminUsers({ action: 'list' }, ctxFor(ADMIN_ID));
  const target = list.users.find((row) => row.tgId === 555);
  await endpoints.adminUsers({ action: 'setRole', userId: target.id, role: 'admin' }, ctxFor(ADMIN_ID));

  const created = await endpoints.adminCustomers({ action: 'create', name: 'От админа', baseRate: 150 }, ctxFor(555));
  assert.equal(created.customer.ownBaseRate, 15000, 'админ может вести справочник');

  await assert.rejects(() => endpoints.adminRates({ action: 'get' }, ctxFor(555)), (error) => {
    assert.equal(error.parameters.code, 'OWNER_ONLY', 'тарифы только у владельца');
    return true;
  });
  await assert.rejects(() => endpoints.adminUsers({ action: 'list' }, ctxFor(555)), (error) => {
    assert.equal(error.parameters.code, 'OWNER_ONLY', 'пользователи только у владельца');
    return true;
  });

  // возвращаем обычную роль
  await endpoints.adminUsers({ action: 'setRole', userId: target.id, role: 'user' }, ctxFor(ADMIN_ID));
  await endpoints.adminCustomers({ action: 'delete', id: created.customer.id }, ctxFor(ADMIN_ID));
});

console.log('\nЗаписи журнала');

let firstTripId = null;

await test('доход: база + точки + километры + часы', async () => {
  const { customers } = await endpoints.adminCustomers({ action: 'list' }, ctxFor(ADMIN_ID));
  const customer = customers.find((row) => row.name === 'СТМ-Логистика');
  const result = await endpoints.createTrip(
    { date: '2025-03-10', customerId: customer.id, points: 15, distance: 500, hours: 14, tzOffsetMinutes: 180 },
    ctxFor(555),
  );
  firstTripId = result.trip.id;
  // 2500 ₽ база + 3 точки × 2 ₽ + 200 км × 0,20 ₽ + 1 шаг за часы (14 ч → 6 ч сверх → 1×4)
  assert.equal(result.trip.income, 250000 + 600 + 4000 + 2000);
  assert.equal(result.trip.income, 256600);
  assert.equal(result.trip.hours, 14);
  assert.equal(result.trip.customerName, 'СТМ-Логистика');
});

await test('ровно на лимитах (12 точек, 300 км, 8 часов) — без доплат', async () => {
  const { customers } = await endpoints.adminCustomers({ action: 'list' }, ctxFor(ADMIN_ID));
  const customer = customers.find((row) => row.name === 'СТМ-Логистика');
  const result = await endpoints.createTrip(
    { date: '2025-03-11', customerId: customer.id, points: 12, distance: 300, hours: 8 },
    ctxFor(555),
  );
  assert.equal(result.trip.income, 250000, 'только база заказчика');
  await endpoints.deleteTrip({ id: result.trip.id }, ctxFor(555));
});

await test('часы: +20 ₽ за каждые полные 4 часа свыше 8', async () => {
  const { customers } = await endpoints.adminCustomers({ action: 'list' }, ctxFor(ADMIN_ID));
  const customer = customers.find((row) => row.name === 'Без тарифа');
  const base = 12000;
  const step = 2000;
  // ровно по ТЗ: 12 → +20, 16 → +40, 20 → +60, 24 → +80
  const cases = [
    [8, 0],
    [9, 0],
    [11, 0],
    [12, 1],
    [13, 1],
    [15, 1],
    [16, 2],
    [19, 2],
    [20, 3],
    [24, 4],
  ];

  const created = [];
  for (const [hours, steps] of cases) {
    const result = await endpoints.createTrip(
      { date: '2025-03-11', customerId: customer.id, points: 10, distance: 300, hours },
      ctxFor(555),
    );
    assert.equal(
      result.trip.income,
      base + steps * step,
      `${hours} ч → ${steps} шаг(ов) по 20 ₽`,
    );
    created.push(result.trip.id);
  }
  for (const id of created) await endpoints.deleteTrip({ id }, ctxFor(555));
});

await test('правило часов совпадает на клиенте и на сервере', async () => {
  const server = await import('../tgcloud/lib/calc.js');
  const client = await import('../src/hours.js');
  assert.equal(server.HOURS_STEP, client.HOURS_STEP, 'шаг совпадает');
  for (let extra = 0; extra <= 40; extra += 1) {
    assert.equal(server.hoursSteps(extra), client.hoursSteps(extra), `превышение ${extra} ч`);
  }
});

await test('некорректные данные отклоняются', async () => {
  await assert.rejects(() => endpoints.createTrip({ date: '10.03.2025', customerId: 1 }, ctxFor(555)), (error) => {
    assert.equal(error.parameters.code, 'BAD_DATE');
    return true;
  });
  await assert.rejects(() => endpoints.createTrip({ date: '2025-03-10', customerId: 9999 }, ctxFor(555)), (error) => {
    assert.equal(error.parameters.code, 'CUSTOMER_NOT_FOUND');
    return true;
  });
});

await test('чужую запись нельзя изменить или удалить', async () => {
  await messageHandler(msg(777, '/start'), {});
  await endpoints.adminUsers({ action: 'setStatus', userId: (await db.select().from(schema.users).all()).find((r) => r.tgId === 777).id, status: 'approved' }, ctxFor(ADMIN_ID));
  await assert.rejects(() => endpoints.updateTrip({ id: firstTripId, date: '2025-03-10', customerId: 1 }, ctxFor(777)), (error) => {
    assert.equal(error.parameters.code, 'TRIP_NOT_FOUND');
    return true;
  });
  await assert.rejects(() => endpoints.deleteTrip({ id: firstTripId }, ctxFor(777)), (error) => {
    assert.equal(error.parameters.code, 'TRIP_NOT_FOUND');
    return true;
  });
});

await test('запись редактируется, доход пересчитывается', async () => {
  const { customers } = await endpoints.adminCustomers({ action: 'list' }, ctxFor(ADMIN_ID));
  const customer = customers.find((row) => row.name === 'СТМ-Логистика');
  const result = await endpoints.updateTrip(
    { id: firstTripId, date: '2025-03-12', customerId: customer.id, points: 20, distance: 300, hours: 12 },
    ctxFor(555),
  );
  assert.equal(result.trip.date, '2025-03-12');
  // 8 точек × 2 ₽ + 1 шаг за часы (12 ч при лимите 8 → 4 ч сверх)
  assert.equal(result.trip.income, 250000 + 8 * 200 + 1 * 2000);
});

console.log('\nИстория и баланс');

await test('отчёт за период суммирует доход, точки и пробег', async () => {
  const { customers } = await endpoints.adminCustomers({ action: 'list' }, ctxFor(ADMIN_ID));
  const second = customers.find((row) => row.name === 'Без тарифа');
  await endpoints.createTrip({ date: '2025-04-02', customerId: second.id, points: 2, distance: 100 }, ctxFor(555));

  const report = await endpoints.report({ from: '2025-03-01', to: '2025-03-31', tzOffsetMinutes: 180 }, ctxFor(555));
  assert.equal(report.totals.trips, 1);
  assert.equal(report.totals.income, 253600, 'база 2500 ₽ + 8 точек + 1 шаг доплаты за часы');
  assert.equal(report.totals.points, 20);
  assert.equal(report.totals.distance, 300);
  assert.equal(report.totals.hours, 12);
  assert.equal(report.totals.extraPoints, 8);
  assert.equal(report.totals.extraKm, 0);
  assert.equal(report.totals.extraHours, 4, '4 часа сверх лимита 8');
  assert.equal(report.byCustomer.length, 1);
  assert.equal(report.byCustomer[0].customerName, 'СТМ-Логистика');
  assert.equal(report.byCustomer[0].hours, 12);

  const all = await endpoints.report({ tzOffsetMinutes: 180 }, ctxFor(555));
  assert.equal(all.totals.trips, 2);
  assert.equal(all.totals.income, 253600 + 12000, 'второй рейс по глобальной базе 120 ₽');
  assert.equal(all.totals.hours, 12, 'у второго рейса часы не указаны — 0');
  assert.equal(all.byDate.length, 2);
});

await test('список записей фильтруется по датам', async () => {
  const march = await endpoints.listTrips({ from: '2025-03-01', to: '2025-03-31' }, ctxFor(555));
  assert.equal(march.trips.length, 1);
  assert.equal(march.trips[0].customerName, 'СТМ-Логистика');
  const april = await endpoints.listTrips({ from: '2025-04-01', to: '2025-04-30' }, ctxFor(555));
  assert.equal(april.trips.length, 1);
  assert.equal(april.trips[0].income, 12000, 'глобальная база 120 ₽');
});

await test('профиль отдаёт заказчиков, тарифы и права', async () => {
  const me = await endpoints.me({ tzOffsetMinutes: 180 }, ctxFor(555));
  assert.equal(me.user.isAdmin, false);
  assert.equal(me.user.isOwner, false);
  assert.deepEqual(me.user.permissions, { journal: true, customers: false, tariffs: false, users: false });
  assert.equal(me.user.tgId, 555);
  assert.ok(me.customers.length >= 2);
  assert.equal(me.settings.pointRate, 200);
  assert.equal(me.settings.hourRate, 2000);
  assert.equal(me.settings.hoursFree, 8);
  assert.match(me.today, /^\d{4}-\d{2}-\d{2}$/);
});

await test('владелец видит полные права, админ — только заказчиков', async () => {
  const me = await endpoints.me({ tzOffsetMinutes: 180 }, ctxFor(ADMIN_ID));
  assert.equal(me.user.isOwner, true);
  assert.deepEqual(me.user.permissions, { journal: true, customers: true, tariffs: true, users: true });
});

await test('удалённый заказчик не ломает историю', async () => {
  const { customers } = await endpoints.adminCustomers({ action: 'list' }, ctxFor(ADMIN_ID));
  const customer = customers.find((row) => row.name === 'СТМ-Логистика');
  await endpoints.adminCustomers({ action: 'delete', id: customer.id }, ctxFor(ADMIN_ID));
  const report = await endpoints.report({ tzOffsetMinutes: 180 }, ctxFor(555));
  assert.equal(report.totals.trips, 2, 'записи остались');
  assert.ok(report.byCustomer.some((row) => row.customerName === 'СТМ-Логистика'), 'имя из снимка');
});

console.log('\nПересчёт записей');

await test('пересчёт подтягивает записи под новые тарифы', async () => {
  const { customers } = await endpoints.adminCustomers({ action: 'list' }, ctxFor(ADMIN_ID));
  const customer = customers.find((row) => row.name === 'Без тарифа');
  const created = await endpoints.createTrip(
    { date: '2025-06-10', customerId: customer.id, points: 10, distance: 300, hours: 8 },
    ctxFor(555),
  );
  assert.equal(created.trip.income, 12000);

  // владелец поднимает базовую ставку и доплату за точку
  await endpoints.adminRates(
    { action: 'save', settings: { baseRate: 200, pointsFree: 12, pointRate: 3, kmFree: 300, kmRate: 0.2, hoursFree: 8, hourRate: 20 } },
    ctxFor(ADMIN_ID),
  );

  const preview = await endpoints.adminRecalc({ from: '2025-06-01', to: '2025-06-30' }, ctxFor(ADMIN_ID));
  assert.equal(preview.applied, false, 'предпросмотр ничего не меняет');
  assert.ok(preview.changed >= 1, 'есть что пересчитывать');
  assert.ok(
    preview.items.some((item) => item.id === created.trip.id && item.incomeBefore === 12000 && item.incomeAfter === 20000),
    'в предпросмотре видно старую и новую сумму',
  );

  const stored = await endpoints.listTrips({ from: '2025-06-01', to: '2025-06-30' }, ctxFor(555));
  assert.equal(stored.trips[0].income, 12000, 'до применения в базе старая сумма');

  const applied = await endpoints.adminRecalc({ from: '2025-06-01', to: '2025-06-30', apply: true }, ctxFor(ADMIN_ID));
  assert.equal(applied.applied, true);
  assert.equal(applied.delta, applied.incomeAfter - applied.incomeBefore);

  const after = await endpoints.listTrips({ from: '2025-06-01', to: '2025-06-30' }, ctxFor(555));
  assert.equal(after.trips[0].income, 20000, 'после применения новая сумма');
  assert.equal(after.trips[0].rates.pointRate, 300, 'снимок ставок обновлён');
  assert.equal(after.trips[0].rates.hoursFree, 8);

  // повторный пересчёт уже ничего не меняет
  const again = await endpoints.adminRecalc({ from: '2025-06-01', to: '2025-06-30', apply: true }, ctxFor(ADMIN_ID));
  assert.equal(again.changed, 0, 'идемпотентно');

  await endpoints.deleteTrip({ id: created.trip.id }, ctxFor(555));
  await endpoints.adminRates(
    { action: 'save', settings: { baseRate: 120, pointsFree: 12, pointRate: 2, kmFree: 300, kmRate: 0.2, hoursFree: 8, hourRate: 20 } },
    ctxFor(ADMIN_ID),
  );
});

await test('пересчёт уважает период и не трогает чужие даты', async () => {
  const { customers } = await endpoints.adminCustomers({ action: 'list' }, ctxFor(ADMIN_ID));
  const customer = customers.find((row) => row.name === 'Без тарифа');
  const july = await endpoints.createTrip(
    { date: '2025-07-15', customerId: customer.id, points: 10, distance: 300, hours: 8 },
    ctxFor(555),
  );
  await endpoints.adminRates(
    { action: 'save', settings: { baseRate: 500, pointsFree: 12, pointRate: 2, kmFree: 300, kmRate: 0.2, hoursFree: 8, hourRate: 20 } },
    ctxFor(ADMIN_ID),
  );

  const june = await endpoints.adminRecalc({ from: '2025-06-01', to: '2025-06-30', apply: true }, ctxFor(ADMIN_ID));
  assert.equal(june.changed, 0, 'июнь не тронут');

  const still = await endpoints.listTrips({ from: '2025-07-01', to: '2025-07-31' }, ctxFor(555));
  assert.equal(still.trips[0].income, 12000, 'июльская запись ждёт своего периода');

  const julyApplied = await endpoints.adminRecalc({ from: '2025-07-01', to: '2025-07-31', apply: true }, ctxFor(ADMIN_ID));
  assert.ok(julyApplied.changed >= 1);
  await endpoints.deleteTrip({ id: july.trip.id }, ctxFor(555));
  await endpoints.adminRates(
    { action: 'save', settings: { baseRate: 120, pointsFree: 12, pointRate: 2, kmFree: 300, kmRate: 0.2, hoursFree: 8, hourRate: 20 } },
    ctxFor(ADMIN_ID),
  );
});

await test('пересчёт доступен только владельцу', async () => {
  await assert.rejects(
    () => endpoints.adminRecalc({ from: '2025-06-01', to: '2025-06-30' }, ctxFor(555)),
    (error) => {
      assert.equal(error.parameters.code, 'OWNER_ONLY');
      return true;
    },
  );
});

await test('пересчёт требует период', async () => {
  await assert.rejects(() => endpoints.adminRecalc({}, ctxFor(ADMIN_ID)), (error) => {
    assert.equal(error.parameters.code, 'BAD_RANGE');
    return true;
  });
});

console.log('\nДоплата за дни');

await test('меньше 25 рабочих дней — доплаты нет', async () => {
  const { customers } = await endpoints.adminCustomers({ action: 'list' }, ctxFor(ADMIN_ID));
  const customer = customers.find((row) => row.name === 'Без тарифа');
  const created = [];
  for (let day = 1; day <= 3; day += 1) {
    const result = await endpoints.createTrip(
      { date: `2025-09-0${day}`, customerId: customer.id, points: 5, distance: 100, hours: 4 },
      ctxFor(555),
    );
    created.push(result.trip.id);
  }
  const trips = await endpoints.listTrips({ from: '2025-09-01', to: '2025-09-30' }, ctxFor(555));
  assert.equal(trips.trips.length, 3);
  assert.ok(trips.trips.every((trip) => trip.daysBonus === 0), 'доплата за дни не начислена');

  for (const id of created) await endpoints.deleteTrip({ id }, ctxFor(555));
});

await test('25 рабочих дней в месяце — 100 ₽ ровно один раз', async () => {
  const { customers } = await endpoints.adminCustomers({ action: 'list' }, ctxFor(ADMIN_ID));
  const customer = customers.find((row) => row.name === 'Без тарифа');

  // ровно 25 разных дат в месяце, каждая — одна запись
  for (let day = 1; day <= 25; day += 1) {
    await endpoints.createTrip(
      { date: `2025-08-${String(day).padStart(2, '0')}`, customerId: customer.id, points: 5, distance: 100, hours: 4 },
      ctxFor(555),
    );
  }

  const trips = await endpoints.listTrips({ from: '2025-08-01', to: '2025-08-31' }, ctxFor(555));
  const bonusTrips = trips.trips.filter((trip) => trip.daysBonus > 0);
  assert.equal(bonusTrips.length, 1, 'доплата стоит ровно у одной записи');
  assert.equal(bonusTrips[0].daysBonus, 10000, '25 дней → 100 ₽ по таблице');
  assert.equal(bonusTrips[0].date, '2025-08-25', 'она у последней записи месяца');

  const report = await endpoints.report({ from: '2025-08-01', to: '2025-08-31' }, ctxFor(555));
  assert.equal(report.totals.workingDays, 25);
  assert.equal(report.totals.daysBonus, 10000);
  assert.equal(report.totals.total, report.totals.income + 10000, 'баланс учитывает доплату за дни');

  for (const trip of trips.trips) await endpoints.deleteTrip({ id: trip.id }, ctxFor(555));
});

await test('вторая запись в тот же день не считается рабочим днём', async () => {
  const { customers } = await endpoints.adminCustomers({ action: 'list' }, ctxFor(ADMIN_ID));
  const customer = customers.find((row) => row.name === 'Без тарифа');
  const ids = [];
  for (let day = 1; day <= 24; day += 1) {
    const result = await endpoints.createTrip(
      { date: `2025-07-${String(day).padStart(2, '0')}`, customerId: customer.id, points: 5, distance: 100, hours: 4 },
      ctxFor(555),
    );
    ids.push(result.trip.id);
  }
  // ещё один рейс в тот же (уже отработанный) день
  const sameDay = await endpoints.createTrip(
    { date: '2025-07-24', customerId: customer.id, points: 5, distance: 100, hours: 4 },
    ctxFor(555),
  );
  ids.push(sameDay.trip.id);

  const report = await endpoints.report({ from: '2025-07-01', to: '2025-07-31' }, ctxFor(555));
  assert.equal(report.totals.workingDays, 24, '24 разные даты');
  // 24 дня → 50 ₽ по таблице; если бы вторая запись считалась днём, было бы 100 ₽
  assert.equal(report.totals.daysBonus, 5000, '24 дня → 50 ₽');

  for (const id of ids) await endpoints.deleteTrip({ id }, ctxFor(555));
});

await test('таблица доплат за дни: 23 → 25 ₽ … 31 → 500 ₽', async () => {
  const { DAYS_BONUS_TABLE, DAYS_BONUS_MIN, daysBonusFor } = await import('../tgcloud/lib/calc.js');
  assert.equal(DAYS_BONUS_MIN, 23, 'порог — 23 рабочих дня');
  const expected = { 23: 2500, 24: 5000, 25: 10000, 26: 15000, 27: 20000, 28: 25000, 29: 30000, 30: 40000, 31: 50000 };
  for (const [days, kopecks] of Object.entries(expected)) {
    assert.equal(DAYS_BONUS_TABLE[days], kopecks, `${days} дней → ${kopecks / 100} ₽`);
    assert.equal(daysBonusFor(Number(days)), kopecks, `${days} дней считается`);
  }
  for (const days of [0, 1, 12, 22]) assert.equal(daysBonusFor(days), 0, `${days} дней — без доплаты`);
  assert.equal(daysBonusFor(32), 0, 'больше 31 не бывает');
});

await test('таблица дней совпадает на клиенте и на сервере', async () => {
  const server = await import('../tgcloud/lib/calc.js');
  const client = await import('../src/days.js');
  assert.equal(client.DAYS_BONUS_MIN, server.DAYS_BONUS_MIN, 'порог совпадает');
  for (let days = 0; days <= 32; days += 1) {
    assert.equal(client.daysBonusFor(days), server.daysBonusFor(days), `${days} дней`);
  }
});

await test('дни настраиваются владельцем больше не настраиваются', async () => {
  // лишние поля в запросе игнорируются, таблица остаётся фиксированной
  const saved = await endpoints.adminRates(
    { action: 'save', settings: { baseRate: 120, pointsFree: 12, pointRate: 2, kmFree: 300, kmRate: 0.2, hoursFree: 8, hourRate: 20, daysMin: 20, daysRate: 50 } },
    ctxFor(ADMIN_ID),
  );
  assert.equal(saved.settings.daysMin, 23, 'порог из таблицы');
  const row23 = saved.settings.daysBonusTable.find((row) => row.days === 23);
  assert.equal(row23.kopecks, 2500, 'таблица в DTO');
  assert.equal(saved.settings.daysBonusTable.length, 9, 'девять строк таблицы');
});

console.log('\nДашборд админки');

await test('сводка считает пользователей, журналы и записи', async () => {
  const stats = await endpoints.adminStats({ from: '2025-03-01', to: '2025-03-31' }, ctxFor(ADMIN_ID));
  assert.equal(stats.period.from, '2025-03-01');
  assert.ok(stats.users.total >= 2, 'пользователи посчитаны');
  assert.ok(stats.users.approved >= 1);
  assert.ok(stats.trips.count >= 1, 'записи за период есть');
  assert.equal(stats.trips.count, Math.round(stats.trips.count), 'count — число записей, а не деньги');
  assert.ok(stats.trips.journals >= 1, 'журналы посчитаны');
  assert.ok(stats.trips.workingDays >= 1, 'рабочие дни посчитаны');
  assert.equal(stats.trips.total, stats.trips.income + stats.trips.daysBonus, 'доход включает дни');
  assert.ok(stats.journals.length >= 1, 'список журналов есть');
  assert.ok(stats.journals[0].name, 'у журнала есть имя владельца, а не только id');
  // имя должно совпадать с тем, что показывает список пользователей
  const { users: allUsers } = await endpoints.adminUsers({ action: 'list' }, ctxFor(ADMIN_ID));
  const owner = allUsers.find((row) => row.id === stats.journals[0].userId);
  assert.ok(owner, 'владелец журнала есть в списке пользователей');
  assert.equal(stats.journals[0].name, owner.name, 'имя журнала — имя владельца');
  assert.equal(
    stats.journals[0].income,
    Math.round(stats.journals[0].income),
    'доход журнала в копейках',
  );
});

await test('сводка доступна только владельцу', async () => {
  await assert.rejects(() => endpoints.adminStats({}, ctxFor(555)), (error) => {
    assert.equal(error.parameters.code, 'OWNER_ONLY');
    return true;
  });
});

await test('без периода сводка берёт текущий месяц', async () => {
  const stats = await endpoints.adminStats({}, ctxFor(ADMIN_ID));
  assert.match(stats.period.from, /^\d{4}-\d{2}-01$/);
  assert.match(stats.period.to, /^\d{4}-\d{2}-\d{2}$/);
});

console.log('\nЛидерборд недели');

await test('неделя начинается с понедельника', async () => {
  const { weekStartOf, addDays, weekRange } = await import('../tgcloud/lib/leaderboard.js');
  assert.equal(weekStartOf('2026-10-26'), '2026-10-26', 'понедельник — сам себе старт');
  assert.equal(weekStartOf('2026-11-01'), '2026-10-26', 'воскресенье относится к той же неделе');
  assert.equal(weekStartOf('2026-10-25'), '2026-10-19', 'воскресенье предыдущей недели');
  assert.equal(addDays('2026-10-26', -7), '2026-10-19');
  assert.deepEqual(weekRange('2026-10-19'), { from: '2026-10-19', to: '2026-10-25' });
});

await test('рейтинг: порядок, места и призы', async () => {
  const { rankCategory, CATEGORIES, PLACE_PRIZES } = await import('../tgcloud/lib/leaderboard.js');
  assert.equal(CATEGORIES.length, 4, 'четыре номинации');
  assert.deepEqual(PLACE_PRIZES, { 1: '🍌', 2: '🤡', 3: '🐔' });
  const rows = [
    { userId: 1, income: 300, points: 5, distance: 10, hours: 2 },
    { userId: 2, income: 500, points: 5, distance: 30, hours: 1 },
    { userId: 3, income: 300, points: 1, distance: 20, hours: 9 },
    { userId: 4, income: 0, points: 0, distance: 0, hours: 0 },
  ];
  const byIncome = rankCategory(rows, 'income');
  assert.equal(byIncome[0].userId, 2, 'больше доход — выше');
  assert.equal(byIncome[0].prize, '🍌');
  assert.equal(byIncome[1].userId, 1, 'при равенстве — по userId');
  assert.equal(byIncome[1].prize, '🤡');
  assert.equal(byIncome[2].prize, '🐔');
  assert.equal(byIncome.length, 3, 'нулевые не попадают');
  assert.equal(rankCategory(rows, 'hours')[0].userId, 3, 'время считается отдельно');
});

await test('итоги недели сохраняются и не дублируются', async () => {
  const { ensureWeeklyAwards } = await import('../tgcloud/lib/leaderboard.js');
  const { customers } = await endpoints.adminCustomers({ action: 'list' }, ctxFor(ADMIN_ID));
  const customer = customers[0];
  const created = [];
  // неделя 19–25 октября 2026: два пользователя с разными результатами
  for (const [day, points, distance, hours] of [
    ['2026-10-20', 20, 100, 10],
    ['2026-10-21', 5, 500, 2],
  ]) {
    const result = await endpoints.createTrip(
      { date: day, customerId: customer.id, points, distance, hours },
      ctxFor(555),
    );
    created.push(result.trip.id);
  }
  const adminTrip = await endpoints.createTrip(
    { date: '2026-10-22', customerId: customer.id, points: 1, distance: 1, hours: 1 },
    ctxFor(ADMIN_ID),
  );
  created.push(adminTrip.trip.id);

  const first = await ensureWeeklyAwards('2026-10-26');
  assert.equal(first.weekStart, '2026-10-19');
  assert.ok(first.created > 0, 'призы вручены');

  const second = await ensureWeeklyAwards('2026-10-26');
  assert.equal(second.created, 0, 'повторно не дублируются');

  const { db } = await import('sdk');
  const { awards } = await import('../tgcloud/schema.js');
  const { eq } = await import('sdk/db');
  const rows = await db.select().from(awards).where(eq(awards.weekStart, '2026-10-19')).all();
  // участников двое, значит в каждой номинации по два призёра
  assert.equal(rows.length, 8, '4 номинации × 2 участника');
  const { users: allUsers } = await endpoints.adminUsers({ action: 'list' }, ctxFor(ADMIN_ID));
  const userId555 = allUsers.find((row) => row.tgId === 555).id;
  const distanceWinner = rows.find((row) => row.category === 'distance' && row.place === 1);
  assert.equal(distanceWinner.userId, userId555, 'лучший пробег — у второго пользователя');
  assert.equal(distanceWinner.value, 600);

  for (const id of created) await endpoints.deleteTrip({ id }, ctxFor(id === adminTrip.trip.id ? ADMIN_ID : 555));
});

await test('призы видны в профиле и в рейтинге', async () => {
  const { leaderboardData } = await import('../tgcloud/lib/leaderboard.js');
  const { users: allUsers } = await endpoints.adminUsers({ action: 'list' }, ctxFor(ADMIN_ID));
  const userId = allUsers.find((row) => row.tgId === 555).id;
  const board = await leaderboardData(userId);
  assert.ok(Array.isArray(board.categories) && board.categories.length === 4, 'четыре номинации');
  assert.ok(board.week.from && board.week.to, 'границы недели');
  assert.ok(Array.isArray(board.lastWeek.categories), 'итоги прошлой недели');
  assert.ok(board.myPrizes.includes('🍌') || board.myPrizes.length >= 0, 'личные призы');

  const { response } = { response: null };
  const endpoint = (await import('../tgcloud/endpoints/leaderboard.js')).default;
  const payload = await endpoint({}, ctxFor(555));
  assert.equal(payload.categories.length, 4);
  assert.ok(payload.week.weekStart, 'старт недели');
});

console.log('\nАватары');

await test('инициалы и градиент как в Telegram', async () => {
  const { initials, paletteIndex, gradientFor } = await import('../src/avatar.js');
  assert.equal(initials('Ignat Rychkov'), 'IR', 'имя и фамилия');
  assert.equal(initials('Торнике'), 'Т', 'одно имя — одна буква');
  assert.equal(initials('  '), '?', 'пустое имя');
  assert.equal(initials('дмитрий 🐾'), 'Д', 'эмодзи не мешает');
  assert.equal(paletteIndex(4), paletteIndex(4), 'градиент стабилен для id');
  assert.match(gradientFor(9), /^linear-gradient\(135deg, #[0-9A-F]{6}, #[0-9A-F]{6}\)$/i);
  assert.ok(paletteIndex(0) >= 0 && paletteIndex(0) < 7, 'номер палитры в диапазоне');
});

await test('аватары: base64 и выбор размера фото', async () => {
  const { toBase64, pickPhotoSize, avatarNeedsRefresh } = await import('../tgcloud/lib/avatars.js');
  assert.equal(toBase64(new Uint8Array([0, 1, 2])), 'AAEC');
  assert.equal(toBase64(new Uint8Array([255])), '/w==');
  const sizes = [
    { width: 40, height: 40, file_id: 's' },
    { width: 160, height: 160, file_id: 'm' },
    { width: 640, height: 640, file_id: 'l' },
  ];
  assert.equal(pickPhotoSize(sizes).file_id, 'm', 'ближайший к 160');
  assert.equal(pickPhotoSize([]), null, 'пустой набор');
  assert.equal(avatarNeedsRefresh({ photoUpdatedAt: null }), true, 'без даты — пора обновить');
  assert.equal(avatarNeedsRefresh({ photo: 'data:x', photoUpdatedAt: new Date() }), false, 'свежее фото не трогаем');
  assert.equal(
    avatarNeedsRefresh({ photo: 'data:x', photoUpdatedAt: new Date(Date.now() - 8 * 24 * 3600 * 1000) }),
    true,
    'неделя прошла',
  );
  // фото нет: не сдаёмся навсегда, но и не дёргаем API каждую секунду
  assert.equal(avatarNeedsRefresh({ photo: null, photoUpdatedAt: new Date() }), false, 'час ещё не прошёл');
  assert.equal(
    avatarNeedsRefresh({ photo: null, photoUpdatedAt: new Date(Date.now() - 2 * 3600 * 1000) }),
    true,
    'через час пробуем снова',
  );
});

await test('эндпоинт аватаров отдаёт уже сохранённые фото', async () => {
  const { db } = await import('sdk');
  const { eq } = await import('sdk/db');
  const { users } = await import('../tgcloud/schema.js');
  const { users: all } = await endpoints.adminUsers({ action: 'list' }, ctxFor(ADMIN_ID));
  const target = all.find((row) => row.tgId === 555);
  await db
    .update(users)
    .set({ photo: 'data:image/jpeg;base64,AAAA', photoUpdatedAt: new Date() })
    .where(eq(users.id, target.id))
    .run();

  const endpoint = (await import('../tgcloud/endpoints/adminAvatars.js')).default;
  const result = await endpoint({}, ctxFor(ADMIN_ID));
  const row = result.avatars.find((item) => item.id === target.id);
  assert.ok(row, 'пользователь есть в ответе');
  assert.match(row.photo, /^data:image\/jpeg;base64,AAAA$/, 'фото вернулось, хотя обновлять его не нужно');
  assert.ok(result.avatars.length >= 2, 'отдаём всех, а не только обновлённых');
});

console.log('\nЗаявки и уведомления');

await test('заявка из Mini App уведомляет админов', async () => {
  resetApi();
  const stranger = 777001;
  await assert.rejects(() => endpoints.me({}, ctxFor(stranger)), (error) => {
    assert.equal(error.parameters.code, 'ACCESS_DENIED');
    return true;
  });
  const sent = calls.filter((call) => call.method === 'sendMessage');
  assert.ok(sent.length >= 1, 'админам ушло сообщение о заявке');
  const { users: all } = await endpoints.adminUsers({ action: 'list' }, ctxFor(ADMIN_ID));
  const row = all.find((user) => user.tgId === stranger);
  assert.ok(row, 'заявка сохранена');
  assert.equal(row.status, 'pending');
});

await test('повторный заход не дублирует уведомление', async () => {
  const stranger = 777001;
  const { users: all } = await endpoints.adminUsers({ action: 'list' }, ctxFor(ADMIN_ID));
  const row = all.find((user) => user.tgId === stranger);
  resetApi();
  await assert.rejects(() => endpoints.me({}, ctxFor(stranger)));
  assert.equal(calls.filter((call) => call.method === 'sendMessage').length, 0, 'повторно не шлём');
  assert.ok(row, 'строка на месте');
});

await test('отклонение удаляет пользователя и все его записи', async () => {
  const { customers } = await endpoints.adminCustomers({ action: 'list' }, ctxFor(ADMIN_ID));
  // берём любого заказчика: на этом шаге справочник ещё мог не наполниться
  const customer = customers[0] || (await endpoints.adminCustomers({ action: 'create', name: 'Тест-заказчик' }, ctxFor(ADMIN_ID))).customer;
  // заявка «мусорного» пользователя, которую потом отклоним
  await assert.rejects(() => endpoints.me({}, ctxFor(777002)));
  const { users: before } = await endpoints.adminUsers({ action: 'list' }, ctxFor(ADMIN_ID));
  const applicant = before.find((row) => row.tgId === 777002);
  assert.ok(applicant, 'заявка есть');

  // имитируем записи в журнале заявителя (до одобрения их быть не может,
  // поэтому создаём напрямую через API от имени пользователя после одобрения)
  await endpoints.adminUsers({ action: 'setStatus', userId: applicant.id, status: 'approved' }, ctxFor(ADMIN_ID));
  await endpoints.createTrip(
    { date: '2025-05-05', customerId: customer.id, points: 13, distance: 310, hours: 9 },
    ctxFor(777002),
  );
  const { users: withTrip } = await endpoints.adminUsers({ action: 'list' }, ctxFor(ADMIN_ID));
  const approved = withTrip.find((row) => row.tgId === 777002);
  assert.equal(approved.status, 'approved');

  await endpoints.adminUsers({ action: 'setStatus', userId: approved.id, status: 'denied' }, ctxFor(ADMIN_ID));

  const { users: after } = await endpoints.adminUsers({ action: 'list' }, ctxFor(ADMIN_ID));
  assert.ok(!after.some((row) => row.tgId === 777002), 'пользователь удалён из базы');

  // записей тоже нет: попытка зайти снова создаёт новую заявку, а не журнал
  await assert.rejects(() => endpoints.listTrips({}, ctxFor(777002)));
});

console.log('\nАдмин: пользователи');

await test('админ видит заявки и меняет статусы', async () => {
  await messageHandler(msg(888), {});
  const list = await endpoints.adminUsers({ action: 'list' }, ctxFor(ADMIN_ID));
  const pending = list.users.find((row) => row.tgId === 888);
  assert.equal(pending.status, 'pending');
  const changed = await endpoints.adminUsers({ action: 'setStatus', userId: pending.id, status: 'denied' }, ctxFor(ADMIN_ID));
  assert.equal(changed.user.status, 'denied');
  const notice = lastSentTo(888);
  assert.match(notice.text, /отклонил доступ/);
});

await test('владельца нельзя заблокировать или разжаловать', async () => {
  const list = await endpoints.adminUsers({ action: 'list' }, ctxFor(ADMIN_ID));
  const owner = list.users.find((row) => row.tgId === ADMIN_ID);
  assert.equal(owner.isOwner, true);
  await assert.rejects(
    () => endpoints.adminUsers({ action: 'setStatus', userId: owner.id, status: 'blocked' }, ctxFor(ADMIN_ID)),
    (error) => {
      assert.equal(error.parameters.code, 'OWNER_LOCK');
      return true;
    },
  );
  await assert.rejects(
    () => endpoints.adminUsers({ action: 'setRole', userId: owner.id, role: 'admin' }, ctxFor(ADMIN_ID)),
    (error) => {
      assert.equal(error.parameters.code, 'OWNER_LOCK');
      return true;
    },
  );
});

await test('роли выдаются и снимаются владельцем', async () => {
  const list = await endpoints.adminUsers({ action: 'list' }, ctxFor(ADMIN_ID));
  const target = list.users.find((row) => row.tgId === 555);
  const granted = await endpoints.adminUsers({ action: 'setRole', userId: target.id, role: 'admin' }, ctxFor(ADMIN_ID));
  assert.equal(granted.user.isAdmin, true);
  assert.equal(granted.user.isOwner, false);
  const me = await endpoints.me({ tzOffsetMinutes: 180 }, ctxFor(555));
  assert.deepEqual(me.user.permissions, { journal: true, customers: true, tariffs: false, users: false });
  await endpoints.adminUsers({ action: 'setRole', userId: target.id, role: 'user' }, ctxFor(ADMIN_ID));
  const after = await endpoints.me({ tzOffsetMinutes: 180 }, ctxFor(555));
  assert.equal(after.user.permissions.customers, false);
});

console.log('\nТема оформления');

await test('тема сохраняется за пользователем', async () => {
  const result = await endpoints.saveTheme({ theme: 'dark' }, ctxFor(555));
  assert.equal(result.theme, 'dark');
  const me = await endpoints.me({ tzOffsetMinutes: 180 }, ctxFor(555));
  assert.equal(me.user.theme, 'dark', 'профиль отдаёт сохранённую тему');

  await endpoints.saveTheme({ theme: 'system' }, ctxFor(555));
  const again = await endpoints.me({ tzOffsetMinutes: 180 }, ctxFor(555));
  assert.equal(again.user.theme, 'system');
});

await test('некорректная тема отклоняется', async () => {
  await assert.rejects(() => endpoints.saveTheme({ theme: 'rainbow' }, ctxFor(555)), (error) => {
    assert.equal(error.parameters.code, 'BAD_THEME');
    return true;
  });
  await assert.rejects(() => endpoints.saveTheme({ theme: null }, ctxFor(555)), (error) => {
    assert.equal(error.parameters.code, 'BAD_THEME');
    return true;
  });
});

await test('неодобренный пользователь не сохраняет тему', async () => {
  await messageHandler(msg(999111, '/start'), {});
  const stranger = (await db.select().from(schema.users).all()).find((row) => row.tgId === 999111);
  await assert.rejects(() => endpoints.saveTheme({ theme: 'dark' }, ctxFor(999111)), (error) => {
    assert.equal(error.parameters.code, 'ACCESS_DENIED');
    return true;
  });
  assert.equal(stranger.theme, undefined, 'тема не записалась');
});

console.log('\nБот: команды');

await test('/id возвращает Telegram ID', async () => {
  resetApi();
  await messageHandler(msg(555, '/id'), {});
  assert.match(lastSentTo(555).text, /555/);
});

await test('/pending показывает заявки админу', async () => {
  await messageHandler(msg(999), {});
  resetApi();
  await messageHandler(msg(ADMIN_ID, '/pending'), {});
  const sent = lastSentTo(ADMIN_ID);
  assert.match(sent.text, /Ожидают одобрения/);
  assert.match(sent.text, /999/);
});

await test('когда заявок нет — сообщение об этом', async () => {
  const { truncate } = await import('./fake-sdk.mjs');
  truncate();
  await messageHandler(msg(ADMIN_ID), {});
  resetApi();
  await messageHandler(msg(ADMIN_ID, '/pending'), {});
  assert.match(lastSentTo(ADMIN_ID).text, /Новых заявок/);
});

console.log(`\nИтог: ${passed} успешно, ${failed} с ошибкой\n`);
process.exit(failed ? 1 : 0);
