import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { EmailDraft, Lang } from '@ajaa/shared';
import { Badge, Button, Card, Empty, ErrorBox, Field, Modal, Notice, Spinner, StatusBadge } from '../components/ui';
import { useAsync } from '../hooks/useAsync';
import { useI18n } from '../i18n';
import { api } from '../services/api';

type Draft = EmailDraft & { contentHash: string; job: { id: string; title: string | null; company: string | null; score: number | null } | null };

export function Approvals() {
  const { t } = useI18n();
  const list = useAsync(async () => {
    const [a, b] = await Promise.all([api.get<{ items: Draft[] }>('/drafts?status=draft'), api.get<{ items: Draft[] }>('/drafts?status=failed')]);
    return [...a.items, ...b.items];
  });
  const integ = useAsync(() => api.get<{ gmail: { mode: 'google' | 'mock'; connected: boolean } }>('/integrations'));
  const [sel, setSel] = useState<string | null>(null);
  const items = list.data ?? [];
  useEffect(() => { if (!sel && items[0]) setSel(items[0].id); if (sel && !items.find((d) => d.id === sel)) setSel(items[0]?.id ?? null); }, [items, sel]);

  if (list.loading && !list.data) return <Spinner />;
  if (list.error) return <ErrorBox message={list.error} onRetry={() => void list.reload()} />;
  const current = items.find((d) => d.id === sel);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{t('Email approvals')}</h1>
      <Notice tone="brand">{t('Nothing is sent until you confirm here.')}</Notice>
      {items.length === 0 ? <Empty title={t('No emails waiting')} hint={t('Create a draft from a job page. Drafts are never sent automatically.')} /> : (
        <div className="grid gap-4 lg:grid-cols-[18rem,1fr]">
          <ul className="space-y-2">
            {items.map((d) => (
              <li key={d.id}>
                <button onClick={() => setSel(d.id)} className={`w-full rounded-md border p-3 text-start ${d.id === sel ? 'border-brand bg-brand-soft' : 'border-line bg-white'}`}>
                  <div className="font-medium">{d.job?.title ?? d.subject}</div>
                  <div className="text-sm text-mute">{d.job?.company ?? ''}</div>
                  <div className="mt-1"><StatusBadge status={d.status} /></div>
                </button>
              </li>
            ))}
          </ul>
          {current && <Editor key={`${current.id}-${current.version}`} draft={current} mock={integ.data?.gmail.mode === 'mock'} onChanged={() => void list.reload(true)} />}
        </div>
      )}
    </div>
  );
}

function Editor({ draft, mock, onChanged }: { draft: Draft; mock: boolean; onChanged: () => void }) {
  const { t } = useI18n();
  const [to, setTo] = useState(draft.to ?? '');
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [notes, setNotes] = useState(draft.notes);
  const [reviewing, setReviewing] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const dirty = to !== (draft.to ?? '') || subject !== draft.subject || body !== draft.body || notes !== draft.notes;

  const run = async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | null> => {
    setBusy(true); setMsg(null);
    try { const r = await fn(); if (ok) setMsg({ tone: 'good', text: ok }); return r; }
    catch (e) { setMsg({ tone: 'bad', text: e instanceof Error ? e.message : 'Error' }); return null; } finally { setBusy(false); }
  };
  const save = () => run(() => api.patch<Draft>(`/drafts/${draft.id}`, { to: to.trim() || null, subject, body, notes }), t('Saved.'));

  return (
    <Card title={draft.job?.title ?? draft.subject} actions={<><Badge>{draft.generatedBy === 'ai' ? 'AI' : 'Template'}</Badge><Link className="text-sm text-brand underline" to={`/jobs/${draft.jobId}`}>{t('Jobs')}</Link></>}>
      <div className="space-y-3">
        {draft.lastError && <Notice tone="bad">{draft.status === 'failed' ? `${t('Sending failed')}: ` : ''}{draft.lastError}</Notice>}
        {draft.generatedBy === 'ai' && <Notice tone="warn">{t('Review the text for accuracy: AI drafts can be wrong.')}</Notice>}
        <Field label={t('Recipient')} hint={draft.toSource === 'source' && to === draft.to ? t('Recipient taken from the post') : to ? t('Recipient entered by you') : t('No recipient yet')}>
          <input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@company.com" />
        </Field>
        <Field label={t('Subject')}><input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
        <Field label={t('Body')}><textarea dir="auto" rows={12} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
        <Field label={t('Notes')}><input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <p className="text-sm text-mute">{t('Attachment')}: <strong>{draft.cvFileName}</strong></p>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="danger" disabled={busy} onClick={async () => { if (await run(() => api.post(`/drafts/${draft.id}/reject`))) onChanged(); }}>{t('Reject')}</Button>
          <div className="flex gap-2">
            <Button disabled={busy || !dirty} onClick={async () => { if (await save()) onChanged(); }}>{t('Save')}</Button>
            <Button variant="primary" disabled={busy} onClick={async () => { const d = dirty ? await save() : draft; if (d) setReviewing(d); }}>{t('Review and send')}</Button>
          </div>
        </div>
      </div>
      {reviewing && <ConfirmModal draft={reviewing} mock={mock} onClose={() => setReviewing(null)} onSent={() => { setReviewing(null); onChanged(); }} />}
    </Card>
  );
}

function ConfirmModal({ draft, mock, onClose, onSent }: { draft: Draft; mock: boolean; onClose: () => void; onSent: () => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = !draft.to ? t('No recipient yet') : /\[(?:your name|name|company|full name)\]/i.test(draft.body) ? 'Replace the placeholder (e.g. [Your name]) before sending.' : null;
  const send = async () => {
    setBusy(true); setError(null);
    try { await api.post(`/drafts/${draft.id}/send`, { confirmation: 'SEND', contentHash: draft.contentHash }); onSent(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Error'); setBusy(false); }
  };
  return (
    <Modal title={t('Review and send')} onClose={onClose} wide>
      <div className="space-y-3 text-sm">
        {mock && <Notice tone="warn">{t('Simulated sending: Gmail runs in mock mode, no real email will leave.')}</Notice>}
        <dl className="grid grid-cols-[6rem,1fr] gap-y-1">
          <dt className="text-mute">{t('Recipient')}</dt><dd className="break-all font-medium">{draft.to ?? '—'}</dd>
          <dt className="text-mute">{t('Subject')}</dt><dd className="font-medium">{draft.subject}</dd>
          <dt className="text-mute">{t('Attachment')}</dt><dd>{draft.cvFileName} (PDF)</dd>
        </dl>
        <pre dir="auto" className="max-h-72 overflow-auto whitespace-pre-wrap rounded border border-line bg-paper p-3 font-sans">{draft.body}</pre>
        {problem && <Notice tone="bad">{problem}</Notice>}
        {error && <Notice tone="bad">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>{t('Cancel')}</Button>
          <Button variant="primary" onClick={() => void send()} disabled={busy || !!problem}>{t('Confirm and send')}</Button>
        </div>
      </div>
    </Modal>
  );
}
export type { Lang };
