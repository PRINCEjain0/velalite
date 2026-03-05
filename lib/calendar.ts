import {
  createCalendarEvent as createGoogleEvent,
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
