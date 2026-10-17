// src/dom.js — минимальные помощники для рендеринга и модальных окон.

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'dataset' && typeof value === 'object') Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of flatten(children)) {
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Кнопка с обработчиком, который блокируется на время выполнения. */
export function button(content, { className = 'btn', onClick, type = 'button' } = {}) {
  const node = el('button', { class: className, type }, content);
  if (onClick) {
    node.addEventListener('click', async (event) => {
      event.preventDefault();
      if (node.disabled) return;
      node.disabled = true;
      try {
        await onClick(event, { node });
      } finally {
        node.disabled = false;
      }
    });
  }
  return node;
}

/**
 * Вставляет детей в существующий узел, отбрасывая null/undefined/false.
 * Нативный append(null) превращается в текстовый «null» — здесь этого не будет.
 */
export function mount(node, ...children) {
  node.replaceChildren(...flatten(children));
  return node;
}

/** Добавляет детей в конец узла (без «null» в разметке). */
export function add(node, ...children) {
  for (const child of flatten(children)) node.append(child);
  return node;
}

/** Разворачивает вложенные массивы узлов в один плоский список. */
export function flatten(children) {
  const out = [];
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) out.push(...flatten(child));
    else out.push(child);
  }
  return out;
}

/** Соединяет фрагменты разделителем (для строк вида «База: 2 500 <знак BYN> · …»). */
export function joinNodes(parts, separator = ' · ') {
  const out = [];
  parts.filter(Boolean).forEach((part, index) => {
    if (index) out.push(separator);
    out.push(...flatten(part));
  });
  return out;
}

/** Подпись + поле. Подпись стоит над полем — для обычных форм и диалогов. */
export function field(label, control, hint) {
  return el('div', { class: 'field' }, [
    el('label', { text: label }),
    control,
    hint ? el('div', { class: 'hint-line', text: hint }) : null,
  ]);
}

/**
 * Поле с подписью-префиксом: подпись живёт внутри рамки, слева от значения.
 * Так в фильтрах и компактных формах нет «столбика» мелких подписей сверху.
 * @param {string | Node[]} prefix
 * @param {HTMLElement} control
 */
export function inlineField(prefix, control) {
  return el('label', { class: 'field-inline' }, [
    el('span', { class: 'field-inline-label' }, prefix),
    control,
  ]);
}

/** Поле с иконкой-префиксом (то же, но компактнее). */
export function prefixedField(prefixParts, control, hint) {
  return el('div', { class: 'field-prefixed' }, [
    el('span', { class: 'field-prefix' }, prefixParts),
    control,
    hint ? el('span', { class: 'field-inline-hint' }, hint) : null,
  ]);
}

/**
 * Плейсхолдер вместо пустоты: объясняет, что здесь появится и что сделать.
 * @param {string} title
 * @param {string} [hint]
 */
export function placeholder(title, hint) {
  return el('div', { class: 'placeholder' }, [
    el('div', { class: 'placeholder-title', text: title }),
    hint ? el('div', { class: 'placeholder-hint', text: hint }) : null,
  ]);
}

/** Как field(), но заголовок собирается из фрагментов (можно вставить знак BYN). */
export function fieldNodes(labelParts, control, hint) {
  return el('div', { class: 'field' }, [
    el('label', {}, flatten(labelParts)),
    control,
    hint ? el('div', { class: 'hint-line', text: hint }) : null,
  ]);
}

export function input({ type = 'text', value = '', ...rest } = {}) {
  return el('input', { type, value: value ?? '', ...rest });
}

export function select(options, value) {
  const node = el('select');
  for (const option of options) {
    node.append(
      el('option', { value: option.value, selected: String(option.value) === String(value) }, option.label),
    );
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function sectionTitle(text) {
  return el('div', { class: 'section-title', text });
}

export function card(children, className = 'card') {
  return el('div', { class: className }, children);
}

/**
 * Горизонтальная лента с затуханием справа: у края плавный градиент в
 * прозрачность, а когда лента докручена до конца — затухание снимается.
 */
export function scrollFade(node) {
  const update = () => {
    const max = node.scrollWidth - node.clientWidth;
    node.classList.toggle('at-start', node.scrollLeft <= 1);
    node.classList.toggle('at-end', max <= 0 || node.scrollLeft >= max - 1);
  };
  node.addEventListener('scroll', update, { passive: true });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(update).observe(node);
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(update);
  return node;
}

export function empty(text, sub) {
  return el('div', { class: 'empty' }, [el('div', { text }), sub ? el('div', { class: 'muted', text: sub }) : null]);
}

/**
 * Нижняя шторка с содержимым формы.
 * onSubmit(close) → true, если шторку нужно закрыть.
 */
export function sheet({ title, content, onSubmit, submitLabel = 'Сохранить', onDelete }) {
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (event) => {
    if (event.key === 'Escape') close();
  };

  const backdrop = el(
    'div',
    {
      class: 'sheet-backdrop',
      onClick: (event) => {
        if (event.target === backdrop) close();
      },
    },
  );
  document.addEventListener('keydown', onKey);

  const actions = [];
  if (onDelete) {
    actions.push(
      button('Удалить', {
        className: 'btn',
        onClick: async () => {
          await onDelete(close);
        },
      }),
    );
  }
  actions.push(button('Отмена', { className: 'btn', onClick: () => close() }));
  actions.push(
    button(submitLabel, {
      className: 'btn primary',
      onClick: async () => {
        const ok = await onSubmit(close);
        if (ok) close();
      },
    }),
  );

  const panel = el('div', { class: 'sheet' }, [
    el('h2', { text: title }),
    ...(Array.isArray(content) ? content : [content]),
    el('div', { class: 'sheet-actions' }, actions),
  ]);
  backdrop.append(panel);
  document.body.append(backdrop);
  setTimeout(() => panel.querySelector('input, select')?.focus(), 50);
  return { close, panel };
}

let toastTimer = null;
export function toast(message, { error = false } = {}) {
  const node = document.getElementById('toast');
  if (!node) return;
  node.textContent = message;
  node.className = `toast${error ? ' error' : ''}`;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(
    () => {
      node.hidden = true;
    },
    error ? 4200 : 2400,
  );
}
