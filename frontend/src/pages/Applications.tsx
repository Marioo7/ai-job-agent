import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Application, Page } from '@ajaa/shared';
import { Badge, Button, Empty, ErrorBox, Spinner, StatusBadge, fmtDate } from '../components/ui';
import { useI18n } from '../i18n';
import { api } from '../services/api';

export function Applications() {
  const { t, lang } = useI18n();
  const [items, setItems] = useState<Application[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (next: string | null) => {
    setLoading(true);
    try {
      const r = await api.get<Page<Application>>(`/applications?limit=25${next ? `&cursor=${encodeURIComponent(next)}` : ''}`);
      setItems((p) => (next ? [...p, ...r.items] : r.items)); setCursor(r.nextCursor); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Error'); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(null); }, [load]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{t('Application history')}</h1>
      {error && <ErrorBox message={error} onRetry={() => void load(null)} />}
      {loading && !items.length ? <Spinner /> : !items.length && !error ? <Empty title={t('No applications yet')} /> : (
        <div className="overflow-x-auto rounded-md border border-line bg-white">
          <table className="w-full text-sm">
            <thead className="bg-paper text-start"><tr>{['Subject', 'Recipient', 'Status', 'Attempts', 'Sent'].map((h) => <th key={h} className="px-3 py-2 text-start font-medium">{t(h)}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">
              {items.map((a) => (
                <tr key={a.id}>
                  <td className="px-3 py-2"><Link className="text-brand underline" to={`/jobs/${a.jobId}`}>{a.subject}</Link>{a.error && <div className="text-bad">{a.error}</div>}</td>
                  <td className="px-3 py-2 break-all">{a.to}</td>
                  <td className="px-3 py-2"><StatusBadge status={a.status} /> {a.simulated && <Badge tone="warn">{t('Simulated')}</Badge>}</td>
                  <td className="px-3 py-2">{a.attempts}</td>
                  <td className="px-3 py-2">{fmtDate(a.sentAt, lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cursor && <Button onClick={() => void load(cursor)}>{t('Load more')}</Button>}
    </div>
  );
}
