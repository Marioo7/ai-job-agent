import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Lang } from '@ajaa/shared';
import { AR } from './ar';

interface I18n { lang: Lang; setLang: (l: Lang) => void; t: (en: string) => string; dir: 'ltr' | 'rtl' }
const Ctx = createContext<I18n>({ lang: 'en', setLang: () => undefined, t: (s) => s, dir: 'ltr' });

/** English strings are the keys; Arabic lives in ar.ts. Missing translations fall back to English. */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => (localStorage.getItem('lang') === 'ar' ? 'ar' : 'en'));
  const setLang = useCallback((l: Lang) => { localStorage.setItem('lang', l); setLangState(l); }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);
  const value = useMemo<I18n>(() => ({ lang, setLang, dir: lang === 'ar' ? 'rtl' : 'ltr', t: (s) => (lang === 'ar' ? AR[s] ?? s : s) }), [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useI18n = () => useContext(Ctx);
