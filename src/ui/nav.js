// src/ui/nav.js — нижняя навигация и хлебные крошки.
//
// Верхнюю шапку оставляем бренду и теме, а разделы переносим в нижний бар:
// до него достаёт большой палец, и он не спорит с заголовком.

/** Иконки разделов — тот же штрих 1.7, что и у показателей. */
const TABS = {
  journal: {
    label: 'Журнал',
    icon: [
      'M4 8.5h9v7H4z',
      'M13 11h3l3 2.5v2H13z',
      'M6.5 18a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
      'M16 18a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
    ],
  },
  report: {
    label: 'История',
    icon: ['M12 19.5V4.5', 'M12 15h6.5', 'M12 10.5H5.5', 'M12 19.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15Z'],
  },
  admin: {
    label: 'Админ',
    icon: ['M12 3.5l7.5 3.2v5c0 4.3-3.1 7.5-7.5 8.8-4.4-1.3-7.5-4.5-7.5-8.8v-5z', 'M8.8 12l2.1 2.1 4.3-4.3'],
  },
};

function iconSvg(paths, className = 'nav-icon') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/**
 * Нижний бар: кнопки разделов с иконками.
 * @param {Array<{id: string, label: string}>} tabs
 * @param {(id: string) => void} onSelect
 */
export function bottomNav(tabs, onSelect) {
  const node = document.createElement('nav');
  node.className = 'bottom-nav';
  node.setAttribute('aria-label', 'Разделы');

  const buttons = new Map();
  for (const tab of tabs) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nav-item';
    button.append(iconSvg(TABS[tab.id]?.icon || []), document.createTextNode(tab.label));
    button.addEventListener('click', () => onSelect(tab.id));
    buttons.set(tab.id, button);
    node.append(button);
  }

  return {
    node,
    setActive(activeId) {
      for (const [id, button] of buttons) {
        button.classList.toggle('active', id === activeId);
        button.setAttribute('aria-current', id === activeId ? 'page' : 'false');
      }
    },
    setBadge(id, count) {
      const button = buttons.get(id);
      if (!button) return;
      const existing = button.querySelector('.nav-badge');
      if (existing) existing.remove();
      if (count > 0) {
        const badge = document.createElement('span');
        badge.className = 'nav-badge';
        badge.textContent = String(count);
        button.append(badge);
      }
    },
  };
}

/**
 * Хлебные крошки: `Панель / Тарифы`.
 * @param {Array<{label: string, onClick?: () => void}>} parts
 */
export function breadcrumbs(parts) {
  const node = document.createElement('nav');
  node.className = 'crumbs';
  node.setAttribute('aria-label', 'Навигация');

  parts.forEach((part, index) => {
    if (index) {
      const divider = document.createElement('span');
      divider.className = 'crumb-divider';
      divider.setAttribute('aria-hidden', 'true');
      node.append(divider);
    }
    const isLast = index === parts.length - 1;
    if (isLast || !part.onClick) {
      const current = document.createElement('span');
      current.className = 'crumb current';
      current.setAttribute('aria-current', 'page');
      current.textContent = part.label;
      node.append(current);
      return;
    }
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'crumb';
    link.textContent = part.label;
    link.addEventListener('click', part.onClick);
    node.append(link);
  });

  return node;
}
