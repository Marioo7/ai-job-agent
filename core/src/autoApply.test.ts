import { describe, expect, it } from 'vitest';
import { COLLECTIONS, defaultPreferences, type Application, type EmailDraft, type Job, type Preferences } from '@ajaa/shared';
import { MemoryDb, type QueryOpts, MemoryFileStore, MockMailSender, MockProvider, autoApplyTick, isClearApplicationEmail, processIncomingMessage, seedCv, sendDraft, computeContentHash, generateDraft, type AutoDeps } from './index';

const post = (n: number, extra = 'Send your CV to jobs@acme.example') => `We are hiring: Senior React Developer #${n}\nCompany: Acme ${n}\nRequirements: 3+ years of experience with React, TypeScript and Node.js.\n${extra}`;

async function setup(over: Partial<Preferences['autoApply']> = {}, fullName = 'John Carter', prefsOver: Partial<Preferences> = {}) {
  const db = new MemoryDb();
  const files = new MemoryFileStore();
  const mail = new MockMailSender();
  const deps: AutoDeps = { db, ai: new MockProvider(), files, mail, aiDailyCap: 10 };
  await seedCv(db, files, 'u1');
  const prefs: Preferences = { ...defaultPreferences('u1'), fullName, ...prefsOver, autoApply: { enabled: true, dailyLimit: 50, enabledAt: '2000-01-01T00:00:00.000Z', ...over } };
  await db.set(COLLECTIONS.userPreferences, 'u1', prefs);
  const add = (n: number, text = post(n), source = 's1') => processIncomingMessage(deps, 'u1', { sourceId: source, sourceName: 'Jobs', messageId: n, date: new Date().toISOString(), text });
  return { db, mail, deps, add };
}

describe('automatic applying: send only when there is a clear valid email', () => {
  it('sends nothing when switched off (default)', async () => {
    const t = await setup({ enabled: false });
    await t.add(1);
    expect((await autoApplyTick(t.deps, 'u1')).sent).toBe(0);
    expect(t.mail.sent).toHaveLength(0);
  });

  it('sends a job with a clear email once, marks it automatic, and never twice', async () => {
    const t = await setup();
    await t.add(1);
    expect((await autoApplyTick(t.deps, 'u1')).sent).toBe(1);
    expect((await autoApplyTick(t.deps, 'u1')).sent).toBe(0);
    expect(t.mail.sent).toHaveLength(1);
    expect(t.mail.sent[0]!.to).toBe('jobs@acme.example');
    expect(t.mail.sent[0]!.body).toContain('John Carter');
    const apps = await t.db.list<Application>(COLLECTIONS.applications, { where: [['uid', '==', 'u1']] });
    expect(apps[0]!.autoApplied).toBe(true);
  });

  it('does NOT use score, specialty, seniority or years of experience to skip a job', async () => {
    const t = await setup({}, 'John Carter', { experienceLevel: 'junior', jobTitles: ['nurse'], workModes: ['remote'], locations: ['tokyo'], preferredTechnologies: ['cobol'] });
    // totally different specialty / far more experience required / senior level / no overlap with the CV
    await t.add(1, `Hiring: Senior Embedded C++ Firmware Engineer\nRequirements: 15+ years of experience with C++, Linux and Kubernetes. Onsite in Berlin.\nApply: careers@firmware.example`);
    const r = await autoApplyTick(t.deps, 'u1');
    expect(r.sent).toBe(1);
    const job = (await t.db.list<Job>(COLLECTIONS.jobs))[0]!;
    expect(job.match!.score).toBeLessThan(60); // low score, yet it was sent
    expect(t.mail.sent[0]!.to).toBe('careers@firmware.example');
  });

  it('with no email the job is saved and nothing is sent', async () => {
    const t = await setup();
    const a = await t.add(1, post(1, 'Apply through our website: https://acme.example/jobs/1'));
    expect(a.status).toBe('job');
    const r = await autoApplyTick(t.deps, 'u1');
    expect(r.sent).toBe(0);
    expect(t.mail.sent).toHaveLength(0);
    const job = (await t.db.get<Job>(COLLECTIONS.jobs, a.jobId!))!;
    expect(job.extracted.applicationEmail).toBeNull();
    expect(job.extracted.applicationLink).toBe('https://acme.example/jobs/1');
    expect(['new', 'matched']).toContain(job.status);
    expect(await t.db.count(COLLECTIONS.emailDrafts)).toBe(0);
  });

  it('is sent when the job was saved before a CV existed (no CV at ingestion time)', async () => {
    const db = new MemoryDb(); const files = new MemoryFileStore(); const mail = new MockMailSender();
    const deps: AutoDeps = { db, ai: new MockProvider(), files, mail, aiDailyCap: 10 };
    await processIncomingMessage(deps, 'u1', { sourceId: 's', sourceName: 'J', messageId: 1, date: new Date().toISOString(), text: post(1) });
    expect((await db.list<Job>(COLLECTIONS.jobs))[0]!.status).toBe('new');
    await seedCv(db, files, 'u1');
    await db.set(COLLECTIONS.userPreferences, 'u1', { ...defaultPreferences('u1'), autoApply: { enabled: true, dailyLimit: 5, enabledAt: '2000-01-01T00:00:00.000Z' } });
    expect((await autoApplyTick(deps, 'u1')).sent).toBe(1);
  });

  it('still respects the explicit blacklist, "irrelevant", and the switch-on time', async () => {
    const bl = await setup({}, 'John Carter', { excludedKeywords: ['acme'] });
    await bl.add(1);
    expect((await autoApplyTick(bl.deps, 'u1')).sent).toBe(0);

    const irr = await setup();
    const r = await irr.add(1);
    await irr.db.update(COLLECTIONS.jobs, r.jobId!, { userRelevance: 'irrelevant' });
    expect((await autoApplyTick(irr.deps, 'u1')).sent).toBe(0);

    const later = await setup({ enabledAt: new Date(Date.now() + 60_000).toISOString() });
    await later.add(1);
    expect((await autoApplyTick(later.deps, 'u1')).sent).toBe(0);
    expect(bl.mail.sent.length + irr.mail.sent.length + later.mail.sent.length).toBe(0);
  });

  it('validates the email: no-reply, malformed and reserved domains are rejected (reserved allowed only in mock mail)', () => {
    expect(isClearApplicationEmail('hr@company.com', false)).toBe(true);
    expect(isClearApplicationEmail('no-reply@company.com', false)).toBe(false);
    expect(isClearApplicationEmail('hr..x@company.com', false)).toBe(false);
    expect(isClearApplicationEmail('hr@-company.com', false)).toBe(false);
    expect(isClearApplicationEmail('hr@example.com', false)).toBe(false);
    expect(isClearApplicationEmail('hr@example.com', true)).toBe(true);
    expect(isClearApplicationEmail(null, true)).toBe(false);
  });

  it('with real mail a reserved/test domain is never emailed', async () => {
    const t = await setup();
    const real = Object.assign(new MockMailSender(), { mode: 'google' as never });
    await t.add(1);
    expect((await autoApplyTick({ ...t.deps, mail: real }, 'u1')).sent).toBe(0);
    expect(real.sent).toHaveLength(0);
  });

  it('several emails in a post: used only when exactly one is on the apply line, otherwise saved without sending', async () => {
    const t = await setup();
    await t.add(1, post(1, 'Questions: info@acme.example\nSend your CV to hr@acme.example'));
    await t.add(2, post(2, 'Contacts: hr@a.example and info@b.example'));
    expect((await autoApplyTick(t.deps, 'u1')).sent).toBe(1);
    expect(t.mail.sent[0]!.to).toBe('hr@acme.example');
  });
});

describe('never applying twice', () => {
  it('same post cross-posted in two channels => one application', async () => {
    const t = await setup();
    await t.add(1, post(1), 'channelA');
    const dup = await t.add(900, post(1).toUpperCase(), 'channelB');
    expect(dup.status).toBe('duplicate');
    expect((await autoApplyTick(t.deps, 'u1')).sent).toBe(1);
    expect((await autoApplyTick(t.deps, 'u1')).sent).toBe(0);
    expect(t.mail.sent).toHaveLength(1);
  });

  it('same recipient + same job title/company posted again with different wording => not emailed again', async () => {
    const t = await setup();
    await t.add(1, `We are hiring: Backend Engineer\nCompany: Acme\nRequirements: 3+ years of experience with Node.js.\nSend your CV to hr@acme.example`);
    await t.add(2, `Vacancy: Backend Engineer\nCompany: Acme\nNew: 5+ years of experience with Node.js and Docker, remote.\nSend your CV to hr@acme.example`);
    const r = await autoApplyTick(t.deps, 'u1');
    expect(r.sent).toBe(1);
    expect(t.mail.sent).toHaveLength(1);
    // but a DIFFERENT job at the same company/recipient is still applied to
    await t.add(3, `We are hiring: QA Engineer\nCompany: Acme\nRequirements: Selenium.\nSend your CV to hr@acme.example`);
    expect((await autoApplyTick(t.deps, 'u1')).sent).toBe(1);
    expect(t.mail.sent).toHaveLength(2);
  });

  it('manual sending is also blocked for an already-applied job (same recipient + subject)', async () => {
    const t = await setup({ enabled: false });
    const a = await t.add(1);
    const b = await t.add(2, post(1).replace('#1', '#1 ') + '\nrepeat');
    const send = async (jobId: string) => {
      const d = await generateDraft(t.deps, 'u1', jobId, {});
      const cv = (await t.db.list<{ sha256: string }>(COLLECTIONS.cvProfiles))[0]!;
      return sendDraft(t.deps, 'u1', d.id, { confirmation: 'SEND', contentHash: computeContentHash(d, cv.sha256) });
    };
    await send(a.jobId!);
    await expect(send(b.jobId ?? a.jobId!)).rejects.toMatchObject({ status: 409 });
    expect(t.mail.sent).toHaveLength(1);
    expect((await t.db.get<EmailDraft>(COLLECTIONS.emailDrafts, `d_${a.jobId}`))!.status).toBe('sent');
  });
});

describe('free-tier friendly: every job is looked at once', () => {
  it('an idle cycle re-reads nothing, and a job edited later (email added) is looked at again', async () => {
    class CountingDb extends MemoryDb {
      jobDocsRead = 0;
      override async list<T>(col: string, q?: QueryOpts): Promise<T[]> {
        const r = await super.list<T>(col, q);
        if (col === COLLECTIONS.jobs) this.jobDocsRead += r.length;
        return r;
      }
    }
    const db = new CountingDb(); const files = new MemoryFileStore(); const mail = new MockMailSender();
    const deps: AutoDeps = { db, ai: new MockProvider(), files, mail, aiDailyCap: 10 };
    await seedCv(db, files, 'u1');
    await db.set(COLLECTIONS.userPreferences, 'u1', { ...defaultPreferences('u1'), fullName: 'John Carter', autoApply: { enabled: true, dailyLimit: 50, enabledAt: '2000-01-01T00:00:00.000Z' } });
    const ids: string[] = [];
    for (let i = 1; i <= 12; i++) ids.push((await processIncomingMessage(deps, 'u1', { sourceId: 's', sourceName: 'J', messageId: i, date: new Date().toISOString(), text: post(i, `Apply here: https://acme.example/jobs/${i}`).replace('#' + i, '#' + i + ' role') })).jobId!);

    await autoApplyTick(deps, 'u1');             // looks at the 12 link-only jobs once
    expect(mail.sent).toHaveLength(0);
    const before = db.jobDocsRead;
    for (let i = 0; i < 5; i++) await autoApplyTick(deps, 'u1'); // idle cycles
    expect(db.jobDocsRead).toBe(before);          // 0 extra job reads

    // the user adds the missing email by hand => it is looked at again and applied to
    const j = (await db.get<Job>(COLLECTIONS.jobs, ids[0]!))!;
    await db.update(COLLECTIONS.jobs, j.id, { extracted: { ...j.extracted, applicationEmail: 'hr@acme.example' }, autoChecked: false });
    expect((await autoApplyTick(deps, 'u1')).sent).toBe(1);
    expect(mail.sent[0]!.to).toBe('hr@acme.example');
  });
});

describe('safety rails', () => {
  it('respects the daily limit', async () => {
    const t = await setup({ dailyLimit: 2 });
    for (let i = 1; i <= 4; i++) await t.add(i, post(i, `Send your CV to team${i}@acme.example`).replace(/#\d/, `#${i}`).replace(`Acme ${i}`, `Company${i}`));
    expect((await autoApplyTick(t.deps, 'u1')).sent).toBe(2);
    expect((await autoApplyTick(t.deps, 'u1')).sent).toBe(0);
    expect(t.mail.sent).toHaveLength(2);
  });

  it('refuses to send when the signature name is missing (placeholder)', async () => {
    const t = await setup({}, '');
    const cv = (await t.db.list<{ id: string }>(COLLECTIONS.cvProfiles))[0]!;
    await t.db.update(COLLECTIONS.cvProfiles, cv.id, { fullName: '' });
    await t.add(1);
    expect((await autoApplyTick(t.deps, 'u1')).sent).toBe(0);
    expect(t.mail.sent).toHaveLength(0);
  });

  it('pauses itself after the first failed send (no retries)', async () => {
    const t = await setup();
    await t.add(1);
    await t.add(2, post(2, 'Send your CV to other@acme.example').replace('#2', '#2b').replace('Acme 2', 'Other Co'));
    t.mail.failNext = true;
    const r = await autoApplyTick(t.deps, 'u1');
    expect(r.paused).toBe(true);
    expect(t.mail.sent).toHaveLength(0);
    expect((await t.db.get<Preferences>(COLLECTIONS.userPreferences, 'u1'))!.autoApply.enabled).toBe(false);
    expect((await autoApplyTick(t.deps, 'u1')).sent).toBe(0);
  });
});
