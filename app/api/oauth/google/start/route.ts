import { NextRequest, NextResponse } from 'next/server';

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const REDIRECT_URI =
  process.env.GMAIL_REDIRECT_URI ?? 'http://localhost:3000/api/oauth/google/callback';

export async function GET(_req: NextRequest) {
  if (!CLIENT_ID) {
    return NextResponse.json(
      { ok: false, error: 'oauth_not_configured' },
      { status: 500 },
    );
  }

  const scope = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/userinfo.email',
  ].join(' ');

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('scope', scope);

  return NextResponse.redirect(url.toString(), { status: 302 });
}

