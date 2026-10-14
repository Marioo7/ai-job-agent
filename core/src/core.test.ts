import { describe, expect, it } from 'vitest';
import { COLLECTIONS, type EmailDraft, type Job } from '@ajaa/shared';
import {
  AiError, AppError, MemoryDb, MemoryFileStore, MockMailSender, MockProvider, buildRawMime, checkSendAllowed, computeContentHash, decryptSecret, editDraft, encryptSecret,
  extractPdfText, generateDraft, makePdf, mergeAiExtraction, processIncomingMessage, reprocessPending, seedCv, sendDraft, signState, validatePdfBuffer, verifyState,
  rejectDraft, type AiProvider, type PipelineDeps,
} from './index';
import { extractJobFields } from '@ajaa/shared';

const JOB_TEXT = `We are hiring: Senior React Developer
Company: Acme Labs
Location: Cairo (Hybrid)
Requirements: 4+ years of experience with React, TypeScript and Node.js. Bachelor degree.
Send your CV to careers@acme.example`;
const NO_EMAIL_JOB = `We are hiring: Backend Engineer
Requirements: 3+ years of experience with Node.js and PostgreSQL. Apply through our website soon.`;

function setup(ai: AiProvider = new MockProvider()) {
  const db = new MemoryDb();
  const files = new MemoryFileStore();
  const mail = new MockMailSender();
  const deps: PipelineDeps = { db, ai, aiDailyCap: 100 };
  return { db, files, mail, deps };
}
const msg = (id: number, text = JOB_TEXT, source = 's1') => ({ sourceId: source, sourceName: 'Jobs', messageId: id, date: '2026-01-01T00:00:00.000Z', text });

describe('telegram message processing', () => {
  it('creates a job once and ignores duplicates (same source + message id)', async () => {
    const { db, deps } = setup();
    const a = await processIncomingMessage(deps, 'u1', msg(1));
    const b = await processIncomingMessage(deps, 'u1', msg(1));
    expect(a.status).toBe('job');
    expect(b.status).toBe('duplicate');
    expect(await db.count(COLLECTIONS.jobs, [['uid', '==', 'u1']])).toBe(1);
  });
  it('detects the same post cross-posted in another channel', async () => {
    const { db, deps } = setup();
    const a = await processIncomingMessage(deps, 'u1', msg(1));
    const b = await processIncomingMessage(deps, 'u1', msg(77, JOB_TEXT.toUpperCase(), 's2'));
    expect(b.status).toBe('duplicate');
    expect(b.jobId).toBe(a.jobId);
    expect(await db.count(COLLECTIONS.jobs)).toBe(1);
  });
  it('ignores non-job chatter and empty messages', async () => {
    const { deps } = setup();
    expect((await processIncomingMessage(deps, 'u1', msg(2, 'Good morning everyone, the meetup is on Friday, pizza will be provided.'))).status).toBe('ignored');
    expect((await processIncomingMessage(deps, 'u1', msg(3, ''))).status).toBe('empty');
  });
  it('keeps users isolated (same message, different users)', async () => {
    const { db, deps } = setup();
    expect((await processIncomingMessage(deps, 'u1', msg(1))).status).toBe('job');
    expect((await processIncomingMessage(deps, 'u2', msg(1))).status).toBe('job');
    expect(await db.count(COLLECTIONS.jobs, [['uid', '==', 'u1']])).toBe(1);
    expect(await db.count(COLLECTIONS.jobs, [['uid', '==', 'u2']])).toBe(1);
  });
  it('scores against the active CV when present', async () => {
    const { db, files, deps } = setup();
    await seedCv(db, files, 'u1');
    const r = await processIncomingMessage(deps, 'u1', msg(1));
    const job = (await db.get<Job>(COLLECTIONS.jobs, r.jobId!))!;
    expect(job.match?.score).toBeGreaterThan(50);
    expect(job.status).toBe('matched');
  });
  it('recovers after a crash mid-pipeline (retries stored but unprocessed messages)', async () => {
    class Flaky extends MemoryDb {
      fail = true;
      override async create(col: string, id: string, data: object) {
        if (col === COLLECTIONS.jobs && this.fail) { this.fail = false; throw new Error('boom'); }
        return super.create(col, id, data);
      }
    }
    const db = new Flaky();
    const deps: PipelineDeps = { db, ai: new MockProvider(), aiDailyCap: 10 };
    const first = await processIncomingMessage(deps, 'u1', msg(1));
    expect(first.status).toBe('error');
    expect(await db.count(COLLECTIONS.jobs)).toBe(0);
    expect(await reprocessPending(deps, 'u1')).toBe(1);
    expect(await db.count(COLLECTIONS.jobs)).toBe(1);
    expect((await processIncomingMessage(deps, 'u1', msg(1))).status).toBe('duplicate');
  });
  it('still saves the job when the AI provider fails (quota)', async () => {
    const failing: AiProvider = { name: 'x', enabled: true, isMock: false, async extractJob() { throw new AiError('quota', 'q'); }, async analyzeMatch() { throw new AiError('quota', 'q'); }, async writeEmail() { throw new AiError('quota', 'q'); } };
    const { db, deps } = setup(failing);
    const r = await processIncomingMessage(deps, 'u1', msg(1));
    expect(r.status).toBe('job');
    const job = (await db.get<Job>(COLLECTIONS.jobs, r.jobId!))!;
    expect(job.aiError).toBe('quota');
    expect(job.extractionMethod).toBe('heuristic');
  });
  it('never accepts facts from the AI that are not in the original post', () => {
    const base = extractJobFields('We are hiring a developer. Details soon, thanks everyone for reading this post.');
    const merged = mergeAiExtraction(base, { isJob: true, title: 'Wizard', company: 'Invented Inc', location: 'Mars', workMode: null, technologies: ['react'], experienceYears: 5, applicationEmail: 'ceo@invented.example', applicationLink: 'https://evil.example', salary: '$1M', deadline: 'tomorrow' }, 'We are hiring a developer. Details soon, thanks everyone for reading this post.');
    expect(merged.company).toBeNull();
    expect(merged.applicationEmail).toBeNull();
    expect(merged.applicationLink).toBeNull();
    expect(merged.salary).toBeNull();
    expect(merged.technologies).not.toContain('react');
  });
});

async function draftReady(text = JOB_TEXT) {
  const s = setup();
  await seedCv(s.db, s.files, 'u1');
  const r = await processIncomingMessage(s.deps, 'u1', msg(1, text));
  const draft = await generateDraft(s.deps, 'u1', r.jobId!);
  const cv = (await s.db.list<{ sha256: string; id: string }>(COLLECTIONS.cvProfiles, { where: [['uid', '==', 'u1']] }))[0]!;
  return { ...s, jobId: r.jobId!, draft, hash: () => s.db.get<EmailDraft>(COLLECTIONS.emailDrafts, draft.id).then((d) => computeContentHash(d!, cv.sha256)) };
}

describe('drafts never send; approval gate enforced', () => {
  it('creating, editing, regenerating and rejecting drafts sends nothing', async () => {
    const t = await draftReady();
    expect(t.draft.status).toBe('draft');
    expect(t.draft.to).toBe('careers@acme.example');
    expect(t.draft.toSource).toBe('source');
    await editDraft(t.db, 'u1', t.draft.id, { subject: 'New subject' });
    await generateDraft(t.deps, 'u1', t.jobId);
    await rejectDraft(t.db, 'u1', t.draft.id);
    expect(t.mail.sent).toHaveLength(0);
  });

  it('blocks sending without explicit confirmation', async () => {
    const t = await draftReady();
    for (const confirmation of [undefined, 'yes', true, 'send', '']) {
      await expect(sendDraft(t, 'u1', t.draft.id, { confirmation, contentHash: await t.hash() })).rejects.toMatchObject({ code: 'confirmation_required' });
    }
    expect(t.mail.sent).toHaveLength(0);
  });

  it('blocks sending when the reviewed content hash does not match', async () => {
    const t = await draftReady();
    await expect(sendDraft(t, 'u1', t.draft.id, { confirmation: 'SEND', contentHash: 'f'.repeat(64) })).rejects.toMatchObject({ code: 'content_changed' });
    const stale = await t.hash();
    await editDraft(t.db, 'u1', t.draft.id, { body: 'Dear team, I changed this text after reviewing it earlier today. Regards, John Carter' });
    await expect(sendDraft(t, 'u1', t.draft.id, { confirmation: 'SEND', contentHash: stale })).rejects.toMatchObject({ code: 'content_changed' });
    expect(t.mail.sent).toHaveLength(0);
  });

  it("blocks another user's send and missing/invalid recipients and placeholders", async () => {
    const t = await draftReady();
    await expect(sendDraft(t, 'intruder', t.draft.id, { confirmation: 'SEND', contentHash: await t.hash() })).rejects.toMatchObject({ code: 'draft_not_found', status: 404 });

    const noMail = await draftReady(NO_EMAIL_JOB);
    expect(noMail.draft.to).toBeNull();
    await expect(sendDraft(noMail, 'u1', noMail.draft.id, { confirmation: 'SEND', contentHash: await noMail.hash() })).rejects.toMatchObject({ code: 'bad_recipient' });

    await editDraft(t.db, 'u1', t.draft.id, { body: 'Dear team, regards [Your name]. This is a long enough body for the test.' });
    await expect(sendDraft(t, 'u1', t.draft.id, { confirmation: 'SEND', contentHash: await t.hash() })).rejects.toMatchObject({ code: 'placeholder_left' });
    expect(t.mail.sent).toHaveLength(0);
  });

  it('sends exactly once with the CV attached, and records the application', async () => {
    const t = await draftReady();
    const app = await sendDraft(t, 'u1', t.draft.id, { confirmation: 'SEND', contentHash: await t.hash() });
    expect(app.status).toBe('sent');
    expect(t.mail.sent).toHaveLength(1);
    expect(t.mail.sent[0]!.to).toBe('careers@acme.example');
    expect(t.mail.sent[0]!.attachment.data.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await t.db.get<Job>(COLLECTIONS.jobs, t.jobId))!.status).toBe('sent');
    await expect(sendDraft(t, 'u1', t.draft.id, { confirmation: 'SEND', contentHash: await t.hash() })).rejects.toMatchObject({ code: 'already_sent' });
    await expect(generateDraft(t.deps, 'u1', t.jobId)).rejects.toMatchObject({ code: 'draft_locked' });
    expect(t.mail.sent).toHaveLength(1);
  });

  it('prevents duplicate sends under concurrent requests', async () => {
    const t = await draftReady();
    const hash = await t.hash();
    const results = await Promise.allSettled([1, 2, 3, 4].map(() => sendDraft(t, 'u1', t.draft.id, { confirmation: 'SEND', contentHash: hash })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(t.mail.sent).toHaveLength(1);
  });

  it('records failures and allows a safe retry', async () => {
    const t = await draftReady();
    const hash = await t.hash();
    t.mail.failNext = true;
    await expect(sendDraft(t, 'u1', t.draft.id, { confirmation: 'SEND', contentHash: hash })).rejects.toMatchObject({ code: 'send_failed' });
    expect((await t.db.get<EmailDraft>(COLLECTIONS.emailDrafts, t.draft.id))!.status).toBe('failed');
    expect(t.mail.sent).toHaveLength(0);
    const app = await sendDraft(t, 'u1', t.draft.id, { confirmation: 'SEND', contentHash: hash });
    expect(app.attempts).toBe(2);
    expect(t.mail.sent).toHaveLength(1);
  });

  it('gate is a pure function: wrong owner / wrong status are refused', () => {
    expect(checkSendAllowed({ draft: null, actingUid: 'u', confirmation: 'SEND', contentHash: 'x', cv: null })).toMatchObject({ ok: false });
  });
});

describe('cv validation', () => {
  it('rejects non-PDF bytes, empty and oversized files regardless of the file name', () => {
    expect(() => validatePdfBuffer(Buffer.from('MZ not a pdf'))).toThrow(AppError);
    expect(() => validatePdfBuffer(Buffer.alloc(0))).toThrow(/empty/);
    expect(() => validatePdfBuffer(Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(100)]), 50)).toThrow(/larger/);
  });
  it('extracts real text and rejects text-less PDFs', async () => {
    const ok = await extractPdfText(makePdf(['John Carter', 'Software engineer with 6 years of experience in React and TypeScript development for the web.', 'Skills: React TypeScript Docker']));
    expect(ok.text).toContain('John Carter');
    await expect(extractPdfText(makePdf(['hi']))).rejects.toMatchObject({ code: 'pdf_no_text' });
  });
});

describe('crypto + mime', () => {
  const key = Buffer.alloc(32, 7);
  it('encrypts/decrypts and detects tampering', () => {
    const enc = encryptSecret('super-secret-session', key);
    expect(enc).not.toContain('super-secret');
    expect(decryptSecret(enc, key)).toBe('super-secret-session');
    expect(() => decryptSecret(enc.slice(0, -4) + 'AAAA', key)).toThrow();
    expect(() => decryptSecret(enc, Buffer.alloc(32, 8))).toThrow();
  });
  it('signs OAuth state and rejects tampered or expired state', () => {
    const s = signState({ uid: 'u1' }, key);
    expect(verifyState(s, key)).toEqual({ uid: 'u1' });
    expect(verifyState(s + 'x', key)).toBeNull();
    expect(verifyState(s, Buffer.alloc(32, 1))).toBeNull();
    expect(verifyState(s, key, Date.now() + 11 * 60_000)).toBeNull();
  });
  it('builds a safe MIME message and blocks header injection', () => {
    const raw = Buffer.from(buildRawMime({ to: 'a@b.example', subject: 'Héllo', body: 'Body', attachment: { filename: 'my cv.pdf', contentType: 'application/pdf', data: Buffer.from('%PDF-1') } }, 'BND'), 'base64url').toString();
    expect(raw).toContain('To: a@b.example');
    expect(raw).toContain('filename="my cv.pdf"');
    expect(raw).toContain('--BND--');
    expect(raw).toMatch(/Subject: =\?UTF-8\?B\?/);
    expect(() => buildRawMime({ to: 'a@b.example\r\nBcc: x@y.example', subject: 's', body: 'b' })).toThrow(/injection/);
  });
});
