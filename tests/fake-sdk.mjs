// tests/fake-sdk.mjs — минимальная реализация платформенного SDK для тестов.
//
// Поддерживает ровно то, что использует проект: движок запросов с режимами
// конвертации, RETURNING, описанные операторы и заглушку Telegram Bot API.

// ---------------------------------------------------------------- schema DSL

function makeColumn(name, config = {}) {
  const column = {
    __column: true,
    name,
    config,
    primaryKey: (opts = {}) => makeColumn(name, { ...config, primaryKey: true, autoIncrement: Boolean(opts.autoIncrement) }),
    notNull: () => makeColumn(name, { ...config, notNull: true }),
    unique: () => makeColumn(name, { ...config, unique: true }),
    default: (value) => makeColumn(name, { ...config, default: value }),
    constraint: () => makeColumn(name, config),
    deprecated: () => makeColumn(name, config),
  };
  return column;
}

export function table(name, columns, extra) {
  const descriptor = { __table: true, name, columns, extra };
  // Реальный SDK отдаёт ссылки на колонки и напрямую (users.tgId), и в .columns.
  for (const [key, column] of Object.entries(columns)) {
    if (descriptor[key] === undefined) descriptor[key] = column;
  }
  descriptor.strict = () => descriptor;
  descriptor.withoutRowid = () => descriptor;
  descriptor.constraint = () => descriptor;
  descriptor.deprecated = () => descriptor;
  return descriptor;
}

export const integer = (name, config) => makeColumn(name, config);
export const text = (name, config) => makeColumn(name, config);
export const real = (name, config) => makeColumn(name, config);
export const numeric = (name, config) => makeColumn(name, config);
export const blob = (name, config) => makeColumn(name, config);
export const boolean = (name, config) => makeColumn(name, { ...config, mode: 'boolean' });
export const json = (name, config) => makeColumn(name, { ...config, mode: 'json' });

export const index = (name) => ({ name, on: () => ({ name }) });
export const uniqueIndex = (name) => ({ name, on: () => ({ name }) });
export const check = (name) => ({ name });
export const primaryKey = (opts) => ({ ...opts });
export const unique = (name) => ({ name, on: () => ({ name }) });
export const foreignKey = () => {
  throw new Error('foreignKey is not supported');
};

export const sql = (strings, ...values) => ({ __sql: true, strings, values });
sql.raw = (value) => ({ __sql: true, raw: value, strings: [value], values: [] });

// ------------------------------------------------------------------ operators

export const eq = (column, value) => ({ op: 'eq', column, value });
export const ne = (column, value) => ({ op: 'ne', column, value });
export const gt = (column, value) => ({ op: 'gt', column, value });
export const gte = (column, value) => ({ op: 'gte', column, value });
export const lt = (column, value) => ({ op: 'lt', column, value });
export const lte = (column, value) => ({ op: 'lte', column, value });
export const like = (column, pattern) => ({ op: 'like', column, pattern });
export const notLike = (column, pattern) => ({ op: 'notLike', column, pattern });
export const and = (...args) => ({ op: 'and', args: args.flat().filter(Boolean) });
export const or = (...args) => ({ op: 'or', args: args.flat().filter(Boolean) });
export const not = (arg) => ({ op: 'not', arg });
export const inArray = (column, values) => ({ op: 'in', column, values });
export const notInArray = (column, values) => ({ op: 'nin', column, values });
export const isNull = (column) => ({ op: 'isNull', column });
export const isNotNull = (column) => ({ op: 'isNotNull', column });
export const between = (column, a, b) => ({ op: 'between', column, a, b });
export const asc = (column) => ({ op: 'asc', column });
export const desc = (column) => ({ op: 'desc', column });
export const count = () => ({ op: 'count' });
export const sum = (column) => ({ op: 'sum', column });
export const avg = (column) => ({ op: 'avg', column });
export const min = (column) => ({ op: 'min', column });
export const max = (column) => ({ op: 'max', column });

// ------------------------------------------------------------------ converter

function decode(column, value) {
  if (value === null || value === undefined) return value ?? null;
  const mode = column?.config?.mode;
  if (mode === 'boolean') return Boolean(value);
  if (mode === 'json') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  if (mode === 'timestamp') return new Date(Number(value) * 1000);
  if (mode === 'timestamp_ms') return new Date(Number(value));
  return value;
}

function encode(column, value) {
  if (value === null || value === undefined) return null;
  const mode = column?.config?.mode;
  if (mode === 'boolean') return value ? 1 : 0;
  if (mode === 'json') return JSON.stringify(value);
  if (mode === 'timestamp') return Math.floor(new Date(value).getTime() / 1000);
  if (mode === 'timestamp_ms') return new Date(value).getTime();
  return value;
}

function columnOf(ref) {
  if (ref && ref.__column) return ref;
  return null;
}

function decodeRow(descriptor, raw) {
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    const column = descriptor.columns[key === 'id' ? 'id' : key];
    out[key] = decode(column, value);
  }
  return out;
}

function encodeValues(descriptor, values) {
  const out = {};
  for (const [key, value] of Object.entries(values)) {
    const column = descriptor.columns[key];
    out[key] = encode(column, value);
  }
  return out;
}

// ------------------------------------------------------------------- storage

export const store = new Map();
const sequences = new Map();

/** Полная очистка всех таблиц (тесты). */
export function resetDb() {
  store.clear();
  sequences.clear();
}

/** Очистка только данных, без сброса счётчиков. */
export function truncate() {
  for (const rows of store.values()) rows.length = 0;
}

function rowsOf(descriptor) {
  if (!store.has(descriptor.name)) store.set(descriptor.name, []);
  return store.get(descriptor.name);
}

function pkName(descriptor) {
  for (const [key, column] of Object.entries(descriptor.columns)) {
    if (column.config?.primaryKey) return key;
  }
  return 'id';
}

// ------------------------------------------------------------ matching logic

function fieldName(columnRef) {
  const column = columnOf(columnRef);
  if (column) return column.name || Object.keys(column)[0];
  return columnRef;
}

/** Ключ строки в хранилище для ссылки на колонку (js-имя, не sql-имя). */
function jsKeyOf(columnRef, descriptor) {
  if (descriptor && columnRef) {
    for (const [key, column] of Object.entries(descriptor.columns)) {
      if (column === columnRef) return key;
    }
  }
  return columnRef?.name;
}

function cleanValue(value) {
  if (value instanceof Date) return value;
  return value;
}

function matches(row, condition, descriptor) {
  if (!condition) return true;
  const { op } = condition;
  if (op === 'and') return condition.args.every((arg) => matches(row, arg, descriptor));
  if (op === 'or') return condition.args.some((arg) => matches(row, arg, descriptor));
  if (op === 'not') return !matches(row, condition.arg, descriptor);
  const actual = cleanValue(row[jsKeyOf(condition.column, descriptor)]);
  const expected = cleanValue(condition.value);
  switch (op) {
    case 'eq':
      return actual === expected;
    case 'ne':
      return actual !== expected;
    case 'gt':
      return actual > expected;
    case 'gte':
      return actual >= expected;
    case 'lt':
      return actual < expected;
    case 'lte':
      return actual <= expected;
    case 'in':
      return condition.values.map(cleanValue).includes(actual);
    case 'nin':
      return !condition.values.map(cleanValue).includes(actual);
    case 'isNull':
      return actual === null || actual === undefined;
    case 'isNotNull':
      return actual !== null && actual !== undefined;
    case 'between':
      return actual >= cleanValue(condition.a) && actual <= cleanValue(condition.b);
    case 'like':
    case 'notLike': {
      // SQL LIKE: % — любые символы, _ — один символ, регистр не важен.
      const source = String(condition.pattern ?? '')
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/%/g, '.*')
        .replace(/_/g, '.');
      const matched = new RegExp(`^${source}$`, 'i').test(String(actual ?? ''));
      return op === 'like' ? matched : !matched;
    }
    default:
      return true;
  }
}

function project(descriptor, raw, projection) {
  if (!projection) return decodeRow(descriptor, raw);
  const out = {};
  for (const [alias, ref] of Object.entries(projection)) {
    if (ref && ref.__column) {
      const key = Object.keys(descriptor.columns).find((k) => descriptor.columns[k] === ref);
      out[alias] = decode(ref, raw[key]);
    } else if (ref && ref.op === 'count') {
      out[alias] = raw.__count;
    } else {
      out[alias] = raw[alias];
    }
  }
  return out;
}

// ------------------------------------------------------------- query builders

function makeSelect(projection) {
  let condition = null;
  let ordering = [];
  let limitValue = null;
  let groupKey = null;
  const builder = {
    from(descriptor) {
      builder.__descriptor = descriptor;
      return builder;
    },
    where(...args) {
      const list = args.filter(Boolean).flat();
      condition = list.length === 1 ? list[0] : and(...list);
      return builder;
    },
    orderBy(...args) {
      ordering = args.flat();
      return builder;
    },
    groupBy(column) {
      groupKey = column;
      return builder;
    },
    having() {
      return builder;
    },
    limit(value) {
      limitValue = value;
      return builder;
    },
    offset() {
      return builder;
    },
    distinct() {
      return builder;
    },
    async all() {
      const descriptor = builder.__descriptor;
      let rows = rowsOf(descriptor).filter((row) => matches(row, condition, descriptor)).map((row) => ({ ...row }));
      if (groupKey) {
        const grouped = new Map();
        for (const row of rows) {
          const key = row[groupKey.name];
          if (!grouped.has(key)) grouped.set(key, []);
          grouped.get(key).push(row);
        }
        rows = [...grouped.values()].map((bucket) => ({ ...bucket[0], __count: bucket.length }));
      }
      for (const order of [...ordering].reverse()) {
        const key = order.column?.name;
        const direction = order.op === 'desc' ? -1 : 1;
        rows.sort((a, b) => {
          if (a[key] === b[key]) return 0;
          return (a[key] > b[key] ? 1 : -1) * direction;
        });
      }
      if (limitValue) rows = rows.slice(0, limitValue);
      return rows.map((row) => project(descriptor, row, projection));
    },
    async get() {
      const rows = await builder.all();
      return rows.length ? rows[0] : null;
    },
    async values() {
      const rows = await builder.all();
      return rows.map((row) => Object.values(row));
    },
    then(resolve, reject) {
      return builder.all().then(resolve, reject);
    },
  };
  return builder;
}

function makeInsert(descriptor) {
  let values = null;
  let projection = null;
  const builder = {
    values(input) {
      values = Array.isArray(input) ? input : [input];
      return builder;
    },
    returning(proj) {
      projection = proj || {};
      return builder;
    },
    onConflictDoNothing() {
      return builder;
    },
    onConflictDoUpdate() {
      return builder;
    },
    async run() {
      const key = pkName(descriptor);
      const inserted = [];
      for (const item of values) {
        const encoded = encodeValues(descriptor, item);
        if (encoded[key] === undefined || encoded[key] === null) {
          const next = (sequences.get(descriptor.name) || 0) + 1;
          sequences.set(descriptor.name, next);
          encoded[key] = next;
        } else {
          const current = sequences.get(descriptor.name) || 0;
          sequences.set(descriptor.name, Math.max(current, Number(encoded[key])));
        }
        for (const [columnKey, column] of Object.entries(descriptor.columns)) {
          if (encoded[columnKey] === undefined || encoded[columnKey] === null) {
            const def = column.config?.default;
            if (def === undefined) continue;
            if (def && def.__sql) {
              const isMs = column.config?.mode === 'timestamp_ms';
              encoded[columnKey] = Math.floor(Date.now() / (isMs ? 1 : 1000));
            } else {
              encoded[columnKey] = encode(column, def);
            }
          }
        }
        rowsOf(descriptor).push(encoded);
        inserted.push(encoded);
      }
      if (projection !== null) {
        return inserted.map((row) => project(descriptor, row, Object.keys(projection).length ? projection : null));
      }
      return { rowsAffected: inserted.length, lastInsertRowid: inserted.at(-1)?.[key] ?? 0, rows: [] };
    },
    then(resolve, reject) {
      return builder.run().then(resolve, reject);
    },
  };
  return builder;
}

function makeUpdate(descriptor) {
  let patch = null;
  let condition = null;
  let projection = null;
  const builder = {
    set(values) {
      patch = values;
      return builder;
    },
    where(...args) {
      const list = args.filter(Boolean).flat();
      condition = list.length === 1 ? list[0] : and(...list);
      return builder;
    },
    returning(proj) {
      projection = proj || {};
      return builder;
    },
    async run() {
      const affected = [];
      for (const row of rowsOf(descriptor)) {
        if (!matches(row, condition, descriptor)) continue;
        Object.assign(row, encodeValues(descriptor, patch));
        affected.push(row);
      }
      if (projection !== null) {
        return affected.map((row) => project(descriptor, row, Object.keys(projection).length ? projection : null));
      }
      return { rowsAffected: affected.length, lastInsertRowid: 0, rows: [] };
    },
    then(resolve, reject) {
      return builder.run().then(resolve, reject);
    },
  };
  return builder;
}

function makeDelete(descriptor) {
  let condition = null;
  let projection = null;
  const builder = {
    where(...args) {
      const list = args.filter(Boolean).flat();
      condition = list.length === 1 ? list[0] : and(...list);
      return builder;
    },
    returning(proj) {
      projection = proj || {};
      return builder;
    },
    async run() {
      const rows = rowsOf(descriptor);
      const kept = [];
      const removed = [];
      for (const row of rows) {
        if (matches(row, condition, descriptor)) removed.push(row);
        else kept.push(row);
      }
      store.set(descriptor.name, kept);
      if (projection !== null) {
        return removed.map((row) => project(descriptor, row, Object.keys(projection).length ? projection : null));
      }
      return { rowsAffected: removed.length, lastInsertRowid: 0, rows: [] };
    },
    then(resolve, reject) {
      return builder.run().then(resolve, reject);
    },
  };
  return builder;
}

const db = {
  select: (projection) => makeSelect(projection),
  insert: (descriptor) => makeInsert(descriptor),
  update: (descriptor) => makeUpdate(descriptor),
  delete: (descriptor) => makeDelete(descriptor),
  async $count(descriptor, condition) {
    return rowsOf(descriptor).filter((row) => matches(row, condition, descriptor)).length;
  },
  async run(query, params) {
    if (typeof query === 'string') return { rowsAffected: 1, lastInsertRowid: 0, rows: [] };
    return { rowsAffected: 1, lastInsertRowid: 0, rows: [] };
  },
  async all() {
    return [];
  },
  async get() {
    return null;
  },
  async values() {
    return [];
  },
};

export { db };
export default db;

// -------------------------------------------------------------- Bot API mock

export const calls = [];

export class BotApiError extends Error {
  constructor(description, code = 400) {
    super(description);
    this.description = description;
    this.code = code;
  }
}

export class EndpointError extends Error {
  constructor(description, parameters = {}) {
    super(description);
    this.description = description;
    this.parameters = parameters;
  }
}

export const api = new Proxy(
  {},
  {
    get(_target, method) {
      if (method === 'then') return undefined;
      return async (params = {}) => {
        calls.push({ method, params });
        if (method === 'getMe') return { id: 1, username: 'test_bot' };
        // Аватары: у тестового «Telegram» фото нет.
        if (method === 'getUserProfilePhotos') return { total_count: 0, photos: [] };
        if (method === 'getFileContent') return new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
        return { message_id: calls.length, chat: { id: params.chat_id }, date: 0 };
      };
    },
  },
);

export function resetApi() {
  calls.length = 0;
}

export const fetch = async () => {
  throw new Error('fetch is not available in tests');
};

export class InputFile {
  constructor(bytes, name, opts) {
    Object.assign(this, { bytes, name, opts });
  }
}

export const FormData = globalThis.FormData;

export const console_ = globalThis.console;
export { db as dbRaw };
