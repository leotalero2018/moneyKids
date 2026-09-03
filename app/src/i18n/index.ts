import i18next, { type i18n } from 'i18next';
import { initReactI18next } from 'react-i18next';
import es from './es.json';
import en from './en.json';

export type Language = 'es' | 'en';

export async function initI18n(language: Language): Promise<i18n> {
  if (!i18next.isInitialized) {
    await i18next.use(initReactI18next).init({
      resources: { es: { translation: es }, en: { translation: en } },
      lng: language,
      fallbackLng: 'es',
      interpolation: { escapeValue: false },
      // a missing key must be loud in development, never silently blank
      returnEmptyString: false,
    });
  } else if (i18next.language !== language) {
    await i18next.changeLanguage(language);
  }
  return i18next;
}
