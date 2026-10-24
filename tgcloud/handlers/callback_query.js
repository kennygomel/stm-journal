// handlers/callback_query.js — кнопки «Одобрить» / «Отклонить» в запросе доступа.

import { api } from 'sdk';
import { CALLBACK, USER_STATUS } from '../lib/config.js';
import { displayName, escapeHtml } from '../lib/format.js';
import { findUser, findUserById, isAdminRow } from '../lib/auth.js';
import { applyStatus } from '../lib/users.js';

/** Разбирает callback_data вида «usr:ok:12» / «usr:no:12». */
function parseAction(data) {
  const raw = String(data || '');
  const cut = raw.lastIndexOf(':');
  if (cut < 0) return null;
  const action = raw.slice(0, cut);
  const status =
    action === CALLBACK.approve ? USER_STATUS.approved : action === CALLBACK.deny ? USER_STATUS.denied : null;
  const userId = Number(raw.slice(cut + 1));
  if (!status || !Number.isSafeInteger(userId) || userId <= 0) return null;
  return { status, userId };
}

function verdictLine(admin, target, status) {
  const action = status === USER_STATUS.approved ? '✅ <b>Доступ одобрен</b>' : '🚫 <b>Доступ отклонён</b>';
  return [
    action,
    '',
    `👤 ${escapeHtml(displayName(target))} · <code>${target.tgId}</code>`,
    `Решил: ${escapeHtml(displayName(admin))} · <code>${admin.tgId}</code>`,
  ].join('\n');
}

/** Ответ на нажатие; ошибка не должна ронять обработку апдейта. */
async function answer(queryId, params = {}) {
  try {
    await api.answerCallbackQuery({ callback_query_id: queryId, ...params });
  } catch (error) {
    console.warn('answerCallbackQuery failed', { reason: error?.description || String(error) });
  }
}

export default async function (query, ctx) {
  const data = query?.data || '';
  const chatId = query?.message?.chat?.id;
  const messageId = query?.message?.message_id;

  if (data === 'noop') {
    await answer(query.id);
    return;
  }

  const parsed = parseAction(data);
  if (!parsed) {
    await answer(query.id, { text: 'Кнопка устарела' });
    return;
  }

  const admin = query.from ? await findUser(query.from.id) : null;
  if (!isAdminRow(admin)) {
    await answer(query.id, { text: 'Недостаточно прав', show_alert: true });
    return;
  }

  const target = await findUserById(parsed.userId);
  if (!target) {
    await answer(query.id, { text: 'Пользователь не найден' });
    return;
  }

  // Решение применяет lib/users.js: уведомление пользователю + удаление
  // заявки и всех записей при отказе.
  const result = await applyStatus(admin, target, parsed.status);

  // Обновляем сообщение-запрос: видно вердикт и кто его принял.
  // Кнопки убираем — решение уже принято, нажимать больше нечего.
  if (chatId && messageId) {
    const updated = { ...target, status: parsed.status };
    const text = result?.deleted
      ? `${verdictLine(admin, updated, parsed.status)}\n\n🗑 Заявка и все записи удалены.`
      : verdictLine(admin, updated, parsed.status);
    await api
      .editMessageText({
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [] },
      })
      .catch(async () => {
        // Текст мог не измениться (повторное нажатие) — тогда снимаем клавиатуру.
        await api
          .editMessageReplyMarkup({ chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } })
          .catch(() => {});
      });
  }

  await answer(query.id, {
    text: parsed.status === USER_STATUS.approved ? 'Доступ одобрен' : 'Заявка отклонена',
  });
}
