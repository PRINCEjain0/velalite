import { google } from 'googleapis';
import { prisma } from '@/lib/prisma';

const OAUTH_CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const OAUTH_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const GMAIL_REDIRECT_URI =
  process.env.GMAIL_REDIRECT_URI ?? 'https://developers.google.com/oauthplayground';

export async function getRecruiterCalendarClient(recruiterEmail: string) {
  if (!OAUTH_CLIENT_ID || !OAUTH_CLIENT_SECRET) {
    return null;
  }

  const recruiter = await prisma.recruiter.findUnique({
    where: { email: recruiterEmail.toLowerCase() },
  });
  if (!recruiter) return null;

  const oAuth2Client = new google.auth.OAuth2(
    OAUTH_CLIENT_ID,
    OAUTH_CLIENT_SECRET,
    GMAIL_REDIRECT_URI,
  );
  oAuth2Client.setCredentials({ refresh_token: recruiter.googleRefreshToken });

  return google.calendar({ version: 'v3', auth: oAuth2Client });
}

