// src/events.js — одна шина событий, чтобы разделы не импортировали друг друга.

const listeners = new Map();

/** on('journal:changed', handler) → функция отписки. */
export function on(event, handler) {
  const list = listeners.get(event) || [];
  list.push(handler);
  listeners.set(event, list);
  return () => {
    listeners.set(event, (listeners.get(event) || []).filter((item) => item !== handler));
  };
}

export function emit(event, payload) {
  for (const handler of listeners.get(event) || []) {
    try {
      handler(payload);
    } catch (error) {
      console.error(`handler for ${event} failed`, error);
    }
  }
}

export const EVENTS = {
  journalChanged: 'journal:changed',
  tripSaved: 'trip:saved',
};
