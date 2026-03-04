import { prisma } from '@/lib/prisma';
import type { ParsedEmail } from '@/types/email';
import { classifyEmailIntent } from '@/lib/ai';


export async function processIncomingEmail(email: ParsedEmail) {
  // Use threadId (In-Reply-To / References) if present, otherwise fall back to messageId
  const emailThreadId = email.threadId ?? email.messageId;

  const intent = await classifyEmailIntent(email.bodyText);

  if (intent === 'confirm_slot') {
    // TODO: handle confirmation / booking flow.
    // For now, just return existing thread if any.
    const existingForConfirm = await prisma.thread.findFirst({
      where: { email_thread_id: emailThreadId },
    });
    return existingForConfirm ?? null;
  }

  const existing = await prisma.thread.findFirst({
    where: { email_thread_id: emailThreadId },
  });

  if (existing) {
    return existing;
  }

  // For now, assume the first address in "to" is the recruiter/organizer
  const organizerEmail = email.to[0] ?? '';
  const guestEmail = email.from;

  const thread = await prisma.thread.create({
    data: {
      email_thread_id: emailThreadId,
      organizer_email: organizerEmail,
      guest_email: guestEmail,
      status: 'NEW_THREAD',
    },
  });

  const now = new Date();
  const baseDay = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    10,
    0,
    0,
  );

  const slotData = Array.from({ length: 3 }).map((_, index) => {
    const start = new Date(baseDay);
    start.setDate(baseDay.getDate() + index);
    const end = new Date(start);
    end.setHours(end.getHours() + 1);
    return {
      thread_id: thread.id,
      start_time: start,
      end_time: end,
      status: 'PENDING' as const,
    };
  });

  await prisma.proposedSlot.createMany({ data: slotData });

  return thread;
}

