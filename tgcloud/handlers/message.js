// handlers/message.js — вход в бота: заявка на доступ и приветствие.
//
// Первое сообщение от нового пользователя создаёт заявку и отправляет админам
// запрос approve/deny. До одобрения доступ к журналу закрыт.

import { api } from 'sdk';
import { MINI_APP_URL, OWNER_IDS, USER_STATUS } from '../lib/config.js';
import { ACCESS_DENIED_TEXT, appButton, isAdminRow, upsertUser } from '../lib/auth.js';
import { ensureRequestNotified, sendWelcome } from '../lib/notify.js';
import { displayName, escapeHtml } from '../lib/format.js';
import { listUsers } from '../lib/users.js';

const HELP = [
  '📔 <b>Журнал рейсов</b>',
  '',
  'Записи вносятся в Mini App — нажмите кнопку ниже.',
  'В записи: дата, заказчик, количество точек, пробег и расчётный доход за рейс.',
  'Там же — редактирование, удаление и баланс за выбранный период.',
  '',
  'Команды:',
  '/start — открыть журнал',
  '/help — эта справка',
  '/id — ваш Telegram ID',
  '/pending — заявки на доступ (админ)',
].join('\n');

function isMenuCommand(text) {
  return /^\/(start|app|journal|help|menu)\b/i.test(String(text || '').trim());
}

/** Ответ пользователю, который не должен ронять обработку апдейта. */
async function reply(params) {
  try {
    return await api.sendMessage(params);
  } catch (error) {
    console.warn('sendMessage failed', { chatId: params?.chat_id, reason: error?.description || String(error) });
    return null;
  }
}

export default async function (message, ctx) {
  const from = message?.from;
  if (!from || from.is_bot) return;

  const chatId = message.chat?.id;
  const text = (message.text || message.caption || '').trim();
  const { user, created } = await upsertUser(from, chatId);
  const admin = isAdminRow(user);

  // Кнопка Mini App в меню чата (не критично, если Telegram откажет).
  try {
    await api.setChatMenuButton({
      chat_id: chatId,
      menu_button: { type: 'web_app', text: '📔 Журнал', web_app: { url: MINI_APP_URL } },
    });
  } catch (error) {
    console.warn('setChatMenuButton failed', { reason: error?.description || String(error) });
  }

  // Заявка без доставленного уведомления (новая или созданная из Mini App) —
  // досылаем запрос админам. Повторы отсекает requestNotifiedAt в базе.
  let delivered = 0;
  if (!admin && user.status === 'pending') {
    try {
      delivered = await ensureRequestNotified(user);
    } catch (error) {
      console.warn('admin notify failed', { reason: error?.description || String(error) });
    }
  }

  // Новый пользователь — подтверждаем, что заявка принята.
  if (created && !admin) {
    await reply({
      chat_id: chatId,
      text: [
        '🕓 <b>Заявка отправлена</b>',
        '',
        `Ваш профиль: ${escapeHtml(displayName(user))} · <code>${user.tgId}</code>`,
        delivered
          ? 'Администратор получил запрос и откроет вам доступ. Я напишу, как только решение будет принято.'
          : 'Если администратор не получил запрос, напишите ему напрямую — доступ откроют вручную.',
      ].join('\n'),
      parse_mode: 'HTML',
    });
    return;
  }

  if (!admin && user.status !== USER_STATUS.approved) {
    if (user.status !== USER_STATUS.blocked) {
      await reply({
        chat_id: chatId,
        text: ACCESS_DENIED_TEXT[user.status] || ACCESS_DENIED_TEXT.pending,
        parse_mode: 'HTML',
      });
    }
    return;
  }

  if (/^\/id\b/i.test(text)) {
    await reply({
      chat_id: chatId,
      text: `Ваш Telegram ID: <code>${user.tgId}</code>${admin ? ' — администратор' : ''}`,
      parse_mode: 'HTML',
    });
    return;
  }

  if (admin && /^\/pending\b/i.test(text)) {
    const pending = (await listUsers()).filter((row) => row.status === USER_STATUS.pending);
    await reply({
      chat_id: chatId,
      text: pending.length
        ? `Ожидают одобрения: <b>${pending.length}</b>\n\n${pending
            .map((row) => `• ${escapeHtml(row.name)} — <code>${row.tgId}</code>`)
            .join('\n')}\n\nОдобрить или отклонить можно в Mini App → «Пользователи».`
        : 'Новых заявок на доступ нет.',
      parse_mode: 'HTML',
      reply_markup: appButton('⚙️ Открыть панель'),
    });
    return;
  }

  if (isMenuCommand(text) || admin) {
    await reply({
      chat_id: chatId,
      text: HELP,
      parse_mode: 'HTML',
      reply_markup: appButton(),
    });
    return;
  }

  // Любое другое сообщение одобренному пользователю — короткая подсказка.
  await reply({
    chat_id: chatId,
    text: 'Записи ведутся в Mini App 👇',
    reply_markup: appButton(),
  });
}
