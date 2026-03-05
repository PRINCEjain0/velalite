import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  getAvailableSlots,
  createCalendarEvent,
  cancelCalendarEvent,
} from './lib/google-calendar';

const checkAvailabilityShape = {
  recruiterEmail: z
    .string()
    .describe('Recruiter Google Calendar ID (usually their email address).'),
  days: z
    .number()
    .int()
    .min(1)
    .max(14)
    .optional()
    .describe('How many days ahead to search (default 5).'),
  slotDurationHours: z
    .number()
    .int()
    .min(1)
    .max(4)
    .optional()
    .describe('Length of each interview slot in hours (default 1).'),
};

const checkAvailabilitySchema = z.object(checkAvailabilityShape).strip();

const scheduleInterviewShape = {
  recruiterEmail: z
    .string()
    .describe('Recruiter Google Calendar ID (usually their email address).'),
  candidateEmail: z
    .string()
    .email()
    .describe('Candidate email to invite.'),
  start: z.string().describe('ISO timestamp for interview start.'),
  end: z.string().describe('ISO timestamp for interview end.'),
  summary: z
    .string()
    .default('Interview')
    .describe('Title shown on the calendar event.'),
};

const scheduleInterviewSchema = z.object(scheduleInterviewShape).strip();

const cancelInterviewShape = {
  recruiterEmail: z
    .string()
    .describe('Recruiter Google Calendar ID (usually their email address).'),
  calendarEventId: z
    .string()
    .describe('The event id to cancel.'),
};

const cancelInterviewSchema = z.object(cancelInterviewShape).strip();

type CheckAvailabilityInput = z.infer<typeof checkAvailabilitySchema>;
type ScheduleInterviewInput = z.infer<typeof scheduleInterviewSchema>;
type CancelInterviewInput = z.infer<typeof cancelInterviewSchema>;

const server = new McpServer({
  name: 'velalite-calendar-mcp',
  version: '0.1.0',
});

server.tool(
  'check_availability',
  checkAvailabilityShape,
  async (input: CheckAvailabilityInput) => {
    console.log('[MCP] check_availability called', {
      recruiterEmail: input.recruiterEmail,
      days: input.days,
      slotDurationHours: input.slotDurationHours,
    });

    const slots = await getAvailableSlots(input.recruiterEmail, {
      days: input.days,
      slotDurationHours: input.slotDurationHours,
    });

    return {
      content: [
        {
          type: 'text',
          text:
            slots.length === 0
              ? 'No slots available.'
              : slots
                  .map(
                    (s, idx) =>
                      `${idx + 1}. ${new Date(s.start).toISOString()} – ${new Date(
                        s.end,
                      ).toISOString()}`,
                  )
                  .join('\n'),
        },
      ],
    };
  },
);

server.tool(
  'schedule_interview',
  scheduleInterviewShape,
  async (input: ScheduleInterviewInput) => {
    console.log('[MCP] schedule_interview called', {
      recruiterEmail: input.recruiterEmail,
      candidateEmail: input.candidateEmail,
      start: input.start,
      end: input.end,
      summary: input.summary,
    });

    const { calendarEventId } = await createCalendarEvent({
      calendarId: input.recruiterEmail,
      guestEmail: input.candidateEmail,
      start: new Date(input.start),
      end: new Date(input.end),
      summary: input.summary || 'Interview',
    });

    return {
      content: [
        {
          type: 'text',
          text: `Scheduled interview with event id: ${calendarEventId}`,
        },
      ],
    };
  },
);

server.tool(
  'cancel_interview',
  cancelInterviewShape,
  async (input: CancelInterviewInput) => {
    console.log('[MCP] cancel_interview called', {
      recruiterEmail: input.recruiterEmail,
      calendarEventId: input.calendarEventId,
    });

    await cancelCalendarEvent({
      calendarId: input.recruiterEmail,
      calendarEventId: input.calendarEventId,
    });

    return {
      content: [
        {
          type: 'text',
          text: `Cancelled interview event: ${input.calendarEventId}`,
        },
      ],
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  console.log('[MCP] velalite-calendar-mcp starting on stdio');
  await server.connect(transport);
  console.log('[MCP] velalite-calendar-mcp ready for tool calls');
}

main().catch((err) => {
  console.error('MCP server failed', err);
  process.exit(1);
});

