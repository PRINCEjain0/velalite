import type { ParsedEmail } from '@/types/email';

// Minimal shape of the SendGrid Inbound Parse payload we care about.
export type InboundPayload = {
  from: string;
  to: string;
  cc?: string;
  subject?: string;
  text?: string;
  headers?: string;
  'Message-Id'?: string;
  'In-Reply-To'?: string;
  'References'?: string;
};

function parseAddressList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function parseHeaders(raw?: string): Record<string, string> {
  if (!raw) return {};
  const headers: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) headers[key] = value;
  }
  return headers;
}

export function parseInboundEmail(payload: InboundPayload): ParsedEmail {
  const headers = parseHeaders(payload.headers);

  const messageId =
    payload['Message-Id'] ||
    headers['Message-Id'] ||
    headers['Message-ID'] ||
    '';

  const threadId =
    payload['In-Reply-To'] ||
    headers['In-Reply-To'] ||
    headers['References'] ||
    undefined;

  return {
    messageId,
    threadId,
    subject: payload.subject ?? '',
    from: payload.from,
    to: parseAddressList(payload.to),
    cc: parseAddressList(payload.cc),
    bodyText: payload.text ?? '',
  };
}

