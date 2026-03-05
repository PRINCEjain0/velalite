# VelaLite

AI interview scheduling over email.

VelaLite acts as an AI assistant inside email threads and automatically coordinates interview scheduling between recruiters and candidates. It reads email conversations, checks calendar availability, proposes interview slots, and schedules meetings once a time is confirmed.

All coordination happens directly inside the email thread.

## Recruiter Quick Start


### 1. CC the VelaLite agent once

When a candidate first contacts the recruiter, the recruiter replies and adds the VelaLite agent in CC.

Example email:

- **From:** `recruiter@company.com`
- **To:** `candidate@gmail.com`
- **CC:** `velalite.agent@gmail.com`

After this first reply, the agent joins the email thread and continues handling scheduling.  
The recruiter does not need to manually manage scheduling messages after that.

The agent will communicate with the candidate and keep the recruiter in CC.

### 2. Share your Google Calendar with VelaLite

VelaLite needs access to the recruiter's calendar to check availability and create interview events.

1. Open Google Calendar.
2. Open the settings for your main calendar.
3. Find **Share with specific people**.
4. Add the service account email:

```
velalite-calendar@velalite.iam.gserviceaccount.com
```

5. Permission must be:

**Make changes to events**

Once shared, the agent can read availability and schedule meetings automatically.

### 3. How the agent understands candidate replies

Candidates do not need to use strict commands.

VelaLite uses AI to understand natural language replies such as:

- "Wednesday works for me"
- "Can we do another slot?"
- "Let's reschedule for tomorrow"
- "Please cancel this meeting"

The system detects intent from email text and performs the correct action automatically.

### 4. End to end behavior

1. Candidate sends an email to the recruiter.
2. Recruiter replies once and CCs the VelaLite agent.
3. The agent checks the recruiter's calendar and proposes available interview slots.
4. The candidate replies with their preferred time.
5. The agent creates or updates the calendar event and sends confirmation to both participants.

All communication continues within the same email thread.

## Scheduling Flow

![VelaLite Scheduling Flow](docs/workflow.png)

## Known Limitation

When using personal Gmail accounts with service accounts, Google may restrict sending attendee invitations automatically.

In this case VelaLite still creates or cancels the event on the recruiter's calendar and sends email confirmations to participants.

## Local Setup 

Use this section only if you want to run VelaLite locally.

### Install dependencies

```bash
npm install
```

### Database setup

Set the database connection string in `.env`.

```env
DATABASE_URL=...
```

Run the Prisma migration.

```bash
npx prisma migrate dev
```

### Environment variables

Create a `.env` file and provide:

```env
DATABASE_URL=...

ASSISTANT_EMAIL=your.agent@gmail.com

GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
GMAIL_REDIRECT_URI=https://developers.google.com/oauthplayground
GMAIL_REFRESH_TOKEN=...

GROQ_API_KEY=...

GOOGLE_APPLICATION_CREDENTIALS=keys/your-service-account-key.json
```

### Run the application

Start the development server:

```bash
npm run dev
```

Start the Gmail poller:

```bash
npm run gmail:poll
```

Optional custom polling interval:

```bash
GMAIL_POLL_INTERVAL_MS=60000 npm run gmail:poll
```

## MCP Calendar Tools (Advanced)

Optional MCP interface for external AI tool access.

If you use an MCP-compatible client (like Claude Desktop or modern AI IDEs), you can talk to your calendar through VelaLite as tools:

- **check_availability**: returns upcoming free interview slots on a recruiter calendar.
- **schedule_interview**: creates an interview event on the recruiter calendar and invites the candidate.
- **cancel_interview**: cancels a previously scheduled interview event.

To run the MCP server locally:

```bash
npm run mcp:server
```

Developed by **Prince Jain**

