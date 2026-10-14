export interface MimeInput {
  from?: string;
  to: string;
  subject: string;
  body: string;
  attachment?: { filename: string; contentType: string; data: Buffer };
}

const wrap76 = (b64: string) => b64.replace(/(.{76})/g, '$1\r\n');
const noCrlf = (s: string, what: string) => {
  if (/[\r\n]/.test(s)) throw new Error(`Header injection attempt in ${what}`);
  return s;
};
const asciiName = (n: string) => n.replace(/[^\w.\- ]+/g, '_').slice(0, 100) || 'cv.pdf';

/** RFC 2822 message with UTF-8 text part and optional attachment, returned base64url-encoded for the Gmail API. */
export function buildRawMime(m: MimeInput, boundary = `=_ajaa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`): string {
  const headers = [
    ...(m.from ? [`From: ${noCrlf(m.from, 'from')}`] : []),
    `To: ${noCrlf(m.to, 'to')}`,
    `Subject: =?UTF-8?B?${Buffer.from(m.subject.replace(/[\r\n]+/g, ' '), 'utf8').toString('base64')}?=`,
    'MIME-Version: 1.0',
  ];
  const text = wrap76(Buffer.from(m.body.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64'));
  let msg: string;
  if (!m.attachment) {
    msg = [...headers, 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', text].join('\r\n');
  } else {
    const fn = asciiName(m.attachment.filename);
    msg = [
      ...headers,
      `Content-Type: multipart/mixed; boundary="${boundary}"`, '',
      `--${boundary}`, 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', text, '',
      `--${boundary}`, `Content-Type: ${m.attachment.contentType}; name="${fn}"`, 'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${fn}"`, '', wrap76(m.attachment.data.toString('base64')), '',
      `--${boundary}--`, '',
    ].join('\r\n');
  }
  return Buffer.from(msg, 'utf8').toString('base64url');
}
