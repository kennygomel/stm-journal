// src/avatar.js — аватары как в Telegram: фото или градиент с инициалами.
//
// Фото приходит с сервера (data URL, скачан ботом). Если фото нет — рисуем
// плейсхолдер: фон выбирается детерминированно по id, буквы — первые символы
// имени и фамилии, как в самом Telegram.

const NS = 'http://www.w3.org/2000/svg';

/** Семь градиентов: те же настроения, что у телеграмных аватаров. */
const PALETTES = [
  ['#FF885E', '#FF516A'],
  ['#FFCD6A', '#FFA85C'],
  ['#82B1FF', '#665FFF'],
  ['#A0DE7E', '#54CB68'],
  ['#53EDD6', '#28C9B7'],
  ['#72D5FD', '#2A9EF1'],
  ['#E0A2F3', '#D669ED'],
];

/** Стабильный номер палитры по id/id пользователя. */
export function paletteIndex(seed) {
  const value = Number(seed) || 0;
  return Math.abs(value) % PALETTES.length;
}

export function gradientFor(seed) {
  const [from, to] = PALETTES[paletteIndex(seed)];
  return `linear-gradient(135deg, ${from}, ${to})`;
}

/** Первые буквы имени и фамилии: «Ignat Rychkov» → «IR», «Торнике» → «Т». */
export function initials(name) {
  // Берём только буквы: эмодзи в имени не должны попадать в аватар.
  const words = String(name || '')
    .trim()
    .split(/\s+/)
    .map((word) => word.match(/\p{L}/u)?.[0])
    .filter(Boolean);
  if (!words.length) return '?';
  const first = words[0];
  const last = words.length > 1 ? words[words.length - 1] : '';
  return (first + last).toUpperCase();
}

/**
 * Узел аватара.
 * @param {{ name?: string, photo?: string|null, seed?: number, size?: 'sm'|'md' }} options
 */
export function avatar({ name = '', photo = null, seed = 0, size = 'md' } = {}) {
  const node = document.createElement('span');
  node.className = `avatar avatar-${size}`;
  node.dataset.userId = String(seed);
  if (photo) {
    const img = document.createElement('img');
    img.className = 'avatar-img';
    img.alt = '';
    img.loading = 'lazy';
    img.src = photo;
    node.append(img);
    return node;
  }
  node.classList.add('avatar-fallback');
  node.style.backgroundImage = gradientFor(seed);
  node.textContent = initials(name);
  node.setAttribute('aria-hidden', 'true');
  return node;
}
