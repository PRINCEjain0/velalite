import { prisma } from '@/lib/prisma';
import type { ParsedEmail } from '@/types/email';
import type { Thread, ProposedSlot } from '@prisma/client';
import { classifyEmailIntent } from '@/lib/ai';
import { createCalendarEvent } from '@/lib/calendar';
import { getAvailableSlots } from '@/lib/google-calendar';
import { sendEmail } from '@/lib/mailer';

const ASSISTANT_EMAIL = (process.env.ASSISTANT_EMAIL ?? '').toLowerCase();

function extractEmail(address: string): string {
  const match = address.match(/<([^>]+)>/);
  return (match ? match[1] : address).trim().toLowerCase();
}

function formatSlot(date: Date): string {
  return date.toLocaleString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function parseRequestedSlotNumber(body: string): number | null {
  const m = body.match(/\b(?:confirm|book|choose|pick)\s*(?:slot\s*)?(\d+)\b/i) ?? body.match(/\bslot\s*(\d+)\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

function wantsDifferentSlots(body: string): boolean {
  const lower = body.toLowerCase();
  return (
    lower.includes('different slot') ||
    lower.includes('another slot') ||
    lower.includes('other slot') ||
    lower.includes('different time')
  );
}

export async function processIncomingEmail(email: ParsedEmail) {
  const threadIds = (email.threadId ?? '')
    .split(/\s+/)
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  const mainThreadId = threadIds[0] ?? email.messageId;

  const intent = await classifyEmailIntent(email.bodyText);
  const requestedSlotNumber = parseRequestedSlotNumber(email.bodyText);
  const isExplicitConfirm = requestedSlotNumber !== null;
  const fromEmail = extractEmail(email.from);
  const toEmails = email.to.map(extractEmail);
  const ccEmails = email.cc.map(extractEmail);
  const participantEmails = Array.from(new Set([fromEmail, ...toEmails, ...ccEmails]));

  if (intent === 'confirm_slot' || isExplicitConfirm) {
    let existingForConfirm = await prisma.thread.findFirst({
      where: {
        email_thread_id: { in: [...threadIds, email.messageId] } as any,
      },
    });

    if (!existingForConfirm) {
      existingForConfirm = await prisma.thread.findFirst({
        where: {
          status: 'SLOTS_PROPOSED',
          organizer_email: { in: participantEmails } as any,
          guest_email: { in: participantEmails } as any,
        },
        orderBy: { created_at: 'desc' },
      });
    }
    if (!existingForConfirm) {
      return null;
    }
    const existing = existingForConfirm as Thread;

    const pendingSlots = await prisma.proposedSlot.findMany({
      where: {
        thread_id: existing.id,
        status: 'PENDING',
      },
      orderBy: { start_time: 'asc' },
    });

    const selected =
      (requestedSlotNumber ? pendingSlots[requestedSlotNumber - 1] : pendingSlots[0]) as
        | ProposedSlot
        | undefined;
    if (!selected) {
      return existing;
    }

    const event = await createCalendarEvent({
      recruiterEmail: existing.organizer_email,
      guestEmail: existing.guest_email,
      start: selected.start_time,
      end: selected.end_time,
      subject: email.subject,
    });

    await prisma.meeting.create({
      data: {
        thread_id: existing.id,
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
      where: { id: existing.id },
      data: { status: 'MEETING_SCHEDULED' },
    });

    await sendEmail({
      original: email,
      to: [existing.guest_email],
      cc: [existing.organizer_email],
      subject: `Interview confirmed – ${formatSlot(selected.start_time)}`,
      body:
        'Your interview has been scheduled.\n\n' +
        `Date: ${formatSlot(selected.start_time)}\n` +
        `Duration: 1 hour\n`,
    });

    return existing;
  }

  const existingByThreadId = await prisma.thread.findFirst({
    where: {
      email_thread_id: { in: [...threadIds, email.messageId] } as any,
    },
  });

  if (existingByThreadId) {
    if (existingByThreadId.status === 'SLOTS_PROPOSED' && wantsDifferentSlots(email.bodyText)) {
      const freshSlots = await getAvailableSlots(existingByThreadId.organizer_email, { days: 5 });
      const freshSlotData = freshSlots.map((slot) => ({
        thread_id: existingByThreadId.id,
        start_time: new Date(slot.start),
        end_time: new Date(slot.end),
        status: 'PENDING' as const,
      }));
      await prisma.proposedSlot.createMany({ data: freshSlotData });
      const slotsText = freshSlotData
        .map(
          (slot, index) =>
            `${index + 1}. ${formatSlot(slot.start_time)} – ${formatSlot(slot.end_time)}`,
        )
        .join('\n');

      await sendEmail({
        original: email,
        to: [existingByThreadId.guest_email],
        cc: [existingByThreadId.organizer_email],
        subject: `Re: ${email.subject}`,
        body:
          'No problem — here are 3 different 1-hour options:\n\n' +
          `${slotsText}\n\n` +
          'Reply with "confirm [slot number]" (e.g., "confirm 2").',
      });
    }
    return existingByThreadId;
  }

  const organizerEmail = fromEmail;
  const candidateTargets = [...toEmails, ...ccEmails].filter(
    (addr) => addr && addr !== ASSISTANT_EMAIL && addr !== organizerEmail,
  );
  const guestEmail = candidateTargets[0] ?? '';

  const thread = await prisma.thread.create({
    data: {
      email_thread_id: mainThreadId,
      organizer_email: organizerEmail,
      guest_email: guestEmail,
      status: 'NEW_THREAD',
    },
  }) as Thread;

  const slotsFromCalendar = await getAvailableSlots(organizerEmail, { days: 5 });
  const slotData = slotsFromCalendar.map((slot) => ({
    thread_id: thread.id,
    start_time: new Date(slot.start),
    end_time: new Date(slot.end),
    status: 'PENDING' as const,
  }));

  await prisma.proposedSlot.createMany({ data: slotData });
  await prisma.thread.update({
    where: { id: thread.id },
    data: { status: 'SLOTS_PROPOSED' },
  });

  const slotsText = slotData
    .map(
      (slot, index) =>
        `${index + 1}. ${formatSlot(slot.start_time)} – ${formatSlot(slot.end_time)}`,
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
      'Please reply with "confirm [slot number]" (e.g., "confirm 1") to book your preferred option.',
  });

  return thread;
}

