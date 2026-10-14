import { useEffect, useState } from 'react';
import type { TelegramSource, WorkerStatus } from '@ajaa/shared';
import { Badge, Button, Card, DemoBadge, Empty, ErrorBox, Field, Notice, Spinner, fmtDate } from '../components/ui';
import { useAsync } from '../hooks/useAsync';
import { useI18n } from '../i18n';
import { api } from '../services/api';

type Worker = (WorkerStatus & { online: boolean; exists: true }) | { exists: false; online: false };

export function Sources() {
  const { t, lang } = useI18n();
  const src = useAsync(() => api.get<TelegramSource[]>('/sources'));
  const worker = useAsync(() => api.get<Worker>('/worker/status'));
  const [ref, setRef] = useState('');
  const [title, setTitle] = useState('');
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  useEffect(() => { const id = setInterval(() => { void src.reload(true); void worker.reload(true); }, 15_000); return () => clearInterval(id); }, [src, worker]);

  const run = async (fn: () => Promise<unknown>) => {
    setMsg(null);
    try { await fn(); await src.reload(true); } catch (e) { setMsg({ tone: 'bad', text: e instanceof Error ? e.message : 'Error' }); }
  };
  const test = async () => {
    setMsg(null);
    try {
      const r = await api.post<{ requestedAt: string }>('/worker/test');
      setTesting(r.requestedAt);
      for (let i = 0; i < 12; i++) {
        await new Promise((res) => setTimeout(res, 3000));
        const w = await api.get<Worker>('/worker/status');
        worker.setData(w);
        if (w.exists && w.testResult && w.testResult.at >= r.requestedAt) { setMsg({ tone: w.testResult.ok ? 'good' : 'bad', text: w.testResult.detail }); setTesting(null); return; }
      }
      setMsg({ tone: 'bad', text: 'No answer from the worker within 36 seconds. It may be offline.' });
    } catch (e) { setMsg({ tone: 'bad', text: e instanceof Error ? e.message : 'Error' }); }
    setTesting(null);
  };

  if (src.loading && !src.data) return <Spinner />;
  if (src.error && !src.data) return <ErrorBox message={src.error} onRetry={() => void src.reload()} />;
  const w = worker.data;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{t('Telegram sources')}</h1>
      <Card title={w?.online ? t('Worker online') : t('Worker offline')} actions={<Button disabled={!!testing} onClick={() => void test()}>{testing ? `${t('Loading')}…` : t('Test connection')}</Button>}>
        {w?.exists ? (
          <div className="space-y-1 text-sm">
            <p>{w.mode === 'mock' ? <><DemoBadge /> Mock mode: only demo posts are produced, no real Telegram account is monitored.</> : w.telegramConnected ? <Badge tone="good">{t('Connected')}</Badge> : <Badge tone="bad">{t('Not connected')}</Badge>}</p>
            <p className="text-mute">{t('Last heartbeat')}: {fmtDate(w.lastHeartbeatAt, lang)} · {t('Last sync')}: {fmtDate(w.lastUpdateAt, lang)}</p>
            {w.lastError && <Notice tone="bad">{w.lastError}</Notice>}
          </div>
        ) : <p className="text-sm text-mute">The worker has never reported in. Follow docs/TELEGRAM.md and docs/WORKER.md.</p>}
      </Card>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <Card title={t('Add source')}>
        <form className="grid gap-3 md:grid-cols-[1fr,1fr,auto] md:items-end" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api.post('/sources', { ref, title: title || undefined }); setRef(''); setTitle(''); }); }}>
          <Field label={t('Channel or group')} hint={t('@username, numeric ID or exact title')}><input required value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
          <Field label={t('Title')}><input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Button variant="primary" type="submit">{t('Add source')}</Button>
        </form>
        <p className="mt-2 text-xs text-mute">Only channels and groups your own account can already read can be monitored. The worker never joins or posts anything.</p>
      </Card>

      {!src.data?.length ? <Empty title={t('No sources yet')} /> : (
        <ul className="space-y-2">
          {src.data.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-white p-3">
              <div className="min-w-0">
                <div className="font-medium">{s.title} <span className="text-sm text-mute">({s.ref})</span></div>
                <div className="text-xs text-mute">{s.resolvedId ? `ID ${s.resolvedId}` : 'Not resolved yet'} · {t('Last sync')}: {fmtDate(s.lastSyncAt, lang)}</div>
                {s.lastError && <div className="text-xs text-bad">{s.lastError}</div>}
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={s.enabled} onChange={(e) => void run(() => api.put(`/sources/${s.id}`, { enabled: e.target.checked }))} /> {t('Enabled')}</label>
                <Button variant="danger" onClick={() => void run(() => api.del(`/sources/${s.id}`))}>{t('Remove')}</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
