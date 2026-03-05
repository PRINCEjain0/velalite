import { prisma } from '@/lib/prisma';
import type { ParsedEmail } from '@/types/email';
import type { Thread, ProposedSlot, Meeting } from '@prisma/client';
import { classifyEmailIntent } from '@/lib/ai';
import { cancelCalendarEvent, createCalendarEvent } from '@/lib/calendar';
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

type AgentAction = 'confirm' | 'cancel' | 'schedule' | 'other';

function latestReplyOnly(body: string): string {
  const normalized = body.replace(/\r\n/g, '\n');
  const separators = [
    '\nOn ',
    '\nFrom:',
    '\n-----Original Message-----',
    '\n>',
  ];
  let cut = normalized.length;
  for (const sep of separators) {
    const idx = normalized.indexOf(sep);
    if (idx !== -1 && idx < cut) cut = idx;
  }
  return normalized.slice(0, cut).trim();
}

function deriveAction(body: string, intent: string, hasSlotNumber: boolean): AgentAction {
  const lower = body.toLowerCase();

  // Prioritize explicit scheduling words over cancel to avoid matching quoted history.
  if (
    lower.includes('reschedule') ||
    lower.includes('schedule') ||
    lower.includes('different slot') ||
    lower.includes('another slot') ||
    lower.includes('new slot')
  ) {
    return 'schedule';
  }

  if (lower.includes('cancel') || lower.includes('call off')) return 'cancel';
  if (
    hasSlotNumber ||
    lower.includes('confirm') ||
    lower.includes('book') ||
    lower.includes('choose') ||
    lower.includes('pick')
  ) {
    return 'confirm';
  }

  if (intent === 'decline') return 'cancel';
  if (intent === 'confirm_slot') return 'confirm';
  if (intent === 'scheduling_request' || intent === 'interview_interest') return 'schedule';
  return 'other';
}

export async function processIncomingEmail(email: ParsedEmail) {
  const threadIds = (email.threadId ?? '')
    .split(/\s+/)
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  const mainThreadId = threadIds[0] ?? email.messageId;

  const latestBody = latestReplyOnly(email.bodyText);
  const intent = await classifyEmailIntent(latestBody);
  const requestedSlotNumber = parseRequestedSlotNumber(latestBody);
  const action = deriveAction(latestBody, intent, requestedSlotNumber !== null);
  const fromEmail = extractEmail(email.from);
  const toEmails = email.to.map(extractEmail);
  const ccEmails = email.cc.map(extractEmail);
  const participantEmails = Array.from(new Set([fromEmail, ...toEmails, ...ccEmails]));

  if (action === 'cancel') {
    let existingForCancel = await prisma.thread.findFirst({
      where: {
        email_thread_id: { in: [...threadIds, email.messageId] } as any,
      },
    });
    if (!existingForCancel) {
      existingForCancel = await prisma.thread.findFirst({
        where: {
          organizer_email: { in: participantEmails } as any,
          guest_email: { in: participantEmails } as any,
          status: 'MEETING_SCHEDULED',
        },
        orderBy: { created_at: 'desc' },
      });
    }

    if (!existingForCancel) {
      await sendEmail({
        original: email,
        to: [fromEmail],
        cc: [],
        subject: `Re: ${email.subject}`,
        body: 'I could not find a scheduled interview to cancel in this thread.',
      });
      return null;
    }

    const existing = existingForCancel as Thread;
    const scheduledMeeting = (await prisma.meeting.findFirst({
      where: {
        thread_id: existing.id,
        status: 'SCHEDULED',
      },
      orderBy: { scheduled_time: 'desc' },
    })) as Meeting | null;

    if (scheduledMeeting) {
      if (scheduledMeeting.calendar_event_id) {
        await cancelCalendarEvent({
          recruiterEmail: existing.organizer_email,
          calendarEventId: scheduledMeeting.calendar_event_id,
        });
      }

      await prisma.meeting.update({
        where: { id: scheduledMeeting.id },
        data: { status: 'CANCELLED' },
      });
    }

    await prisma.thread.update({
      where: { id: existing.id },
      data: { status: 'AWAITING_CONFIRMATION' },
    });

    await sendEmail({
      original: email,
      to: [existing.guest_email],
      cc: [existing.organizer_email],
      subject: 'Interview cancelled',
      body:
        'Your interview has been cancelled.\n\n' +
        'If you would like to continue, reply with "schedule" and I will share new slots.',
    });

    return existing;
  }

  if (action === 'confirm') {
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
      existingForConfirm = await prisma.thread.findFirst({
        where: {
          status: 'SLOTS_PROPOSED',
          guest_email: fromEmail,
        },
        orderBy: { created_at: 'desc' },
      });
    }
    if (!existingForConfirm) {
      await sendEmail({
        original: email,
        to: [fromEmail],
        cc: [],
        subject: `Re: ${email.subject}`,
        body:
          'I could not find an active slot proposal in this thread.\n\n' +
          'Reply with "schedule" and I will send fresh options.',
      });
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

    if (pendingSlots.length === 0) {
      await sendEmail({
        original: email,
        to: [existing.guest_email],
        cc: [existing.organizer_email],
        subject: `Re: ${email.subject}`,
        body:
          'There are no pending slots to confirm in this thread.\n\n' +
          'If you want new options, reply with "different slot".',
      });
      return existing;
    }

    if (requestedSlotNumber && requestedSlotNumber > pendingSlots.length) {
      const pendingText = pendingSlots
        .map(
          (slot, index) =>
            `${index + 1}. ${formatSlot(slot.start_time)} – ${formatSlot(slot.end_time)}`,
        )
        .join('\n');

      await sendEmail({
        original: email,
        to: [existing.guest_email],
        cc: [existing.organizer_email],
        subject: `Re: ${email.subject}`,
        body:
          `I couldn't find slot ${requestedSlotNumber}.\n\n` +
          'Please choose one of the currently available slots:\n' +
          `${pendingText}\n\n` +
          'Reply with "confirm [slot number]" (e.g., "confirm 1").',
      });
      return existing;
    }

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
      subject: `Interview confirmed - ${formatSlot(selected.start_time)}`,
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
    if (
      (existingByThreadId.status === 'AWAITING_CONFIRMATION' ||
        existingByThreadId.status === 'SLOTS_PROPOSED') &&
      action === 'schedule'
    ) {
      const existingSlots = await prisma.proposedSlot.findMany({
        where: { thread_id: existingByThreadId.id },
        orderBy: { start_time: 'asc' },
      });
      const excludeStarts = existingSlots.map((slot) => slot.start_time.toISOString());

      const freshSlots = await getAvailableSlots(existingByThreadId.organizer_email, {
        days: 5,
        excludeStarts,
      });

      const freshSlotData = freshSlots.map((slot) => ({
        thread_id: existingByThreadId.id,
        start_time: new Date(slot.start),
        end_time: new Date(slot.end),
        status: 'PENDING' as const,
      }));
      await prisma.proposedSlot.createMany({ data: freshSlotData });
      await prisma.thread.update({
        where: { id: existingByThreadId.id },
        data: { status: 'SLOTS_PROPOSED' },
      });
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
          'Great — here are new available 1-hour slots:\n\n' +
          `${slotsText}\n\n` +
          'Reply with "confirm [slot number]" (e.g., "confirm 1").',
      });
      return existingByThreadId;
    }
    if (action === 'other') {
      await sendEmail({
        original: email,
        to: [existingByThreadId.guest_email],
        cc: [existingByThreadId.organizer_email],
        subject: `Re: ${email.subject}`,
        body:
          'I can help with:\n' +
          '- "schedule" or "reschedule" for new slots\n' +
          '- "confirm 1" to book a slot\n' +
          '- "cancel" to cancel the interview',
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

