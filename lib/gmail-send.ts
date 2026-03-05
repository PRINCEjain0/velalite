import { getAssistantEmail, getGmailClient } from '@/lib/gmail-client';

type GmailSendParams = {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  headers?: Record<string, string | undefined>;
};

function base64UrlEncode(input: string) {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function buildRawEmail(params: {
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  headers?: Record<string, string | undefined>;
}) {
  const lines: string[] = [];

  lines.push(`From: ${params.from}`);
  lines.push(`To: ${params.to.join(', ')}`);
  if (params.cc && params.cc.length > 0) {
    lines.push(`Cc: ${params.cc.join(', ')}`);
  }
  lines.push(`Subject: ${params.subject}`);
  lines.push('MIME-Version: 1.0');
  lines.push('Content-Type: text/plain; charset="UTF-8"');
  lines.push('Content-Transfer-Encoding: 7bit');

  if (params.headers) {
    for (const [k, v] of Object.entries(params.headers)) {
      if (!v) continue;
      lines.push(`${k}: ${v}`);
    }
  }

  lines.push('');
  lines.push(params.body);
  lines.push('');

  return lines.join('\r\n');
}

export async function sendViaGmail({
  to,
  cc,
  subject,
  body,
  headers,
}: GmailSendParams): Promise<{ ok: true; gmailMessageId: string } | { ok: false; reason: string }> {
  const gmail = getGmailClient();
  const from = getAssistantEmail();
  if (!gmail || !from) {
    return { ok: false, reason: 'gmail_not_configured' };
  }

  const raw = buildRawEmail({
    from,
    to,
    cc,
    subject,
    body,
    headers,
  });

  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: base64UrlEncode(raw),
    },
  });

  return { ok: true, gmailMessageId: res.data.id ?? '' };
}

