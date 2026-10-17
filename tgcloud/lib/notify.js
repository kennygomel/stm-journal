// lib/notify.js — уведомления админам и пользователям из хендлеров бота.

import { api } from 'sdk';
import { displayName, escapeHtml, formatDateRu, userLine } from './format.js';
import { CALLBACK, MINI_APP_URL } from './config.js';
import { listAdmins, notifyUser } from './auth.js';

function approvalKeyboard(user) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Одобрить', callback_data: `${CALLBACK.approve}:${user.id}` },
        { text: '❌ Отклонить', callback_data: `${CALLBACK.deny}:${user.id}` },
      ],
    ],
  };
}

function approvalText(user) {
  const created = user.createdAt instanceof Date ? user.createdAt.toISOString().slice(0, 10) : '';
  return [
    '🔔 <b>Запрос доступа к журналу рейсов</b>',
    '',
    `👤 <b>${escapeHtml(displayName(user))}</b>`,
    `🆔 <code>${user.tgId}</code>`,
    user.username ? `🔗 @${escapeHtml(user.username)}` : null,
    created ? `📅 ${formatDateRu(created)}` : null,
    '',
    'Разрешить этому пользователю вести свой журнал?',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Рассылает запрос на approve/deny всем админам. */
export async function notifyAdminsAboutRequest(user) {
  const admins = await listAdmins();
  const text = approvalText(user);
  const reply_markup = approvalKeyboard(user);
  let delivered = 0;
  for (const admin of admins) {
    try {
      await api.sendMessage({ chat_id: admin.chatId || admin.tgId, text, parse_mode: 'HTML', reply_markup });
      delivered += 1;
      continue;
    } catch (error) {
      try {
        await api.sendMessage({ chat_id: admin.tgId, text, parse_mode: 'HTML', reply_markup });
        delivered += 1;
      } catch (fallbackError) {
        console.warn('admin notify failed', {
          adminId: admin.tgId,
          reason: fallbackError?.description || error?.description || String(error),
        });
      }
    }
  }
  return delivered;
}

function greeting(user) {
  return [
    `👋 Привет, <b>${escapeHtml(displayName(user))}</b>!`,
    '',
    'Это журнал рейсов грузоперевозок.',
    '',
    'Что можно делать:',
    '• вносить рейсы: дата, заказчик, точки, пробег;',
    '• редактировать и удалять свои записи;',
    '• смотреть доход за рейс и баланс за любой период.',
    '',
    'Открой журнал кнопкой ниже — Mini App работает прямо в Telegram.',
  ].join('\n');
}

export async function sendWelcome(user) {
  await api.sendMessage({
    chat_id: user.chatId || user.tgId,
    text: greeting(user),
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [[{ text: '📔 Открыть журнал', web_app: { url: MINI_APP_URL } }]] },
  });
}

export async function sendAccessDeniedNotice(user, status) {
  const text =
    status === 'denied'
      ? '🚫 Администратор отклонил запрос на доступ к журналу рейсов.'
      : '🚫 Доступ к журналу рейсов заблокирован администратором.';
  return notifyUser(user, text);
}

export { userLine };
