import { google } from 'googleapis';

const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const GMAIL_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN;
const GMAIL_REDIRECT_URI =
  process.env.GMAIL_REDIRECT_URI ?? 'https://developers.google.com/oauthplayground';
const ASSISTANT_EMAIL = process.env.ASSISTANT_EMAIL;

export function isGmailConfigured() {
  return Boolean(GMAIL_CLIENT_ID && GMAIL_CLIENT_SECRET && GMAIL_REFRESH_TOKEN && ASSISTANT_EMAIL);
}

export function getAssistantEmail() {
  return ASSISTANT_EMAIL ?? null;
}

export function getGmailClient() {
  if (!isGmailConfigured()) {
    console.warn(
      'Gmail client is not fully configured. Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, ASSISTANT_EMAIL.'
    );
    return null;
  }

  const oAuth2Client = new google.auth.OAuth2(
    GMAIL_CLIENT_ID,
    GMAIL_CLIENT_SECRET,
    GMAIL_REDIRECT_URI
  );

  oAuth2Client.setCredentials({ refresh_token: GMAIL_REFRESH_TOKEN });

  return google.gmail({ version: 'v1', auth: oAuth2Client });
}

