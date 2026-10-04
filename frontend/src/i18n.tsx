import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import en from './locales/en.json';
import zh from './locales/zh.json';

export type Lang = 'zh' | 'en';

const DICTS: Record<Lang, Record<string, string>> = { zh, en };

// Pure functions live outside the component so tests can call them directly.
export function translate(lang: Lang, key: string, params?: Record<string, string | number>): string {
  let text = DICTS[lang][key] ?? key;
  for (const [name, value] of Object.entries(params ?? {})) {
    text = text.replaceAll(`{{${name}}}`, String(value));
  }
  return text;
}

export function pickLabel(item: { zh: string; en: string }, lang: Lang): string {
  return item[lang] || item.zh;
}

// Persisted language preference: check localStorage first, then fallback to navigator language.
export function initialLang(): Lang {
  const saved = localStorage.getItem('lang');
  if (saved === 'zh' || saved === 'en') return saved;
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

interface I18nValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  label: (item: { zh: string; en: string }) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-Hant' : 'en';
    localStorage.setItem('lang', lang);
  }, [lang]);

  const value: I18nValue = {
    lang,
    setLang,
    t: (key, params) => translate(lang, key, params),
    label: (item) => pickLabel(item, lang),
  };
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}
