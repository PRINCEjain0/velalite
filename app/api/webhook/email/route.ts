import { NextRequest, NextResponse } from 'next/server';
import { parseInboundEmail } from '@/lib/email';
import { processIncomingEmail } from '@/lib/agent';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const raw: Record<string, any> = {};

    for (const [key, value] of formData.entries()) {
      if (typeof value === 'string') {
        raw[key] = value;
      }
    }

    const parsed = parseInboundEmail(raw);

    const thread = await processIncomingEmail(parsed);

    return NextResponse.json({ ok: true, threadId: thread.id });
  } catch (error) {
    console.error('Error handling inbound email webhook', error);
    return NextResponse.json(
      { ok: false, error: 'internal_error' },
      { status: 500 },
    );
  }
}

