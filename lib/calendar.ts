type CreateEventParams = {
  recruiterEmail: string;
  guestEmail: string;
  start: Date;
  end: Date;
  subject: string;
};


export async function createCalendarEvent({
  recruiterEmail,
  guestEmail,
  start,
  end,
  subject,
}: CreateEventParams): Promise<{ calendarEventId: string }> {
  const id = `fake-event-${Date.now()}`;
  console.log('Creating calendar event (placeholder)', {
    id,
    recruiterEmail,
    guestEmail,
    start,
    end,
    subject,
  });
  return { calendarEventId: id };
}

