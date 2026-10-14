import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useI18n } from '../i18n';
import { api } from '../services/api';
import { DEMO } from '../services/firebase';
import { Notice } from '../components/ui';
import { useAuth } from './auth';

const NAV: Array<[string, string]> = [
  ['/', 'Dashboard'], ['/jobs', 'Jobs'], ['/approvals', 'Email approvals'], ['/applications', 'Applications'],
  ['/sources', 'Telegram sources'], ['/cv', 'CV'], ['/preferences', 'Preferences'], ['/integrations', 'Integrations & health'],
];

export function Layout() {
  const { t, lang, setLang } = useI18n();
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let alive = true;
    const check = () => api.get<{ online: boolean }>('/worker/status').then((w) => alive && setOffline(!w.online)).catch(() => undefined);
    void check();
    const id = setInterval(check, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const nav = (
    <nav aria-label="Main" className="flex flex-col gap-0.5 p-3">
      {NAV.map(([to, label]) => (
        <NavLink key={to} to={to} end={to === '/'} onClick={() => setOpen(false)}
          className={({ isActive }) => `rounded px-3 py-2 text-sm ${isActive ? 'bg-white/15 font-semibold text-white' : 'text-white/75 hover:bg-white/10'}`}>
          {t(label)}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-full">
      <aside className="hidden w-60 shrink-0 bg-ink md:block">
        <div className="px-6 py-5 text-lg font-bold text-white">Job Agent</div>
        {nav}
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setOpen(false)}>
          <aside className="h-full w-64 bg-ink" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-5 text-lg font-bold text-white">Job Agent</div>
            {nav}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-2 border-b border-line bg-white px-4 py-2">
          <button className="rounded border border-line px-2 py-1 text-sm md:hidden" aria-label="Menu" onClick={() => setOpen(true)}>☰</button>
          <div className="ms-auto flex items-center gap-2">
            <button className="rounded border border-line px-2 py-1 text-sm" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')} aria-label="Language">{lang === 'ar' ? 'English' : 'العربية'}</button>
            {!DEMO && <button className="rounded border border-line px-2 py-1 text-sm" onClick={() => void logout()}>{t('Sign out')}</button>}
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 space-y-4 p-4 md:p-6">
          {DEMO && <Notice tone="warn">{t('Demo mode: data shown here is sample data and nothing is sent.')}</Notice>}
          {offline && <Notice tone="bad"><strong>{t('Monitoring is not active')}.</strong> {t('The Telegram worker is offline. New posts are not being collected.')}</Notice>}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
