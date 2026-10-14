import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { AuditLog, EmailDraft, Extracted, Job } from '@ajaa/shared';
import { Badge, Button, Card, DemoBadge, ErrorBox, Field, Modal, Notice, ScoreMeter, Spinner, StatusBadge, csv, fmtDate, segmentColor } from '../components/ui';
import { useAsync } from '../hooks/useAsync';
import { useI18n } from '../i18n';
import { api } from '../services/api';

interface Detail { job: Job; draft: (EmailDraft & { contentHash: string }) | null; history: AuditLog[] }

export function JobDetail() {
  const { id = '' } = useParams();
  const { t, lang } = useI18n();
  const { data, error, loading, reload } = useAsync(() => api.get<Detail>(`/jobs/${id}`), [id]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [editing, setEditing] = useState(false);

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorBox message={error} onRetry={() => void reload()} />;
  if (!data) return null;
  const { job, draft, history } = data;
  const x = job.extracted;
  const locked = job.status === 'sent';

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ tone: 'good', text: t('Saved.') }); await reload(true); }
    catch (e) { setMsg({ tone: 'bad', text: e instanceof Error ? e.message : 'Error' }); } finally { setBusy(false); }
  };
  const patch = (body: unknown) => act(() => api.patch(`/jobs/${job.id}`, body));
  const U = (v: unknown) => (v === null || v === undefined || v === '' ? t('Unknown') : String(v));

  const facts: Array<[string, string]> = [
    ['Title', U(x.title)], ['Company', U(x.company)], ['Location', U(x.location)], ['Work mode', x.workMode ? t(x.workMode) : t('Unknown')],
    ['Years of experience', U(x.experienceYears)], ['Seniority', x.seniority ? t(x.seniority) : t('Unknown')], ['Salary', U(x.salary)], ['Deadline', U(x.deadline)],
    ['Application email', U(x.applicationEmail)], ['Application link', U(x.applicationLink)],
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold">{x.title ?? t('Unknown')} {job.isDemo && <DemoBadge />}</h1>
          <p className="text-sm text-mute">{job.sourceName} · {fmtDate(job.messageDate, lang)}</p>
        </div>
        <div className="flex items-center gap-3"><ScoreMeter score={job.match?.score ?? null} /><StatusBadge status={job.status} /></div>
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || locked} onClick={() => void patch({ userRelevance: 'relevant' })}>{t('Mark relevant')}</Button>
        <Button disabled={busy || locked} onClick={() => void patch({ userRelevance: 'irrelevant' })}>{t('Mark irrelevant')}</Button>
        <Button disabled={busy || locked} onClick={() => void patch({ status: 'saved' })}>{t('Save for later')}</Button>
        <Button variant="danger" disabled={busy || locked} onClick={() => void patch({ status: 'rejected' })}>{t('Reject')}</Button>
        <Button disabled={busy || locked} onClick={() => void act(() => api.post(`/jobs/${job.id}/reanalyze`))}>{t('Re-analyze')}</Button>
        <Button disabled={busy || locked} onClick={() => setEditing(true)}>{t('Edit details')}</Button>
        {job.sourceLink && <a className="rounded border border-line bg-white px-3 py-1.5 text-sm hover:bg-paper" href={job.sourceLink} target="_blank" rel="noreferrer noopener">{t('Open source post')}</a>}
        <Button variant="primary" disabled={busy || locked} onClick={() => void act(() => api.post(`/jobs/${job.id}/draft`, {}))}>{draft ? t('Regenerate draft') : t('Create email draft')}</Button>
      </div>
      {job.userRelevance && <p className="text-sm text-mute">{t(job.userRelevance === 'relevant' ? 'Mark relevant' : 'Mark irrelevant')}</p>}

      {draft && (
        <Notice tone="brand">
          <StatusBadge status={draft.status} /> {draft.subject} — <Link className="underline" to="/approvals">{t('Open in approvals')}</Link>
        </Notice>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('Extracted from the post')}>
          <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
            {facts.map(([k, v]) => <div key={k} className="contents"><dt className="text-mute">{t(k)}</dt><dd className="break-words">{v}</dd></div>)}
          </dl>
          <div className="mt-3 flex flex-wrap gap-1">{x.technologies.map((s) => <Badge key={s} tone="brand">{s}</Badge>)}</div>
          {x.emailCandidates.length > 1 && !x.applicationEmail && <Notice tone="warn">Several emails found ({x.emailCandidates.join(', ')}); none was chosen automatically. Pick one in “{t('Edit details')}”.</Notice>}
          <p className="mt-2 text-xs text-mute">{job.extractionMethod === 'heuristic' ? 'Rule-based extraction.' : 'Rule-based extraction + AI (AI facts are accepted only if they appear in the post).'}</p>
        </Card>

        <Card title={`${t('Score')}: ${job.match?.score ?? '—'}`}>
          {!job.match ? <p className="text-sm text-mute">Upload and activate a CV to see a match score.</p> : (
            <div className="space-y-3">
              <div className="flex h-3 overflow-hidden rounded-full bg-line" role="img" aria-label={t('Match breakdown')}>
                {job.match.breakdown.map((c, i) => <div key={c.key} title={`${c.key}: ${c.points}`} style={{ width: `${c.points}%`, background: segmentColor(i) }} />)}
              </div>
              <ul className="space-y-1 text-sm">
                {job.match.breakdown.map((c, i) => (
                  <li key={c.key} className="flex gap-2">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: segmentColor(i) }} />
                    <span><strong className="capitalize">{c.key}</strong> · {c.points}/{Math.round(c.weight)} — {c.detail}{!c.known && <Badge>{t('Unknown')}</Badge>}</span>
                  </li>
                ))}
              </ul>
              {job.match.filterReasons.length > 0 && <Notice tone="warn">{job.match.filterReasons.join(' · ')}</Notice>}
            </div>
          )}
        </Card>

        {job.match && (
          <Card title={t('Matching skills')}>
            <div className="flex flex-wrap gap-1">{job.match.matchedSkills.length ? job.match.matchedSkills.map((s) => <Badge key={s} tone="good">{s}</Badge>) : <span className="text-sm text-mute">—</span>}</div>
            <h3 className="mb-1 mt-3 text-sm font-semibold">{t('Missing requirements')}</h3>
            <div className="flex flex-wrap gap-1">{job.match.missingSkills.length ? job.match.missingSkills.map((s) => <Badge key={s} tone="bad">{s}</Badge>) : <span className="text-sm text-mute">—</span>}</div>
            {job.match.concerns.length > 0 && (<><h3 className="mb-1 mt-3 text-sm font-semibold">{t('Concerns')}</h3><ul className="list-disc ps-5 text-sm">{job.match.concerns.map((c) => <li key={c}>{c}</li>)}</ul></>)}
          </Card>
        )}

        <Card title={t('AI-generated inference')}>
          {job.aiAnalysis ? <p className="whitespace-pre-wrap text-sm">{job.aiAnalysis}</p> : <p className="text-sm text-mute">{job.aiError ? `AI unavailable (${job.aiError}).` : 'No AI analysis for this job.'}</p>}
        </Card>
      </div>

      <Card title={t('Original message')}><p dir="auto" className="whitespace-pre-wrap break-words text-sm">{job.originalText}</p></Card>
      <Card title={t('History')}>
        <ul className="divide-y divide-line text-sm">{history.length ? history.map((h) => <li key={h.id} className="flex justify-between py-1.5"><span>{h.action}</span><span className="text-mute">{fmtDate(h.createdAt, lang)}</span></li>) : <li className="text-mute">{t('Nothing yet.')}</li>}</ul>
      </Card>

      {editing && <EditModal x={x} onClose={() => setEditing(false)} onSave={async (e) => { setEditing(false); await patch({ extracted: e }); }} />}
    </div>
  );
}

function EditModal({ x, onClose, onSave }: { x: Extracted; onClose: () => void; onSave: (e: Partial<Extracted>) => Promise<void> }) {
  const { t } = useI18n();
  const [f, setF] = useState({ title: x.title ?? '', company: x.company ?? '', location: x.location ?? '', workMode: x.workMode ?? '', technologies: x.technologies.join(', '), experienceYears: x.experienceYears?.toString() ?? '', applicationEmail: x.applicationEmail ?? '', applicationLink: x.applicationLink ?? '', salary: x.salary ?? '', deadline: x.deadline ?? '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const n = (s: string) => (s.trim() === '' ? null : s.trim());
  return (
    <Modal title={t('Edit details')} onClose={onClose} wide>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label={t('Title')}><input value={f.title} onChange={set('title')} /></Field>
        <Field label={t('Company')}><input value={f.company} onChange={set('company')} /></Field>
        <Field label={t('Location')}><input value={f.location} onChange={set('location')} /></Field>
        <Field label={t('Work mode')}><select value={f.workMode} onChange={set('workMode')}><option value="">{t('Unknown')}</option><option value="remote">{t('remote')}</option><option value="onsite">{t('onsite')}</option><option value="hybrid">{t('hybrid')}</option></select></Field>
        <Field label={t('Technologies')} hint={t('Comma separated')}><input value={f.technologies} onChange={set('technologies')} /></Field>
        <Field label={t('Years of experience')}><input type="number" min={0} max={40} value={f.experienceYears} onChange={set('experienceYears')} /></Field>
        <Field label={t('Application email')}><input type="email" value={f.applicationEmail} onChange={set('applicationEmail')} /></Field>
        <Field label={t('Application link')}><input type="url" value={f.applicationLink} onChange={set('applicationLink')} /></Field>
        <Field label={t('Salary')}><input value={f.salary} onChange={set('salary')} /></Field>
        <Field label={t('Deadline')}><input value={f.deadline} onChange={set('deadline')} /></Field>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>{t('Cancel')}</Button>
        <Button variant="primary" onClick={() => void onSave({
          title: n(f.title), company: n(f.company), location: n(f.location), workMode: (f.workMode || null) as Extracted['workMode'], technologies: csv(f.technologies),
          experienceYears: f.experienceYears === '' ? null : Number(f.experienceYears), applicationEmail: n(f.applicationEmail), applicationLink: n(f.applicationLink), salary: n(f.salary), deadline: n(f.deadline),
        })}>{t('Save')}</Button>
      </div>
    </Modal>
  );
}
