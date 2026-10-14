import { useRef, useState } from 'react';
import type { CvProfile } from '@ajaa/shared';
import { Badge, Button, Card, Empty, ErrorBox, Field, Notice, Spinner, csv, fmtDate } from '../components/ui';
import { useAsync } from '../hooks/useAsync';
import { useI18n } from '../i18n';
import { api } from '../services/api';

type Item = Omit<CvProfile, 'extractedText'> & { textLength: number };

export function Cv() {
  const { t, lang } = useI18n();
  const list = useAsync(() => api.get<Item[]>('/cv'));
  const [sel, setSel] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setMsg(null);
    try { await fn(); if (ok) setMsg({ tone: 'good', text: ok }); await list.reload(true); } catch (e) { setMsg({ tone: 'bad', text: e instanceof Error ? e.message : 'Error' }); }
  };
  const upload = (f: File) => run(async () => {
    const form = new FormData(); form.append('file', f);
    const cv = await api.upload<CvProfile>('/cv', form);
    setSel(cv.id);
  }, t('Saved.'));
  const download = async (c: Item) => {
    try {
      const url = URL.createObjectURL(await api.blob(`/cv/${c.id}/download`));
      const a = document.createElement('a'); a.href = url; a.download = c.fileName; a.click(); URL.revokeObjectURL(url);
    } catch (e) { setMsg({ tone: 'bad', text: e instanceof Error ? e.message : 'Error' }); }
  };

  if (list.loading && !list.data) return <Spinner />;
  if (list.error && !list.data) return <ErrorBox message={list.error} onRetry={() => void list.reload()} />;
  const items = list.data ?? [];
  const chosen = items.find((c) => c.id === (sel ?? items.find((x) => x.active)?.id ?? items[0]?.id));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{t('CV')}</h1>
        <div className="flex gap-2">
          <Button onClick={() => void run(() => api.post('/jobs/rescore'), t('Saved.'))}>{t('Rescore all jobs')}</Button>
          <input ref={file} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
          <Button variant="primary" onClick={() => file.current?.click()}>{t('Upload a PDF CV')}</Button>
        </div>
      </div>
      <Notice tone="brand">PDF only, max 5 MB, text-based (not a scan). The file is stored privately and only sent as the email attachment you approve.</Notice>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {!items.length ? <Empty title={t('Upload a PDF CV')} hint="Your CV is used to score jobs and to write drafts." /> : (
        <div className="grid gap-4 lg:grid-cols-[18rem,1fr]">
          <ul className="space-y-2">
            {items.map((c) => (
              <li key={c.id} className={`rounded-md border p-3 ${c.id === chosen?.id ? 'border-brand bg-brand-soft' : 'border-line bg-white'}`}>
                <button className="w-full text-start" onClick={() => setSel(c.id)}>
                  <div className="font-medium">{t('Version')} {c.version} {c.active && <Badge tone="good">{t('Active')}</Badge>}</div>
                  <div className="break-all text-sm text-mute">{c.fileName} · {fmtDate(c.createdAt, lang)}</div>
                </button>
                <div className="mt-2 flex gap-2">
                  {!c.active && <Button onClick={() => void run(() => api.post(`/cv/${c.id}/activate`))}>{t('Make active')}</Button>}
                  <Button onClick={() => void download(c)}>{t('Download')}</Button>
                </div>
              </li>
            ))}
          </ul>
          {chosen && <CvEditor key={chosen.id + chosen.updatedAt} id={chosen.id} onSaved={() => void list.reload(true)} />}
        </div>
      )}
    </div>
  );
}

function CvEditor({ id, onSaved }: { id: string; onSaved: () => void }) {
  const { t } = useI18n();
  const { data, error, loading } = useAsync(() => api.get<CvProfile>(`/cv/${id}`), [id]);
  const [f, setF] = useState<null | { fullName: string; skills: string; years: string; education: string; locations: string; summary: string; text: string }>(null);
  const [msg, setMsg] = useState<string | null>(null);
  if (loading) return <Spinner />;
  if (error || !data) return <ErrorBox message={error ?? 'Not found'} />;
  const v = f ?? { fullName: data.fullName, skills: data.skills.join(', '), years: data.yearsExperience?.toString() ?? '', education: data.education.join('\n'), locations: data.locations.join(', '), summary: data.summary, text: data.extractedText };
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setF({ ...v, [k]: e.target.value });
  const save = async () => {
    try {
      const skills = csv(v.skills);
      await api.put(`/cv/${id}`, { fullName: v.fullName, skills, technologies: skills, yearsExperience: v.years === '' ? null : Number(v.years), education: v.education.split('\n').map((s) => s.trim()).filter(Boolean), locations: csv(v.locations), summary: v.summary, extractedText: v.text });
      setMsg(t('Saved.')); onSaved();
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Error'); }
  };
  return (
    <Card title={`${t('Version')} ${data.version}`}>
      <Notice tone="warn">{t('Heuristic extraction: please review and correct.')}</Notice>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Field label={t('Full name')}><input value={v.fullName} onChange={set('fullName')} /></Field>
        <Field label={t('Years of experience')}><input type="number" min={0} max={60} value={v.years} onChange={set('years')} /></Field>
        <Field label={t('Skills')} hint={t('Comma separated')}><input value={v.skills} onChange={set('skills')} /></Field>
        <Field label={t('Locations')} hint={t('Comma separated')}><input value={v.locations} onChange={set('locations')} /></Field>
        <Field label={t('Education')}><textarea rows={3} value={v.education} onChange={set('education')} /></Field>
        <Field label={t('Summary')}><textarea rows={3} value={v.summary} onChange={set('summary')} /></Field>
      </div>
      <div className="mt-3"><Field label={t('Extracted text')}><textarea dir="auto" rows={10} value={v.text} onChange={set('text')} /></Field></div>
      <div className="mt-3 flex items-center justify-end gap-3">{msg && <span className="text-sm text-mute">{msg}</span>}<Button variant="primary" onClick={() => void save()}>{t('Save')}</Button></div>
    </Card>
  );
}
