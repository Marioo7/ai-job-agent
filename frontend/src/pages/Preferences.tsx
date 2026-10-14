import { useState } from 'react';
import type { ExperienceLevel, Preferences as Prefs, ScoreWeights, WorkMode } from '@ajaa/shared';
import { Button, Card, ErrorBox, Field, Notice, Spinner, csv } from '../components/ui';
import { useAsync } from '../hooks/useAsync';
import { useI18n } from '../i18n';
import { api } from '../services/api';

const WEIGHTS: Array<keyof ScoreWeights> = ['skills', 'experience', 'seniority', 'location', 'titles', 'qualifications'];
const MODES: WorkMode[] = ['remote', 'onsite', 'hybrid'];

export function Preferences() {
  const { t, setLang } = useI18n();
  const { data, error, loading } = useAsync(() => api.get<Prefs>('/preferences'));
  const [p, setP] = useState<Prefs | null>(null);
  const [text, setText] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [ack, setAck] = useState(false);

  const cur = p ?? data;
  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorBox message={error} />;
  if (!cur) return null;
  const upd = (patch: Partial<Prefs>) => setP({ ...cur, ...patch });
  const listField = (k: 'preferredTechnologies' | 'jobTitles' | 'locations' | 'excludedCompanies' | 'excludedKeywords', label: string) => (
    <Field label={t(label)} hint={t('Comma separated')}>
      <input value={text[k] ?? cur[k].join(', ')} onChange={(e) => { setText({ ...text, [k]: e.target.value }); upd({ [k]: csv(e.target.value) } as Partial<Prefs>); }} />
    </Field>
  );
  const save = async () => {
    try {
      const { uid: _u, updatedAt: _t, ...body } = cur;
      const saved = await api.put<Prefs>('/preferences', { ...body, autoApply: { enabled: cur.autoApply.enabled, minScore: cur.autoApply.minScore, dailyLimit: cur.autoApply.dailyLimit, acknowledged: ack } });
      setP(saved);
      setAck(false);
      setLang(saved.uiLanguage);
      setMsg({ tone: 'good', text: t('Saved.') });
    } catch (e) { setMsg({ tone: 'bad', text: e instanceof Error ? e.message : 'Error' }); }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{t('Preferences')}</h1>
      <Card>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label={t('Full name')}><input value={cur.fullName} onChange={(e) => upd({ fullName: e.target.value })} /></Field>
          <Field label={t('Minimum match score')}><input type="number" min={0} max={100} value={cur.minScore} onChange={(e) => upd({ minScore: Number(e.target.value) })} /></Field>
          {listField('preferredTechnologies', 'Preferred technologies')}
          {listField('jobTitles', 'Preferred job titles')}
          {listField('locations', 'Preferred locations')}
          <Field label={t('Experience level')}>
            <select value={cur.experienceLevel} onChange={(e) => upd({ experienceLevel: e.target.value as ExperienceLevel })}>
              {(['any', 'junior', 'mid', 'senior'] as const).map((l) => <option key={l} value={l}>{t(l)}</option>)}
            </select>
          </Field>
          {listField('excludedCompanies', 'Excluded companies')}
          {listField('excludedKeywords', 'Excluded keywords')}
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">{t('Work modes')}</legend>
            <div className="flex gap-4">{MODES.map((m) => (
              <label key={m} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={cur.workModes.includes(m)} onChange={(e) => upd({ workModes: e.target.checked ? [...cur.workModes, m] : cur.workModes.filter((x) => x !== m) })} /> {t(m)}</label>
            ))}</div>
          </fieldset>
          <Field label={t('Interface language')}><select value={cur.uiLanguage} onChange={(e) => upd({ uiLanguage: e.target.value as 'en' | 'ar' })}><option value="en">{t('English')}</option><option value="ar">{t('Arabic')}</option></select></Field>
          <Field label={t('Email language')}><select value={cur.emailLanguage} onChange={(e) => upd({ emailLanguage: e.target.value as 'en' | 'ar' })}><option value="en">{t('English')}</option><option value="ar">{t('Arabic')}</option></select></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cur.aiEnabled} onChange={(e) => upd({ aiEnabled: e.target.checked })} /> {t('Use AI when configured')}</label>
        </div>
      </Card>
      <Card title={t('Scoring weights')}>
        <p className="mb-3 text-sm text-mute">The final score is the weighted share of each criterion. Weights are relative: they do not need to sum to 100.</p>
        <div className="grid gap-3 md:grid-cols-2">
          {WEIGHTS.map((k) => (
            <label key={k} className="block text-sm"><span className="flex justify-between"><span className="capitalize">{k}</span><span className="tabular-nums">{cur.weights[k]}</span></span>
              <input type="range" min={0} max={100} value={cur.weights[k]} onChange={(e) => upd({ weights: { ...cur.weights, [k]: Number(e.target.value) } })} />
            </label>
          ))}
        </div>
      </Card>
      <Card title="Sending mode">
        <div className="space-y-3 text-sm">
          <label className="flex items-start gap-2"><input type="radio" name="mode" checked={!cur.autoApply.enabled} onChange={() => upd({ autoApply: { ...cur.autoApply, enabled: false } })} />
            <span><strong>Manual (recommended)</strong> — drafts wait in “Email approvals”. Nothing is sent until you press Confirm and send.</span></label>
          <label className="flex items-start gap-2"><input type="radio" name="mode" checked={cur.autoApply.enabled} onChange={() => upd({ autoApply: { ...cur.autoApply, enabled: true } })} />
            <span><strong>Automatic</strong> — the server sends the application by itself for jobs that pass the rules below.</span></label>
          {cur.autoApply.enabled && (
            <div className="space-y-3 rounded border border-warn/40 bg-warn-soft p-3">
              <p>Automatic mode only handles jobs found <strong>after</strong> you switch it on, with ONE clear email address written in the post, using the plain template (your CV facts only, no AI wording). It pauses itself on the first failed send. Mistakes are still possible: a wrong match, a company you don’t want, or a post that isn’t a real job. Emails go out from your Gmail without review.</p>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Minimum score to send automatically"><input type="number" min={50} max={100} value={cur.autoApply.minScore} onChange={(e) => upd({ autoApply: { ...cur.autoApply, minScore: Number(e.target.value) } })} /></Field>
                <Field label="Maximum automatic emails per day"><input type="number" min={1} max={20} value={cur.autoApply.dailyLimit} onChange={(e) => upd({ autoApply: { ...cur.autoApply, dailyLimit: Number(e.target.value) } })} /></Field>
              </div>
              {cur.autoApply.enabledAt ? <p className="text-xs text-mute">Active since {new Date(cur.autoApply.enabledAt).toLocaleString()}.</p> : (
                <label className="flex items-start gap-2"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> <span>I understand emails will be sent from my Gmail without my review.</span></label>
              )}
            </div>
          )}
        </div>
      </Card>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <div className="flex gap-2"><Button variant="primary" onClick={() => void save()}>{t('Save')}</Button><Button onClick={() => void api.post('/jobs/rescore').then(() => setMsg({ tone: 'good', text: t('Saved.') }))}>{t('Rescore all jobs')}</Button></div>
    </div>
  );
}
