// src/counter.js — анимация сумм: число «набегает» при появлении блока.
//
// Анимируем только число, знак BYN остаётся отдельным узлом (свой шрифт).
// При reduced-motion или отсутствии requestAnimationFrame сразу показываем
// итог — доступность важнее эффекта.

import { fmtNumber, moneyText } from './format.js';
import { bynSign } from './format.js';

const DURATION = 650;

function prefersReducedMotion() {
  try {
    return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  } catch {
    return false;
  }
}

/**
 * Анимирует целое число (количество рейсов, пользователей, точек…).
 * @param {HTMLElement} node
 * @param {number | string} value
 * @param {{ duration?: number }} [options]
 */
export function animateNumber(node, value, { duration = DURATION } = {}) {
  const target = Math.round(Number(String(value).replace(/\s/g, '')) || 0);
  node.replaceChildren();
  const number = document.createElement('span');
  number.className = 'money-number';
  node.append(number);

  if (target === 0 || prefersReducedMotion() || typeof requestAnimationFrame !== 'function') {
    number.textContent = fmtNumber(target);
    return;
  }
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const tick = (now) => {
    const elapsed = (typeof now === 'number' ? now : Date.now()) - startedAt;
    const progress = Math.min(1, Math.max(0, elapsed / duration));
    const eased = 1 - (1 - progress) ** 3;
    number.textContent = fmtNumber(Math.round(target * eased));
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/**
 * Заполняет узел суммой с анимацией счётчика.
 * @param {HTMLElement} node
 * @param {number} kopecks
 * @param {{ duration?: number }} [options]
 */
export function animateMoney(node, kopecks, { duration = DURATION } = {}) {
  const target = Math.round(Number(kopecks) || 0);
  const number = document.createElement('span');
  number.className = 'money-number';
  node.replaceChildren(number, bynSign());

  if (target === 0 || prefersReducedMotion() || typeof requestAnimationFrame !== 'function') {
    number.textContent = moneyText(target);
    return;
  }

  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const tick = (now) => {
    const elapsed = (typeof now === 'number' ? now : Date.now()) - startedAt;
    const progress = Math.min(1, Math.max(0, elapsed / duration));
    // easeOutCubic: быстро стартует, мягко доезжает до итога.
    const eased = 1 - (1 - progress) ** 3;
    number.textContent = moneyText(Math.round(target * eased));
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
