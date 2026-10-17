// src/views/users.js — админ: заявки на доступ и права пользователей.

import { api } from '../api.js';
import { button, card, el, placeholder, sectionTitle, toast } from '../dom.js';
import { fmtDate } from '../format.js';
import { confirmAction, haptic } from '../telegram.js';

const STATUS_LABEL = {
  pending: 'Ждёт одобрения',
  approved: 'Доступ открыт',
  denied: 'Отклонён',
  blocked: 'Заблокирован',
};

export function usersView(root, ctx) {
  const body = el('div');

  function render(users) {
    ctx.users = users;
    const pending = users.filter((row) => row.status === 'pending');
    const others = users.filter((row) => row.status !== 'pending');

    body.replaceChildren(
      sectionTitle(pending.length ? `Заявки на доступ · ${pending.length}` : 'Заявки на доступ'),
      pending.length
        ? card(pending.map((row) => userCard(row)))
        : placeholder('Заявок нет', 'Новый пользователь появится здесь после /start в боте'),
      sectionTitle('Все пользователи'),
      others.length
        ? card(others.map((row) => userCard(row)))
        : placeholder('Пользователей нет', 'Первый пользователь появится после /start в боте'),
    );
  }

  function userCard(row) {
    const role = row.isOwner ? 'владелец' : row.isAdmin ? 'админ · только заказчики' : null;
    const details = [
      row.username ? `@${row.username}` : null,
      `ID ${row.tgId}`,
      STATUS_LABEL[row.status] || row.status,
      role,
      row.createdAt ? `с ${fmtDate(toIso(row.createdAt))}` : null,
    ].filter(Boolean);

    return card([
      el('div', {}, [
        el('div', { class: 'trip-name', text: row.name }),
        el('div', { class: 'muted', text: details.join(' · ') }),
      ]),
      el('div', { class: 'actions' }, [
        row.status !== 'approved'
          ? button('Одобрить', { className: 'btn ghost', onClick: () => change(row, 'approved') })
          : null,
        row.status === 'approved'
          ? button('Заблокировать', {
              className: 'btn danger',
              onClick: async () => {
                const ok = await confirmAction(`Закрыть доступ для ${row.name}?`);
                if (ok) await change(row, 'blocked');
              },
            })
          : button('Отклонить', { className: 'btn danger', onClick: () => change(row, 'denied') }),
        row.isOwner
          ? el('span', { class: 'role-tag' }, 'владелец')
          : button(row.isAdmin ? 'Снять админа' : 'Сделать админом', {
              className: 'btn ghost',
              onClick: () => setRole(row, row.isAdmin ? 'user' : 'admin'),
            }),
      ]),
    ]);
  }

  async function change(row, status) {
    try {
      await api.users('setStatus', { userId: row.id, status });
      haptic('success');
      await refresh();
    } catch (error) {
      toast(error.message, { error: true });
    }
  }

  async function setRole(row, role) {
    try {
      await api.users('setRole', { userId: row.id, role });
      haptic('light');
      await refresh();
    } catch (error) {
      toast(error.message, { error: true });
    }
  }

  async function refresh() {
    try {
      const result = await api.users('list');
      render(result.users);
    } catch (error) {
      toast(error.message, { error: true });
    }
  }

  root.append(body);
  refresh();

  return { refresh };
}

function toIso(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
