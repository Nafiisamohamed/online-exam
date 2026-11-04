'use client';
/**
 * Language switch (Somali / English).
 * useI18n() gives t(key, params), the current lang, setLang, errorMessage(err)
 * and date formatting in Mogadishu time. The choice is remembered in localStorage.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { en, so, errorText, questionErrorText, type DictKey } from './dictionary';
import { ApiError } from './api';

export type Lang = 'so' | 'en';
const LANG_KEY = 'imtixaan.lang';

interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: DictKey, params?: Record<string, string | number>) => string;
  errorMessage: (err: unknown) => string;
  questionError: (code: string) => string;
  fmtDate: (d: string | Date | null | undefined, withTime?: boolean) => string;
  fmtTime: (d: string | Date | null | undefined) => string;
}

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('so');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (saved === 'en' || saved === 'so') setLangState(saved);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<I18n>(() => {
    const dict = lang === 'so' ? so : en;
    const t = (key: DictKey, params?: Record<string, string | number>) => {
      let s: string = dict[key] ?? en[key] ?? key;
      if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
      return s;
    };
    const locale = lang === 'so' ? 'so-SO' : 'en-GB';
    const fmt = (d: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions) => {
      if (!d) return '-';
      try {
        return new Intl.DateTimeFormat(locale, { timeZone: 'Africa/Mogadishu', ...opts }).format(new Date(d));
      } catch {
        return new Date(d).toLocaleString();
      }
    };
    return {
      lang,
      setLang,
      t,
      errorMessage: (err: unknown) => {
        if (err instanceof ApiError) return errorText[err.code]?.[lang] ?? err.message;
        return t('somethingWrong');
      },
      questionError: (code: string) => questionErrorText[code]?.[lang] ?? code,
      fmtDate: (d, withTime = true) => fmt(d, withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }),
      fmtTime: (d) => fmt(d, { timeStyle: 'short' }),
    };
  }, [lang, setLang]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}
