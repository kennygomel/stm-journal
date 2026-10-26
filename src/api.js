// src/api.js — клиент эндпоинтов Mini App.

import { call, tzOffsetMinutes } from './telegram.js';
import { todayIso } from './format.js';

const withTz = (payload = {}) => ({ tzOffsetMinutes: tzOffsetMinutes(), ...payload });

export const api = {
  me: () => call('me', withTz()),

  listTrips: ({ from = null, to = null } = {}) => call('listTrips', { from, to }),

  createTrip: (trip) => call('createTrip', withTz(trip)),

  updateTrip: (trip) => call('updateTrip', withTz(trip)),

  deleteTrip: (id) => call('deleteTrip', { id }),

  report: ({ from = null, to = null } = {}) => call('report', withTz({ from, to })),

  customers: (action, payload = {}) => call('adminCustomers', { action, ...payload }),

  rates: (action = 'get', payload = {}) => call('adminRates', { action, ...payload }),

  users: (action = 'list', payload = {}) => call('adminUsers', { action, ...payload }),

  saveTheme: (theme) => call('saveTheme', { theme }),

  recalc: ({ from = null, to = null, apply = false, userId = null } = {}) => call('adminRecalc', { from, to, apply, userId }),

  stats: ({ from = null, to = null } = {}) => call('adminStats', withTz({ from, to })),

  avatars: () => call('adminAvatars', {}),

  leaderboard: () => call('leaderboard', {}),
};

export { todayIso };
