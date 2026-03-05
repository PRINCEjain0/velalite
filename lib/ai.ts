import type { EmailIntent } from '@/types/email';

const GROK_API_KEY = process.env.GROK_API_KEY;

export async function classifyEmailIntent(body: string): Promise<EmailIntent> {
  if (!GROK_API_KEY) {
    const lower = body.toLowerCase();
    if (
      lower.includes('confirm') ||
      lower.includes('works') ||
      lower.includes('book') ||
      lower.includes('slot') ||
      lower.includes('1st') ||
      lower.includes('first')
    ) {
      return 'confirm_slot';
    }
    if (lower.includes('schedule') || lower.includes('availability')) {
      return 'scheduling_request';
    }
    if (lower.includes('interview') || lower.includes('interested')) {
      return 'interview_interest';
    }
    if (lower.includes('cancel') || lower.includes('decline')) {
      return 'decline';
    }
    return 'other';
  }

  try {
    
    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'grok-2-latest',
        messages: [
          {
            role: 'system',
            content:
              'You classify email intent for interview scheduling. ' +
              'Reply with ONLY one word from this set: ' +
              'interview_interest, scheduling_request, confirm_slot, decline, other.',
          },
          {
            role: 'user',
            content: `Email:\n${body}`,
          },
        ],
        temperature: 0,
        max_tokens: 10,
      }),
    });

    if (!response.ok) {
      console.error('Grok API error', await response.text());
      return 'other';
    }

    const json: any = await response.json();
    const content: string =
      json.choices?.[0]?.message?.content?.[0]?.text ??
      json.choices?.[0]?.message?.content ??
      '';

    const normalized = content.trim().toLowerCase();

    const allowed: EmailIntent[] = [
      'interview_interest',
      'scheduling_request',
      'confirm_slot',
      'decline',
      'other',
    ];

    const match = allowed.find((value) => normalized.includes(value));
    return match ?? 'other';
  } catch (error) {
    console.error('Error calling Grok API', error);
    return 'other';
  }
}

