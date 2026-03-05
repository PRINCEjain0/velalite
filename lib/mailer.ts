import type { ParsedEmail } from '@/types/email';

import { sendViaGmail } from '@/lib/gmail-send';
import { getAssistantEmail } from '@/lib/gmail-client';

const ASSISTANT_EMAIL = getAssistantEmail() ?? 'agent@velalite.app';

type SendParams = {
  original: ParsedEmail;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
};

// Simple wrapper that logs in dev if no API key is configured.
export async function sendEmail({
  original,
  to,
  cc,
  subject,
  body,
}: SendParams) {
  const result = await sendViaGmail({
    to,
    cc,
    subject,
    body,
    headers: {
      'In-Reply-To': original.messageId,
      References: original.threadId ?? original.messageId,
    },
  });

  if (!result.ok) {
    console.log('sendEmail (dry-run)', {
      from: ASSISTANT_EMAIL,
      to,
      cc,
      subject,
      body,
      reason: result.reason,
    });
  }
}

