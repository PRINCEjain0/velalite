import { prisma } from '@/lib/prisma';
import type { ParsedEmail } from '@/types/email';
import type { Thread, ProposedSlot, Meeting } from '@prisma/client';
import { chooseProposedSlotIndex, classifyEmailIntent } from '@/lib/ai';
import { cancelCalendarEvent, createCalendarEvent } from '@/lib/calendar';
import { getAvailableSlots } from '@/lib/google-calendar';
import { sendEmail } from '@/lib/mailer';
import { getRecruiterCalendarClient } from '@/lib/recruiter-calendar';

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

function formatSlotLine(start: Date, end: Date): string {
  const timeZone = process.env.VELALITE_TIME_ZONE ?? 'Asia/Kolkata';
  const tzLabel =
    timeZone === 'Asia/Kolkata' ? 'IST' : timeZone === 'America/Los_Angeles' ? 'PT' : timeZone;

  const day = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(start);

  const startRaw = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(start);
  const startTime = startRaw.replace(/\s?(AM|PM)$/i, '').trim();

  const endTime = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(end);

  return `${day} · ${startTime}-${endTime} ${tzLabel}`;
}

function parseRequestedSlotNumber(body: string): number | null {
  const text = body.trim();

  const m =
    // "book slot 2", "confirm 2", "choose option 3"
    text.match(
      /\b(?:confirm|book|choose|pick)\b[\s:,-]*(?:(?:slot|option)\b[\s#:-]*)?(\d+)\b/i,
    ) ??
    // "slot 2", "option #2"
    text.match(/\b(?:slot|option)\b[\s#:-]*(\d+)\b/i) ??
    // reply is just "2"
    text.match(/^\s*(\d+)\s*$/);

  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

function parseOrdinalSlotNumber(body: string): number | null {
  const lower = body.toLowerCase();
  if (/\b(1st|first)\b/.test(lower)) return 1;
  if (/\b(2nd|second)\b/.test(lower)) return 2;
  if (/\b(3rd|third)\b/.test(lower)) return 3;
  return null;
}

function nameFromEmailAddress(email: string): string {
  const local = email.split('@')[0] ?? 'there';
  const withoutDigits = local.replace(/\d+/g, ' ');
  const cleaned = withoutDigits.replace(/[._-]+/g, ' ').trim();
  const first = cleaned.split(/\s+/)[0] ?? 'there';
  return first.length > 0 ? first[0].toUpperCase() + first.slice(1) : 'there';
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
  const requestedSlotNumber = parseRequestedSlotNumber(latestBody) ?? parseOrdinalSlotNumber(latestBody);
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
    console.log('confirm: parsed slot request', {
      fromEmail,
      requestedSlotNumber,
      intent,
      subject: email.subject,
      latestBody: latestBody.slice(0, 200),
    });

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
        .map((slot) => `- ${formatSlotLine(slot.start_time, slot.end_time)}`)
        .join('\n');

      await sendEmail({
        original: email,
        to: [existing.guest_email],
        cc: [existing.organizer_email],
        subject: `Re: ${email.subject}`,
        body:
          `I couldn't match that to one of the options.\n\n` +
          'Here are the current slots again:\n' +
          `${pendingText}\n\n` +
          'Just reply with the time that works best for you (for example: "Tue 10am works").',
      });
      return existing;
    }

    let chosenIndex = requestedSlotNumber;
    if (!chosenIndex) {
      const slotsForAi = pendingSlots.slice(0, 3).map((s, i) => ({
        index: i + 1,
        label: formatSlotLine(s.start_time, s.end_time),
        startIso: s.start_time.toISOString(),
        endIso: s.end_time.toISOString(),
      }));
      const aiChoice = await chooseProposedSlotIndex({ body: latestBody, slots: slotsForAi });
      if (aiChoice && aiChoice >= 1 && aiChoice <= pendingSlots.length) {
        chosenIndex = aiChoice;
      }
    }

    if (!chosenIndex) {
      const pendingText = pendingSlots
        .slice(0, 3)
        .map((slot) => `- ${formatSlotLine(slot.start_time, slot.end_time)}`)
        .join('\n');

      await sendEmail({
        original: email,
        to: [existing.guest_email],
        cc: [existing.organizer_email],
        subject: `Re: ${email.subject}`,
        body:
          "Got it — which of the options should I book?\n\n" +
          `${pendingText}\n\n` +
          "Reply with the time you prefer (for example: \"Wed 2pm works\"), or share your availability and I’ll find another time.",
      });
      return existing;
    }

    const selected =
      (chosenIndex ? pendingSlots[chosenIndex - 1] : pendingSlots[0]) as ProposedSlot | undefined;
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

    // Rely on Google Calendar's own invite email/card.
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
      const recruiterCal = await getRecruiterCalendarClient(existingByThreadId.organizer_email);

      const existingSlots = await prisma.proposedSlot.findMany({
        where: { thread_id: existingByThreadId.id },
        orderBy: { start_time: 'asc' },
      });
      const excludeStarts = existingSlots.map((slot) => slot.start_time.toISOString());

      const freshSlots = await getAvailableSlots(existingByThreadId.organizer_email, {
        days: 5,
        excludeStarts,
      }, recruiterCal ?? undefined);

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
        .map((slot) => `- ${formatSlotLine(slot.start_time, slot.end_time)}`)
        .join('\n');

      await sendEmail({
        original: email,
        to: [existingByThreadId.guest_email],
        cc: [existingByThreadId.organizer_email],
        subject: `Re: ${email.subject}`,
        body:
          `Hi ${nameFromEmailAddress(existingByThreadId.guest_email)},\n\n` +
          "I'm coordinating your round with the team. Based on everyone's availability, here are 3 options:\n\n" +
          `${slotsText}\n\n` +
          "Which works best for you? If none of these work, just share your availability and I'll find another time.",
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
          '- pick one of the proposed times (for example: "Tue 10am works")\n' +
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

  const recruiterCal = await getRecruiterCalendarClient(organizerEmail);
  const slotsFromCalendar = await getAvailableSlots(
    organizerEmail,
    { days: 5 },
    recruiterCal ?? undefined,
  );
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
    .map((slot) => `- ${formatSlotLine(slot.start_time, slot.end_time)}`)
    .join('\n');

  await sendEmail({
    original: email,
    to: [guestEmail],
    cc: [organizerEmail],
    subject: `Re: ${email.subject}`,
    body:
      `Hi ${nameFromEmailAddress(guestEmail)},\n\n` +
      "I'm coordinating your round with the team. Based on everyone's availability, here are 3 options:\n\n" +
      `${slotsText}\n\n` +
      "Which works best for you? If none of these work, just share your availability and I'll find another time.",
  });

  return thread;
}

