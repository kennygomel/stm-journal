// endpoints/adminRates.js — глобальные доплаты: лимиты и тарифы (только админ).
import { requireOwner } from '../lib/auth.js';
import { getSettings } from '../lib/calc.js';
import { saveSettings, toSettingsDto } from '../lib/settings.js';

export default async function (input, ctx) {
  const owner = await requireOwner(ctx);
  if (input?.action === 'save') {
    return { settings: await saveSettings(owner, input?.settings || input) };
  }
  return { settings: toSettingsDto(await getSettings()) };
}
