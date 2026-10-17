// tests/sdk-resolver.mjs — резолвит 'sdk' и 'sdk/db' в локальный мок.

const MAP = {
  sdk: new URL('./fake-sdk.mjs', import.meta.url).href,
  'sdk/db': new URL('./fake-sdk.mjs', import.meta.url).href,
  'sdk/api': new URL('./fake-sdk.mjs', import.meta.url).href,
};

export function resolve(specifier, context, nextResolve) {
  if (MAP[specifier]) return { url: MAP[specifier], shortCircuit: true };
  return nextResolve(specifier, context);
}
