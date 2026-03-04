import { prisma } from '@/lib/prisma';
import type { ParsedEmail } from '@/types/email';
import { classifyEmailIntent } from '@/lib/ai';
import { createCalendarEvent } from '@/lib/calendar';
import { sendEmail } from '@/lib/mailer';


export async function processIncomingEmail(email: ParsedEmail) {
  // Use threadId (In-Reply-To / References) if present, otherwise fall back to messageId
  const emailThreadId = email.threadId ?? email.messageId;

  const intent = await classifyEmailIntent(email.bodyText);

  if (intent === 'confirm_slot') {
    // Find existing thread.
    const existingForConfirm = await prisma.thread.findFirst({
      where: { email_thread_id: emailThreadId },
    });
    if (!existingForConfirm) {
      return null;
    }

    // Very simple matching: pick the earliest pending slot.
    const pendingSlots = await prisma.proposedSlot.findMany({
      where: {
        thread_id: existingForConfirm.id,
        status: 'PENDING',
      },
      orderBy: { start_time: 'asc' },
    });

    const selected = pendingSlots[0];
    if (!selected) {
      return existingForConfirm;
    }

    const event = await createCalendarEvent({
      recruiterEmail: existingForConfirm.organizer_email,
      guestEmail: existingForConfirm.guest_email,
      start: selected.start_time,
      end: selected.end_time,
      subject: email.subject,
    });

    await prisma.meeting.create({
      data: {
        thread_id: existingForConfirm.id,
        calendar_event_id: event.calendarEventId,
        scheduled_time: selected.start_time,
        status: 'SCHEDULED',
      },
    });

    await prisma.proposedSlot.update({
      where: { id: selected.id },
      data: { status: 'CONFIRMED' },
    });

    await prisma.thread.update({
      where: { id: existingForConfirm.id },
      data: { status: 'MEETING_SCHEDULED' },
    });

    await sendEmail({
      original: email,
      to: [existingForConfirm.guest_email],
      cc: [existingForConfirm.organizer_email],
      subject: `Interview confirmed – ${selected.start_time.toISOString()}`,
      body:
        'Your interview has been scheduled.\n\n' +
        `Start: ${selected.start_time.toISOString()}\n` +
        `End: ${selected.end_time.toISOString()}\n`,
    });

    return existingForConfirm;
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
  await prisma.thread.update({
    where: { id: thread.id },
    data: { status: 'SLOTS_PROPOSED' },
  });

  const slotsText = slotData
    .map(
      (slot, index) =>
        `${index + 1}. ${slot.start_time.toISOString()} – ${slot.end_time.toISOString()}`,
    )
    .join('\n');

  await sendEmail({
    original: email,
    to: [guestEmail],
    cc: [organizerEmail],
    subject: `Re: ${email.subject}`,
    body:
      'Thanks for your interest in interviewing.\n\n' +
      'Here are some available 1-hour slots:\n' +
      `${slotsText}\n\n` +
      'Please reply with your preferred option.',
  });

  return thread;
}

