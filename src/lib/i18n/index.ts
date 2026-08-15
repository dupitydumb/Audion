import { init, register, getLocaleFromNavigator } from 'svelte-i18n';

// Register translations
// To add a new language, simply create a new JSON file in the locales directory
// and add a new register call here.
register('en', () => import('./locales/en.json'));
register('es', () => import('./locales/es.json'));
register('fr', () => import('./locales/fr.json'));
register('ru', () => import('./locales/ru.json'));

let i18nInitialized = false;

export function setupI18n(savedLocale?: string) {
    if (i18nInitialized) return;

    const initialLocale = savedLocale || getLocaleFromNavigator();

    init({
        fallbackLocale: 'en',
        initialLocale,
        handleMissingMessage: import.meta.env.DEV
            ? ({ locale, id }) => {
                  console.warn(
                      `[i18n] Missing message "${id}" for locale "${locale}"`,
                  );
                  return id;
              }
            : undefined,
    });

    i18nInitialized = true;
}
