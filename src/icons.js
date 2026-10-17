// src/icons.js — авторские иконки (SVG, один штрих 1.7).
//
// Нарисованы под линейку 24×24, stroke=currentColor: масштабируются без потерь
// и наследуют цвет текста. Юникод-глифы и эмодзи здесь не используются — это
// костюм вместо иконки.

const NS = 'http://www.w3.org/2000/svg';

const PATHS = {
  /** Рейс: фургон. */
  trip: ['M3 7.5h10.5v8H3z', 'M13.5 10.5H17l3 2.5v2.5h-6.5z', 'M7.2 18.3a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6Z', 'M16.8 18.3a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6Z'],
  /** Точки: метка на карте (круг вырезан, чтобы читался внутри контура). */
  points: ['M12 21s6-5.2 6-10.2a6 6 0 1 0-12 0C6 15.8 12 21 12 21Z', 'M12 13.4a1.9 1.9 0 1 0 0-3.8 1.9 1.9 0 0 0 0 3.8Z'],
  /** Пробег: маршрут между двумя точками. */
  distance: ['M6.5 19a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z', 'M17.5 10a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z', 'M6.5 11.6V9.5A3 3 0 0 1 9.5 6.5h5.5'],
  /** Часы: круг с центром (12,12). */
  hours: ['M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 1 0 0 17Z', 'M12 7.8V12l3 2'],
  /** Рабочие дни: календарь с петельками. */
  calendar: [
    'M4.5 9h15v9.5a1.5 1.5 0 0 1-1.5 1.5H6a1.5 1.5 0 0 1-1.5-1.5z',
    'M4.5 9V6.5A1.5 1.5 0 0 1 6 5h12a1.5 1.5 0 0 1 1.5 1.5V9',
    'M8 3.2v3.6M16 3.2v3.6',
    'M8.5 12.8h2M13.5 12.8h2M8.5 16.2h2M13.5 16.2h2',
  ],
};

/**
 * @param {keyof typeof PATHS} name
 * @param {{ className?: string, title?: string }} [options]
 */
export function icon(name, { className = 'metric-icon', title } = {}) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', title ? 'false' : 'true');
  if (title) svg.setAttribute('role', 'img');
  for (const d of PATHS[name] || []) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  if (title) {
    const label = document.createElementNS(NS, 'title');
    label.textContent = title;
    svg.append(label);
  }
  return svg;
}

/**
 * Показатель сводки: иконка + значение. Подпись словами не нужна — иконка
 * читается быстрее, а единица измерения остаётся в значении.
 * @param {keyof typeof PATHS} name
 * @param {string} value
 */
export function metric(name, value) {
  const node = document.createElement('span');
  node.className = 'metric';
  node.append(icon(name, { title: METRIC_TITLES[name] }), document.createTextNode(value));
  return node;
}

export const METRIC_TITLES = {
  calendar: 'Рабочие дни',
  trip: 'Рейсы',
  points: 'Точки',
  distance: 'Пробег',
  hours: 'Часы',
};
