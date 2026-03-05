import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
];

function loadCredentials(): unknown {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (keyPath) {
    try {
      const path = resolve(process.cwd(), keyPath);
      const json = readFileSync(path, 'utf-8');
      return JSON.parse(json);
    } catch (e) {
      console.error('Failed to read GOOGLE_APPLICATION_CREDENTIALS file:', (e as Error).message);
      return undefined;
    }
  }

  if (!raw) return undefined;

  const key = raw.trim().replace(/^["']|["']$/g, '');
  if (key.startsWith('{')) {
    try {
      return JSON.parse(key);
    } catch (e) {
      console.error(
        'GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON. Use a single-line JSON string or set GOOGLE_APPLICATION_CREDENTIALS to a key file path.'
      );
      return undefined;
    }
  }

  try {
    const path = resolve(process.cwd(), key);
    const json = readFileSync(path, 'utf-8');
    return JSON.parse(json);
  } catch (e) {
    console.error('Failed to read GOOGLE_SERVICE_ACCOUNT_JSON as file path:', (e as Error).message);
    return undefined;
  }
}

function getAuth() {
  const credentials = loadCredentials();
  if (!credentials) return null;
  return new google.auth.GoogleAuth({
    credentials,
    scopes: SCOPES,
  });
}

function getServiceAccountEmail(): string | null {
  const creds = loadCredentials();
  if (creds && typeof creds === 'object' && 'client_email' in creds && typeof (creds as { client_email: string }).client_email === 'string') {
    return (creds as { client_email: string }).client_email;
  }
  return null;
}

export function getCalendarClient() {
  const auth = getAuth();
  if (!auth) return null;
  return google.calendar({ version: 'v3', auth });
}

export interface CalendarSlot {
  start: string;
  end: string;
}

export async function getAvailableSlots(
  recruiterCalendarId: string,
  options: { days?: number; slotDurationHours?: number } = {}
): Promise<CalendarSlot[]> {
  const calendar = getCalendarClient();
  if (!calendar) {
    console.log('getAvailableSlots: no Google credentials, using placeholder slots');
    return getPlaceholderSlots();
  }

  const { days = 5, slotDurationHours = 1 } = options;
  const now = new Date();
  const timeMin = new Date(now);
  timeMin.setMinutes(0, 0, 0);
  const timeMax = new Date(timeMin);
  timeMax.setDate(timeMax.getDate() + days);

  try {
    console.log('getAvailableSlots: querying Google Calendar freebusy', {
      calendarId: recruiterCalendarId,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
    });
    const res = await calendar.freebusy.query({
      requestBody: {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        items: [{ id: recruiterCalendarId }],
      },
    });

    const busy = res.data.calendars?.[recruiterCalendarId]?.busy ?? [];
    console.log('getAvailableSlots: freebusy returned', {
      calendarId: recruiterCalendarId,
      busyCount: busy.length,
      busySample: busy.slice(0, 5).map((b) => ({ start: b.start, end: b.end })),
    });
    const freeSlots: CalendarSlot[] = [];
    const slotMs = slotDurationHours * 60 * 60 * 1000;
    let cursor = new Date(timeMin);
    if (cursor <= now) {
      cursor = new Date(now);
      cursor.setMinutes(Math.ceil(cursor.getMinutes() / 30) * 30, 0, 0);
    }

    while (freeSlots.length < 3 && cursor.getTime() + slotMs <= timeMax.getTime()) {
      const slotStart = new Date(cursor);
      const slotEnd = new Date(cursor.getTime() + slotMs);
      const isFree = !busy.some((b) => {
        const bStart = new Date(b.start!).getTime();
        const bEnd = new Date(b.end!).getTime();
        return slotStart.getTime() < bEnd && slotEnd.getTime() > bStart;
      });
      if (isFree) {
        freeSlots.push({
          start: slotStart.toISOString(),
          end: slotEnd.toISOString(),
        });
      }
      cursor.setTime(cursor.getTime() + 30 * 60 * 1000);
    }

    console.log('getAvailableSlots: computed slots', {
      calendarId: recruiterCalendarId,
      slotCount: freeSlots.length,
      slots: freeSlots.map((s) => ({ start: s.start, end: s.end })),
    });

    return freeSlots.length > 0 ? freeSlots : getPlaceholderSlots();
  } catch (err) {
    console.error('Google Calendar freebusy error', err);
    return getPlaceholderSlots();
  }
}

function getPlaceholderSlots(): CalendarSlot[] {
  const base = new Date();
  base.setDate(base.getDate() + 1);
  base.setHours(10, 0, 0, 0);
  return [0, 1, 2].map((i) => {
    const start = new Date(base);
    start.setDate(base.getDate() + i);
    const end = new Date(start);
    end.setHours(end.getHours() + 1);
    return { start: start.toISOString(), end: end.toISOString() };
  });
}

export interface CreateEventParams {
  calendarId: string;
  guestEmail: string;
  start: Date;
  end: Date;
  summary: string;
}

export interface CancelEventParams {
  calendarId: string;
  calendarEventId: string;
}

export async function createCalendarEvent(
  params: CreateEventParams
): Promise<{ calendarEventId: string }> {
  const calendar = getCalendarClient();
  if (!calendar) {
    console.log('createCalendarEvent (no credentials)', params);
    return { calendarEventId: `placeholder-${Date.now()}` };
  }

  const { calendarId, guestEmail, start, end, summary } = params;
  try {
    const res = await calendar.events.insert({
      calendarId,
      requestBody: {
        summary,
        start: {
          dateTime: start.toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        end: {
          dateTime: end.toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        attendees: [{ email: guestEmail }],
      },
      sendUpdates: 'all',
    });
    const id = res.data.id ?? `event-${Date.now()}`;
    return { calendarEventId: id };
  } catch (err: any) {
    const status: number | undefined = err?.code ?? err?.status;
    const message: string = err?.errors?.[0]?.message ?? err?.message ?? '';

    if (
      status === 403 &&
      message.includes('Service accounts cannot invite attendees without Domain-Wide Delegation')
    ) {
      console.warn(
        'createCalendarEvent: attendee invite not allowed for this service account; retrying without attendees.'
      );
      const fallbackRes = await calendar.events.insert({
        calendarId,
        requestBody: {
          summary,
          start: {
            dateTime: start.toISOString(),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
          end: {
            dateTime: end.toISOString(),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
        },
      });
      const id = fallbackRes.data.id ?? `event-${Date.now()}`;
      return { calendarEventId: id };
    }

    if (status === 404) {
      const saEmail = getServiceAccountEmail();
      console.error(
        `Google Calendar 404: Calendar "${calendarId}" not found or not shared with the service account.`,
        saEmail
          ? `The recruiter must share their Google Calendar with: ${saEmail}`
          : 'Check GOOGLE_APPLICATION_CREDENTIALS and that the calendar is shared with that account.'
      );
    } else {
      console.error('Google Calendar create event error', err);
    }
    throw err;
  }
}

export async function cancelCalendarEvent(params: CancelEventParams): Promise<void> {
  const calendar = getCalendarClient();
  if (!calendar) {
    console.log('cancelCalendarEvent (no credentials)', params);
    return;
  }

  try {
    await calendar.events.delete({
      calendarId: params.calendarId,
      eventId: params.calendarEventId,
      sendUpdates: 'all',
    });
  } catch (err: any) {
    const status: number | undefined = err?.code ?? err?.status;
    if (status === 404) {
      return;
    }
    console.error('Google Calendar cancel event error', err);
    throw err;
  }
}
