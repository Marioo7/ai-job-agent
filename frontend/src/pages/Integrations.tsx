import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { AuditLog, Page } from '@ajaa/shared';
import { Badge, Button, Card, ErrorBox, Notice, Spinner, fmtDate } from '../components/ui';
import { useAsync } from '../hooks/useAsync';
import { useI18n } from '../i18n';
import { api } from '../services/api';

interface Integ {
  uid: string;
  gmail: { connected: boolean; email: string | null; mode: 'google' | 'mock'; connectedAt: string | null };
  ai: { provider: string; enabled: boolean; mock: boolean; externalProcessing: boolean; model: string | null; maxInputChars: number; dailyCap: number };
  telegram: { mode: 'real' | 'mock'; connected: boolean; workerOnline: boolean };
  storage: string; database: string; authMode: string;
}

export function Integrations() {
  const { t, lang } = useI18n();
  const [params] = useSearchParams();
  const d = useAsync(() => api.get<Integ>('/integrations'));
  const audit = useAsync(() => api.get<Page<AuditLog>>('/audit?limit=20'));
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(
    params.get('gmail') === 'connected' ? { tone: 'good', text: 'Gmail connected.' } : params.get('gmail') === 'error' ? { tone: 'bad', text: 'Gmail connection failed. Check docs/GMAIL.md.' } : null,
  );

  if (d.loading && !d.data) return <Spinner />;
  if (d.error && !d.data) return <ErrorBox message={d.error} onRetry={() => void d.reload()} />;
  if (!d.data) return null;
  const x = d.data;
  const run = async (fn: () => Promise<void>) => { try { await fn(); await d.reload(true); } catch (e) { setMsg({ tone: 'bad', text: e instanceof Error ? e.message : 'Error' }); } };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{t('Integrations & health')}</h1>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <Card title="Gmail" actions={x.gmail.mode === 'google' && (x.gmail.connected ? (
        <>
          <Button onClick={() => void run(async () => { const r = await api.post<{ ok: boolean; detail: string }>('/integrations/gmail/test'); setMsg({ tone: r.ok ? 'good' : 'bad', text: r.detail }); })}>{t('Test connection')}</Button>
          <Button variant="danger" onClick={() => void run(async () => { await api.post('/integrations/gmail/disconnect'); })}>{t('Disconnect')}</Button>
        </>
      ) : <Button variant="primary" onClick={() => void run(async () => { const r = await api.post<{ url: string }>('/integrations/gmail/auth-url'); window.location.href = r.url; })}>{t('Connect Gmail')}</Button>)}>
        {x.gmail.mode === 'mock' ? <Notice tone="warn"><Badge tone="warn">{t('DEMO')}</Badge> Gmail runs in mock mode (GMAIL_MODE=mock): sends are simulated and nothing leaves your machine. See docs/GMAIL.md to connect a real account.</Notice> : (
          <p className="text-sm">{x.gmail.connected ? <Badge tone="good">{t('Connected')}</Badge> : <Badge tone="bad">{t('Not connected')}</Badge>} {x.gmail.email} {x.gmail.connectedAt && <span className="text-mute">· {fmtDate(x.gmail.connectedAt, lang)}</span>}
            <span className="mt-1 block text-mute">Permission requested: send email only. To revoke: Disconnect here, or myaccount.google.com/permissions.</span></p>
        )}
      </Card>

      <Card title="AI">
        <p className="text-sm">{x.ai.provider} {x.ai.model && `(${x.ai.model})`} · max {x.ai.maxInputChars} chars/call · {x.ai.dailyCap} calls/day</p>
        <div className="mt-2">{!x.ai.enabled ? <Notice tone="brand">{t('AI is disabled.')}</Notice> : x.ai.externalProcessing ? <Notice tone="warn">{t('External AI processing is on: job posts and CV text are sent to the provider.')}</Notice> : <Notice tone="brand">{t('AI runs offline (mock). Nothing leaves your machine.')}</Notice>}</div>
      </Card>

      <Card title="Telegram">
        <p className="text-sm">{x.telegram.mode === 'mock' && <Badge tone="warn">{t('DEMO')}</Badge>} {x.telegram.workerOnline ? t('Worker online') : t('Worker offline')} · {x.telegram.connected ? t('Connected') : t('Not connected')}</p>
      </Card>

      <Card title="System">
        <dl className="grid grid-cols-[10rem,1fr] gap-y-1 text-sm">
          <dt className="text-mute">{t('Your user ID')}</dt><dd className="break-all font-mono">{x.uid}</dd>
          <dt className="text-mute">Auth</dt><dd>{x.authMode}</dd><dt className="text-mute">Database</dt><dd>{x.database}</dd><dt className="text-mute">CV storage</dt><dd>{x.storage}</dd>
        </dl>
        <p className="mt-2 text-xs text-mute">Put your user ID in OWNER_UID for the worker.</p>
      </Card>

      <Card title={t('Audit log')}>
        <ul className="divide-y divide-line text-sm">{audit.data?.items.map((a) => <li key={a.id} className="flex justify-between py-1.5"><span>{a.action}</span><span className="text-mute">{fmtDate(a.createdAt, lang)}</span></li>)}</ul>
      </Card>
    </div>
  );
}
