// tests/register-sdk.mjs — подменяет модуль 'sdk' на локальный мок,
// чтобы прогонять логику бота и эндпоинтов в обычном Node.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./sdk-resolver.mjs', pathToFileURL(import.meta.filename));
