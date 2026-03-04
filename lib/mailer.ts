import type { ParsedEmail } from '@/types/email';

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const ASSISTANT_EMAIL = process.env.ASSISTANT_EMAIL ?? 'agent@velalite.app';

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
  if (!SENDGRID_API_KEY) {
    console.log('sendEmail (dry-run)', {
      from: ASSISTANT_EMAIL,
      to,
      cc,
      subject,
      body,
    });
    return;
  }

  const sgMail = await import('@sendgrid/mail');
  sgMail.default.setApiKey(SENDGRID_API_KEY);

  await sgMail.default.send({
    from: ASSISTANT_EMAIL,
    to,
    cc,
    subject,
    text: body,
    headers: {
      'In-Reply-To': original.messageId,
      References: original.threadId ?? original.messageId,
    },
  } as any);
}

