import { createHash } from 'node:crypto';
import { PLACEHOLDER_RE, isValidEmail, type CvProfile, type EmailDraft } from '@ajaa/shared';

/** Fingerprint of exactly what the user sees in the confirmation dialog (recipient, subject, body, attached CV file). */
export function computeContentHash(d: Pick<EmailDraft, 'to' | 'subject' | 'body' | 'cvVersionId'>, cvSha256: string): string {
  return createHash('sha256').update(JSON.stringify([d.to, d.subject, d.body, d.cvVersionId, cvSha256])).digest('hex');
}

export type SendCheck = { ok: true } | { ok: false; status: number; code: string; message: string };

const fail = (status: number, code: string, message: string): SendCheck => ({ ok: false, status, code, message });

/**
 * THE approval gate. Pure function so it can be tested exhaustively.
 * A send is allowed only when the authenticated owner explicitly confirmed (`SEND`) the exact
 * content they reviewed (hash match), the draft is in a sendable state and the recipient is valid.
 */
export function checkSendAllowed(i: { draft: EmailDraft | null; actingUid: string; confirmation: unknown; contentHash: unknown; cv: CvProfile | null }): SendCheck {
  const { draft, cv } = i;
  if (!draft || draft.uid !== i.actingUid) return fail(404, 'draft_not_found', 'Draft not found.');
  if (draft.status === 'sent') return fail(409, 'already_sent', 'This application was already sent.');
  if (draft.status === 'sending') return fail(409, 'already_sending', 'This email is already being sent.');
  if (draft.status !== 'draft' && draft.status !== 'failed') return fail(409, 'bad_status', `A draft in status "${draft.status}" cannot be sent.`);
  if (i.confirmation !== 'SEND') return fail(400, 'confirmation_required', 'Explicit confirmation is required to send.');
  if (!cv || cv.uid !== i.actingUid || cv.id !== draft.cvVersionId) return fail(409, 'cv_missing', 'The attached CV version is no longer available.');
  if (typeof i.contentHash !== 'string' || i.contentHash !== computeContentHash(draft, cv.sha256)) return fail(409, 'content_changed', 'The draft changed after you reviewed it. Review it again before sending.');
  if (!isValidEmail(draft.to)) return fail(400, 'bad_recipient', 'A valid recipient email is required.');
  if (!draft.subject.trim() || !draft.body.trim()) return fail(400, 'empty_content', 'Subject and body must not be empty.');
  if (PLACEHOLDER_RE.test(draft.body) || PLACEHOLDER_RE.test(draft.subject)) return fail(400, 'placeholder_left', 'Replace the placeholder (e.g. [Your name]) before sending.');
  return { ok: true };
}
