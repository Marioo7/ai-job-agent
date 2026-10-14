import { useState } from 'react';
import type { AuditLog } from '@ajaa/shared';
import { Button, Card, DemoBadge, ErrorBox, Notice, Spinner, fmtDate } from '../components/ui';
import { useAsync } from '../hooks/useAsync';
import { useI18n } from '../i18n';
import { api } from '../services/api';

interface Dash {
  counts: { detected: number; matching: number; awaitingReview: number; pendingApproval: number; approved: number; sent: number; rejected: number; failed: number };
  recentActivity: AuditLog[];
  worker: { exists: boolean; online: boolean; mode?: 'real' | 'mock'; lastHeartbeatAt?: string; lastUpdateAt?: string | null; lastError?: string | null };
  demoJobs: number;
  autoApply: { enabled: boolean; minScore: number; dailyLimit: number };
  autoApplyAllowed: boolean;
}

export function Dashboard() {
  const { t, lang } = useI18n();
  const { data, error, loading, reload } = useAsync(() => api.get<Dash>('/dashboard'));
  const [msg, setMsg] = useState<string | null>(null);

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorBox message={error} onRetry={() => void reload()} />;
  if (!data) return null;
  const c = data.counts;
  const tiles: Array<[string, number]> = [
    ['Jobs detected', c.detected], ['Matching your preferences', c.matching], ['Awaiting your review', c.awaitingReview], ['Emails awaiting approval', c.pendingApproval],
    ['Approved', c.approved], ['Sent', c.sent], ['Rejected', c.rejected], ['Failed', c.failed],
  ];
  const seed = async () => {
    try { await api.post('/demo/seed'); setMsg(t('Saved.')); await reload(true); } catch (e) { setMsg(e instanceof Error ? e.message : 'Error'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{t('Dashboard')}</h1>
        <Button onClick={() => void seed()}>{t('Load demo data')}</Button>
      </div>
      {msg && <Notice tone="brand">{msg}</Notice>}
      {data.autoApply.enabled && (
        <Notice tone="warn">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span><strong>Automatic applying is ON</strong> — score ≥ {data.autoApply.minScore}, up to {data.autoApply.dailyLimit} emails/day.</span>
            <Button variant="danger" onClick={async () => { await api.post('/auto-apply/pause'); await reload(true); }}>Pause</Button>
          </div>
        </Notice>
      )}
      {data.demoJobs > 0 && <Notice tone="warn"><DemoBadge /> {data.demoJobs} demo job(s) included in these numbers.</Notice>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map(([label, n]) => (
          <div key={label} className="rounded-md border border-line bg-white p-4">
            <div className="text-3xl font-bold tabular-nums">{n}</div>
            <div className="text-sm text-mute">{t(label)}</div>
          </div>
        ))}
      </div>
      <Card title={data.worker.online ? t('Worker online') : t('Worker offline')}>
        {data.worker.exists ? (
          <p className="text-sm text-mute">
            {data.worker.mode === 'mock' && <><DemoBadge /> </>}
            {t('Last heartbeat')}: {fmtDate(data.worker.lastHeartbeatAt, lang)}
            {data.worker.lastError && <span className="block text-bad">{data.worker.lastError}</span>}
          </p>
        ) : <p className="text-sm text-mute">The worker has never reported in. See docs/WORKER.md to start it.</p>}
      </Card>
      <Card title={t('Recent activity')}>
        {data.recentActivity.length === 0 ? <p className="text-sm text-mute">{t('Nothing yet.')}</p> : (
          <ul className="divide-y divide-line text-sm">
            {data.recentActivity.map((a) => <li key={a.id} className="flex justify-between gap-2 py-1.5"><span>{a.action}</span><span className="text-mute">{fmtDate(a.createdAt, lang)}</span></li>)}
          </ul>
        )}
      </Card>
    </div>
  );
}
