// src/theme.js — тема оформления Mini App: light / dark / system.
//
// Выбор хранится в трёх местах: мгновенно в localStorage (чтобы не было вспышки
// при запуске), за пользователем на сервере (чтобы работало на любом устройстве)
// и применяется атрибутом data-theme на <html> — CSS читает его и берёт палитру.

export const THEMES = [
  { id: 'light', label: 'Светлая' },
  { id: 'dark', label: 'Тёмная' },
  { id: 'system', label: 'Системная' },
];

const STORAGE_KEY = 'journal:theme';
const listeners = new Set();

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function normalizeTheme(value) {
  const theme = String(value ?? '').toLowerCase();
  return THEMES.some((item) => item.id === theme) ? theme : null;
}

export function getTheme() {
  return normalizeTheme(storage()?.getItem(STORAGE_KEY)) || 'system';
}

/** Применяет тему: system → снимаем атрибут и отдаём решение медиазапросу. */
export function applyTheme(theme = getTheme()) {
  const next = normalizeTheme(theme) || 'system';
  const root = document.documentElement;
  if (next === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', next);

  // Цвет системных элементов (скроллбары, поля ввода) под тему.
  const dark =
    next === 'dark' || (next === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true);
  root.style.colorScheme = dark ? 'dark' : 'light';

  for (const listener of listeners) {
    try {
      listener(next);
    } catch (error) {
      console.warn('theme listener failed', error);
    }
  }
  return next;
}

/**
 * Сохраняет тему локально и на сервере.
 * @returns {Promise<{theme: string, saved: boolean}>}
 */
export async function setTheme(theme, { persist } = {}) {
  const next = normalizeTheme(theme) || 'system';
  storage()?.setItem(STORAGE_KEY, next);
  applyTheme(next);

  const save = persist || (async (value) => {
    const { api } = await import('./api.js');
    return api.saveTheme(value);
  });

  try {
    await save(next);
    return { theme: next, saved: true };
  } catch (error) {
    console.warn('theme save failed', error);
    return { theme: next, saved: false };
  }
}

/** Тема из профиля пользователя старше локальной? Тогда берём серверную. */
export function adoptServerTheme(theme) {
  const server = normalizeTheme(theme);
  if (!server) return getTheme();
  storage()?.setItem(STORAGE_KEY, server);
  return applyTheme(server);
}

export function onThemeChange(handler) {
  listeners.add(handler);
  return () => listeners.delete(handler);
}

/** Реакция на смену системной темы, пока выбрано «как в системе». */
export function watchSystemTheme() {
  const query = window.matchMedia?.('(prefers-color-scheme: dark)');
  if (!query?.addEventListener) return;
  query.addEventListener('change', () => {
    if (getTheme() === 'system') applyTheme('system');
  });
}
