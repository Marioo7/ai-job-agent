import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { JOB_STATUSES, type Job, type Page } from '@ajaa/shared';
import { Button, DemoBadge, Empty, ErrorBox, ScoreMeter, Spinner, StatusBadge, fmtDate } from '../components/ui';
import { useI18n } from '../i18n';
import { api } from '../services/api';

export function Jobs() {
  const { t, lang } = useI18n();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [min, setMin] = useState('');
  const [items, setItems] = useState<Job[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (next: string | null) => {
    setLoading(true); setError(null);
    const p = new URLSearchParams({ limit: '25' });
    if (q) p.set('q', q);
    if (status) p.set('status', status);
    if (min) p.set('minScore', min);
    if (next) p.set('cursor', next);
    try {
      const r = await api.get<Page<Job>>(`/jobs?${p}`);
      setItems((prev) => (next ? [...prev, ...r.items] : r.items));
      setCursor(r.nextCursor);
    } catch (e) { setError(e instanceof Error ? e.message : 'Error'); } finally { setLoading(false); }
  }, [q, status, min]);

  useEffect(() => { const id = setTimeout(() => void load(null), 250); return () => clearTimeout(id); }, [load]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{t('Jobs')}</h1>
      <div className="grid gap-2 md:grid-cols-4">
        <input aria-label={t('Search')} placeholder={t('Search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label={t('Status')} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t('All statuses')}</option>
          {JOB_STATUSES.map((s) => <option key={s} value={s}>{t(s)}</option>)}
        </select>
        <input aria-label={t('Minimum score')} placeholder={t('Minimum score')} type="number" min={0} max={100} value={min} onChange={(e) => setMin(e.target.value)} />
      </div>
      {error && <ErrorBox message={error} onRetry={() => void load(null)} />}
      {loading && items.length === 0 ? <Spinner /> : items.length === 0 && !error ? (
        <Empty title={t('No jobs yet')} hint={t('Jobs appear here when the worker finds job posts in your Telegram sources.')} />
      ) : (
        <ul className="space-y-2">
          {items.map((j) => (
            <li key={j.id}>
              <Link to={`/jobs/${j.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-white p-3 hover:border-brand">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{j.extracted.title ?? t('Unknown')}</span>
                    {j.isDemo && <DemoBadge />}
                  </div>
                  <div className="text-sm text-mute">{j.extracted.company ?? t('Unknown')} · {j.sourceName} · {fmtDate(j.messageDate, lang)}</div>
                </div>
                <div className="flex items-center gap-3"><ScoreMeter score={j.match?.score ?? null} /><StatusBadge status={j.status} /></div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {cursor && <Button disabled={loading} onClick={() => void load(cursor)}>{t('Load more')}</Button>}
    </div>
  );
}
