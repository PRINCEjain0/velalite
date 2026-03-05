import { NextRequest, NextResponse } from 'next/server';
import { processUnreadAgentInbox } from '@/lib/gmail';

export async function POST(_req: NextRequest) {
  try {
    const result = await processUnreadAgentInbox();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error polling Gmail inbox', error);
    return NextResponse.json({ ok: false, error: 'internal_error' }, { status: 500 });
  }
}

