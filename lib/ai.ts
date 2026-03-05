import type { EmailIntent } from '@/types/email';

const GROQ_API_KEY = process.env.GROQ_API_KEY;

function keywordFallback(body: string): EmailIntent {
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

export async function classifyEmailIntent(body: string): Promise<EmailIntent> {
  if (!GROQ_API_KEY) {
    return keywordFallback(body);
  }

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
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
      console.error('Groq API error', await response.text());
      return keywordFallback(body);
    }

    const json: any = await response.json();
    const content: string =
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
    return match ?? keywordFallback(body);
  } catch (error) {
    console.error('Error calling Groq API', error);
    return keywordFallback(body);
  }
}

