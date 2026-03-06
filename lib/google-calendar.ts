import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
];

const OAUTH_CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const OAUTH_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
// Per‑recruiter refresh tokens are stored in the database; this
// env is only used as a fallback single-account mode.
const OAUTH_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN;

function loadServiceAccountCredentials(): unknown {
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

function getServiceAccountAuth() {
  const credentials = loadServiceAccountCredentials();
  if (!credentials) return null;
  return new google.auth.GoogleAuth({
    credentials,
    scopes: SCOPES,
  });
}

function getServiceAccountEmail(): string | null {
  const creds = loadServiceAccountCredentials();
  if (creds && typeof creds === 'object' && 'client_email' in creds && typeof (creds as { client_email: string }).client_email === 'string') {
    return (creds as { client_email: string }).client_email;
  }
  return null;
}

export function getCalendarClient() {
  const auth = getServiceAccountAuth();
  if (!auth) return null;
  return google.calendar({ version: 'v3', auth });
}

export interface CalendarSlot {
  start: string;
  end: string;
}

export interface GetAvailableSlotsOptions {
  days?: number;
  slotDurationHours?: number;
  /**
   * Optional list of ISO start times that should be excluded
   * from the returned slots (used when a candidate asks for
   * different / new options so we do not repeat the same ones).
   */
  excludeStarts?: string[];
  /**
   * Timezone used for "business hours" slot search.
   * Defaults to Asia/Kolkata.
   */
  timeZone?: string;
}

function getTimeZone() {
  return process.env.VELALITE_TIME_ZONE ?? 'Asia/Kolkata';
}

function getZonedParts(date: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

function zonedTimeToUtc(
  input: { year: number; month: number; day: number; hour: number; minute: number; second?: number },
  timeZone: string,
): Date {
  const second = input.second ?? 0;
  const targetAsUTC = Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute, second);
  const guess = new Date(targetAsUTC);
  const got = getZonedParts(guess, timeZone);
  const gotAsUTC = Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute, got.second);
  const diff = gotAsUTC - targetAsUTC;
  return new Date(guess.getTime() - diff);
}

export async function getAvailableSlots(
  recruiterCalendarId: string,
  options: GetAvailableSlotsOptions = {},
  calendarOverride?: ReturnType<typeof google.calendar>,
): Promise<CalendarSlot[]> {
  const calendar = calendarOverride ?? getCalendarClient();
  if (!calendar) {
    console.log('getAvailableSlots: no Google credentials, using placeholder slots');
    return getPlaceholderSlots();
  }

  const { days = 5, slotDurationHours = 1, excludeStarts = [], timeZone = getTimeZone() } = options;

  const calendarId = recruiterCalendarId;

  const now = new Date();
  const nowZoned = getZonedParts(now, timeZone);
  const timeMin = zonedTimeToUtc(
    { year: nowZoned.year, month: nowZoned.month, day: nowZoned.day + 1, hour: 9, minute: 0, second: 0 },
    timeZone,
  );
  const timeMax = new Date(timeMin);
  timeMax.setUTCDate(timeMax.getUTCDate() + days);

  try {
    console.log('getAvailableSlots: querying Google Calendar freebusy', {
      requestedCalendarId: recruiterCalendarId,
      effectiveCalendarId: calendarId,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
    });
    const res = await calendar.freebusy.query({
      requestBody: {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        items: [{ id: calendarId }],
      },
    });

    const busy = res.data.calendars?.[calendarId]?.busy ?? [];
    console.log('getAvailableSlots: freebusy returned', {
      calendarId: recruiterCalendarId,
      busyCount: busy.length,
      busySample: busy.slice(0, 5).map((b) => ({ start: b.start, end: b.end })),
    });
    const freeSlots: CalendarSlot[] = [];
    const excludeMs = new Set(
      excludeStarts.map((iso) => {
        try {
          return new Date(iso).getTime();
        } catch {
          return NaN;
        }
      }),
    );
    const slotMs = slotDurationHours * 60 * 60 * 1000;
    const WORK_START_HOUR = 9;
    const WORK_END_HOUR = 17;
    const STEP_MS = 30 * 60 * 1000;

    // Return 3 slots scattered across upcoming days (one per day),
    // instead of 3 consecutive slots on the same day.
    for (let dayOffset = 0; dayOffset < days && freeSlots.length < 3; dayOffset += 1) {
      const seed = new Date(Date.UTC(nowZoned.year, nowZoned.month - 1, nowZoned.day + 1 + dayOffset, 12, 0, 0));
      const day = getZonedParts(seed, timeZone);

      const dayStart = zonedTimeToUtc(
        { year: day.year, month: day.month, day: day.day, hour: WORK_START_HOUR, minute: 0, second: 0 },
        timeZone,
      );
      const dayEnd = zonedTimeToUtc(
        { year: day.year, month: day.month, day: day.day, hour: WORK_END_HOUR, minute: 0, second: 0 },
        timeZone,
      );

      for (let cursor = new Date(dayStart); freeSlots.length < 3 && cursor.getTime() + slotMs <= dayEnd.getTime(); ) {
        const slotStart = new Date(cursor);
        const slotEnd = new Date(cursor.getTime() + slotMs);
        const startMs = slotStart.getTime();

        const isFree =
          !busy.some((b) => {
            const bStart = new Date(b.start!).getTime();
            const bEnd = new Date(b.end!).getTime();
            return startMs < bEnd && slotEnd.getTime() > bStart;
          }) && !excludeMs.has(startMs);

        if (isFree) {
          freeSlots.push({ start: slotStart.toISOString(), end: slotEnd.toISOString() });
          break; // one slot per day
        }

        cursor = new Date(cursor.getTime() + STEP_MS);
      }
    }

    console.log('getAvailableSlots: computed slots', {
      requestedCalendarId: recruiterCalendarId,
      effectiveCalendarId: calendarId,
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
  params: CreateEventParams,
  calendarOverride?: ReturnType<typeof google.calendar>,
): Promise<{
  calendarEventId: string;
  invited: boolean;
  hangoutLink: string | null;
  htmlLink: string | null;
}> {
  const calendar = calendarOverride ?? getCalendarClient();
  if (!calendar) {
    console.log('createCalendarEvent (no credentials)', params);
    return {
      calendarEventId: `placeholder-${Date.now()}`,
      invited: false,
      hangoutLink: null,
      htmlLink: null,
    };
  }

  const { calendarId, guestEmail, start, end, summary } = params;
  const timeZone = process.env.VELALITE_TIME_ZONE ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const requestId = `velalite-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const cal = calendar;
  const targetCalendarId = calendarId;

  async function insertEvent(args: {
    withAttendees: boolean;
    withConference: boolean;
    sendUpdates?: 'all' | 'externalOnly' | 'none';
  }) {
    return await cal.events.insert({
      calendarId: targetCalendarId,
      conferenceDataVersion: args.withConference ? 1 : undefined,
      requestBody: {
        summary,
        start: { dateTime: start.toISOString(), timeZone },
        end: { dateTime: end.toISOString(), timeZone },
        ...(args.withAttendees ? { attendees: [{ email: guestEmail }] } : {}),
        ...(args.withConference
          ? {
              conferenceData: {
                createRequest: {
                  requestId,
                  conferenceSolutionKey: { type: 'hangoutsMeet' },
                },
              },
            }
          : {}),
      },
      sendUpdates: args.sendUpdates,
    });
  }

  try {
    let res;
    try {
      res = await insertEvent({ withAttendees: true, withConference: true, sendUpdates: 'all' });
    } catch (e: any) {
      const msg: string = e?.errors?.[0]?.message ?? e?.message ?? '';
      const code: number | undefined = e?.code ?? e?.status;
      if (code === 400 && msg.toLowerCase().includes('invalid conference type value')) {
        console.warn('createCalendarEvent: Meet conference not allowed; retrying without Meet link.');
        res = await insertEvent({ withAttendees: true, withConference: false, sendUpdates: 'all' });
      } else {
        throw e;
      }
    }
    const id = res.data.id ?? `event-${Date.now()}`;
    return {
      calendarEventId: id,
      invited: true,
      hangoutLink: res.data.hangoutLink ?? null,
      htmlLink: res.data.htmlLink ?? null,
    };
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
      let fallbackRes;
      try {
        fallbackRes = await insertEvent({ withAttendees: false, withConference: true });
      } catch (e: any) {
        const msg: string = e?.errors?.[0]?.message ?? e?.message ?? '';
        const code: number | undefined = e?.code ?? e?.status;
        if (code === 400 && msg.toLowerCase().includes('invalid conference type value')) {
          console.warn('createCalendarEvent: Meet conference not allowed; retrying without Meet link.');
          fallbackRes = await insertEvent({ withAttendees: false, withConference: false });
        } else {
          throw e;
        }
      }
      const id = fallbackRes.data.id ?? `event-${Date.now()}`;
      return {
        calendarEventId: id,
        invited: false,
        hangoutLink: fallbackRes.data.hangoutLink ?? null,
        htmlLink: fallbackRes.data.htmlLink ?? null,
      };
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

export async function cancelCalendarEvent(
  params: CancelEventParams,
  calendarOverride?: ReturnType<typeof google.calendar>,
): Promise<void> {
  const calendar = calendarOverride ?? getCalendarClient();
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
