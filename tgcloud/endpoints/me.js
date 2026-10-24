// endpoints/me.js — кто я, что мне доступно и данные для первого экрана.
import { isAdminRow, isOwnerRow, permissionsOf, requireUser } from '../lib/auth.js';
import { avatarNeedsRefresh, refreshUserPhoto } from '../lib/avatars.js';
import { listCustomerDtos } from '../lib/customers.js';
import { getSettings } from '../lib/calc.js';
import { todayIso } from '../lib/format.js';
import { toSettingsDto } from '../lib/settings.js';

export default async function (input, ctx) {
  const user = await requireUser(ctx);
  const isAdmin = isAdminRow(user);
  // Своё фото обновляем при первом заходе и раз в неделю — не чаще.
  let photo = user.photo || null;
  if (isAdmin || avatarNeedsRefresh(user)) {
    photo = (await refreshUserPhoto(user)) || photo;
  }
  const [customers, settings] = await Promise.all([listCustomerDtos({ includeInactive: isAdmin }), getSettings()]);
  return {
    user: {
      id: user.id,
      tgId: user.tgId,
      name: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || `ID ${user.tgId}`,
      username: user.username || null,
      isAdmin,
      isOwner: isOwnerRow(user),
      permissions: permissionsOf(user),
      theme: user.theme || null,
      photo,
    },
    settings: toSettingsDto(settings),
    customers: customers.filter((row) => row.active || isAdmin),
    today: todayIso(input?.tzOffsetMinutes),
  };
}
