import { NextRequest, NextResponse } from 'next/server';
import { parseInboundEmail, type InboundPayload } from '@/lib/email';
import { processIncomingEmail } from '@/lib/agent';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const raw: Partial<InboundPayload> = {};

    for (const [key, value] of formData.entries()) {
      if (typeof value === 'string') {
        (raw as any)[key] = value;
      }
    }

    const parsed = parseInboundEmail(raw as InboundPayload);

    const thread = await processIncomingEmail(parsed);

    return NextResponse.json({
      ok: true,
      threadId: thread?.id ?? null,
    });
  } catch (error) {
    console.error('Error handling inbound email webhook', error);
    return NextResponse.json(
      { ok: false, error: 'internal_error' },
      { status: 500 },
    );
  }
}

