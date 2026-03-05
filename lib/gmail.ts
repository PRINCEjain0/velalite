import type { ParsedEmail } from '@/types/email';
import { processIncomingEmail } from '@/lib/agent';
import { getAssistantEmail, getGmailClient } from '@/lib/gmail-client';

function getHeader(
  headers: { name?: string | null; value?: string | null }[] | undefined,
  name: string
): string | undefined {
  if (!headers) return undefined;
  const found = headers.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return found?.value ?? undefined;
}

function extractEmail(address: string): string {
  const match = address.match(/<([^>]+)>/);
  return match ? match[1] : address.trim();
}

function parseAddressList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((part) => extractEmail(part))
    .filter((part) => part.length > 0);
}

function decodeBody(data?: string | null): string {
  if (!data) return '';
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  const buff = Buffer.from(normalized, 'base64');
  return buff.toString('utf8');
}

function toParsedEmail(message: any): ParsedEmail {
  const headers = message.payload?.headers ?? [];
  const messageId = getHeader(headers, 'Message-Id') ?? '';
  const threadIdHeader =
    getHeader(headers, 'In-Reply-To') ?? getHeader(headers, 'References') ?? undefined;
  const subject = getHeader(headers, 'Subject') ?? '';
  const from = getHeader(headers, 'From') ?? '';
  const to = parseAddressList(getHeader(headers, 'To'));
  const cc = parseAddressList(getHeader(headers, 'Cc'));

  let bodyText = '';
  const payload = message.payload;
  if (payload?.parts && Array.isArray(payload.parts)) {
    const textPart =
      payload.parts.find((p: any) => p.mimeType === 'text/plain') ?? payload.parts[0];
    bodyText = decodeBody(textPart?.body?.data ?? '');
  } else {
    bodyText = decodeBody(payload?.body?.data ?? '');
  }

  const parsed: ParsedEmail = {
    messageId,
    threadId: threadIdHeader,
    subject,
    from,
    to,
    cc,
    bodyText,
  };

  return parsed;
}

export async function processUnreadAgentInbox() {
  const gmail = getGmailClient();
  const assistantEmail = getAssistantEmail();
  if (!gmail || !assistantEmail) {
    return { ok: false, processedCount: 0, reason: 'gmail_not_configured' as const };
  }

  const q = `is:unread (to:${assistantEmail} OR cc:${assistantEmail}) -from:${assistantEmail}`;

  const res = await gmail.users.messages.list({
    userId: 'me',
    q,
    maxResults: 10,
    includeSpamTrash: true,
  });

  const messages = res.data.messages ?? [];
  if (messages.length === 0) {
    return { ok: true, processedCount: 0 };
  }

  let processedCount = 0;

  for (const msg of messages) {
    if (!msg.id) continue;

    try {
      const full = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'full',
      });

      const parsed = toParsedEmail(full.data);
      await processIncomingEmail(parsed);
      processedCount += 1;

      await gmail.users.messages.modify({
        userId: 'me',
        id: msg.id,
        requestBody: {
          removeLabelIds: ['UNREAD'],
        },
      });
    } catch (err) {
      console.error('Error processing Gmail message', msg.id, err);
    }
  }

  return { ok: true, processedCount };
}

