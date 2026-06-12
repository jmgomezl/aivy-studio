import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import es from './es.json';
import en from './en.json';

i18n.use(initReactI18next).init({
  resources: { es: { translation: es }, en: { translation: en } },
  lng: localStorage.getItem('lang') || 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export function toggleLang() {
  const next = i18n.language === 'es' ? 'en' : 'es';
  i18n.changeLanguage(next);
  localStorage.setItem('lang', next);
}

export default i18n;
