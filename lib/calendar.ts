import {
  createCalendarEvent as createGoogleEvent,
  cancelCalendarEvent as cancelGoogleEvent,
} from '@/lib/google-calendar';
import { getRecruiterCalendarClient } from '@/lib/recruiter-calendar';

type CreateEventParamsLegacy = {
  recruiterEmail: string;
  guestEmail: string;
  start: Date;
  end: Date;
  subject: string;
};

export async function createCalendarEvent(params: CreateEventParamsLegacy): Promise<{
  calendarEventId: string;
  invited: boolean;
  hangoutLink: string | null;
  htmlLink: string | null;
}> {
  const recruiterCal = await getRecruiterCalendarClient(params.recruiterEmail);

  return createGoogleEvent(
    {
      calendarId: params.recruiterEmail,
      guestEmail: params.guestEmail,
      start: params.start,
      end: params.end,
      summary: params.subject,
    },
    recruiterCal ?? undefined,
  );
}

type CancelEventParamsLegacy = {
  recruiterEmail: string;
  calendarEventId: string;
};

export async function cancelCalendarEvent(params: CancelEventParamsLegacy): Promise<void> {
  const recruiterCal = await getRecruiterCalendarClient(params.recruiterEmail);

  await cancelGoogleEvent(
    {
      calendarId: params.recruiterEmail,
      calendarEventId: params.calendarEventId,
    },
    recruiterCal ?? undefined,
  );
}
