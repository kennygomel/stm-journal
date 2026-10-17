// endpoints/saveTheme.js — запоминает выбранную тему за пользователем.
import { EndpointError } from 'sdk';
import { normalizeTheme, requireUser, setUserTheme } from '../lib/auth.js';

export default async function (input, ctx) {
  const user = await requireUser(ctx);
  const theme = normalizeTheme(input?.theme);
  if (!theme) {
    throw new EndpointError('Тема должна быть light, dark или system', { code: 'BAD_THEME' });
  }
  await setUserTheme(user.id, theme);
  return { theme };
}
