import {
  createCalendarEvent as createGoogleEvent,
  cancelCalendarEvent as cancelGoogleEvent,
} from '@/lib/google-calendar';

type CreateEventParamsLegacy = {
  recruiterEmail: string;
  guestEmail: string;
  start: Date;
  end: Date;
  subject: string;
};

export async function createCalendarEvent(params: CreateEventParamsLegacy): Promise<{
  calendarEventId: string;
}> {
  return createGoogleEvent({
    calendarId: params.recruiterEmail,
    guestEmail: params.guestEmail,
    start: params.start,
    end: params.end,
    summary: params.subject,
  });
}

type CancelEventParamsLegacy = {
  recruiterEmail: string;
  calendarEventId: string;
};

export async function cancelCalendarEvent(params: CancelEventParamsLegacy): Promise<void> {
  await cancelGoogleEvent({
    calendarId: params.recruiterEmail,
    calendarEventId: params.calendarEventId,
  });
}
