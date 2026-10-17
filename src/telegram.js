// src/telegram.js — обёртка над Telegram WebApp SDK.
//
// Эндпоинты вызываются только через Telegram.WebApp.Serverless.call — он сам
// подписывает initData. Вне Telegram (обычный браузер) показываем понятную
// ошибку, а не пустой экран.

export const tg = window.Telegram?.WebApp || null;

export function hasTelegram() {
  return Boolean(tg && tg.initData);
}

export function initTelegram() {
  if (!tg) return;
  try {
    tg.ready();
    tg.expand();
    if (typeof tg.disableVerticalSwipes === 'function') tg.disableVerticalSwipes();
  } catch (error) {
    console.warn('Telegram init failed', error);
  }
}

/*
   Тему оформления Mini App задаёт бренд (light/dark/system), а не тема Telegram,
   поэтому themeParams в CSS-переменные не транслируются: Telegram лишь намекает
   на своё оформление, а наш выбор должен побеждать. Цвет шапки подгоняем сами
   (см. setHeaderTheme).
*/

export function user() {
  return tg?.initDataUnsafe?.user || null;
}

export function startParam() {
  return tg?.initDataUnsafe?.start_param || null;
}

/** Минуты к востоку от UTC для дат в часовом поясе пользователя. */
export function tzOffsetMinutes() {
  return -new Date().getTimezoneOffset();
}

export function haptic(type = 'light') {
  try {
    if (type === 'error' || type === 'success' || type === 'warning') {
      tg?.HapticFeedback?.notificationOccurred(type);
    } else {
      tg?.HapticFeedback?.impactOccurred(type);
    }
  } catch {
    /* не критично */
  }
}

export function closeApp() {
  try {
    tg?.close();
  } catch {
    /* не критично */
  }
}

/** Модальное подтверждение: нативный диалог Telegram, иначе window.confirm. */
export function confirmAction(message) {
  return new Promise((resolve) => {
    if (tg?.showConfirm) {
      tg.showConfirm(message, (ok) => resolve(Boolean(ok)));
      return;
    }
    resolve(window.confirm(message));
  });
}

/** Подгоняет цвет шапки Telegram под нашу тему. */
export function setHeaderTheme(dark) {
  try {
    tg?.setHeaderColor?.(dark ? '#0B1B2B' : '#F2F7FB');
    tg?.setBackgroundColor?.(dark ? '#0B1B2B' : '#F2F7FB');
  } catch {
    /* не критично */
  }
}

export function alertAction(message) {
  if (tg?.showAlert) {
    tg.showAlert(message);
    return;
  }
  window.alert(message);
}

/** Вызов эндпоинта платформы: POST /api/<name>. */
export function call(name, payload = {}) {
  return new Promise((resolve, reject) => {
    const serverless = tg?.Serverless;
    if (!serverless) {
      reject(new Error('Откройте журнал из Telegram — Mini App недоступен в браузере.'));
      return;
    }
    const done = (err, result) => {
      if (err) {
        const error = new Error(err.message || 'Не удалось выполнить запрос');
        error.type = err.type;
        error.parameters = err.parameters;
        reject(error);
        return;
      }
      resolve(result);
    };
    try {
      if (typeof serverless.callAsync === 'function') {
        serverless.callAsync(name, payload).then((result) => done(null, result), done);
      } else {
        serverless.call(name, payload, done);
      }
    } catch (error) {
      reject(error);
    }
  });
}
