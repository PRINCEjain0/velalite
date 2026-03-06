import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { prisma } from '@/lib/prisma';

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const REDIRECT_URI =
  process.env.GMAIL_REDIRECT_URI ?? 'https://developers.google.com/oauthplayground';

export async function GET(req: NextRequest) {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return NextResponse.json(
      { ok: false, error: 'oauth_not_configured' },
      { status: 500 },
    );
  }

  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  if (!code) {
    return NextResponse.json({ ok: false, error: 'missing_code' }, { status: 400 });
  }

  const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

  try {
    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens.refresh_token) {
      return NextResponse.json(
        { ok: false, error: 'no_refresh_token' },
        { status: 400 },
      );
    }

    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({
      version: 'v2',
      auth: oauth2Client,
    });
    const me = await oauth2.userinfo.get();
    const email = (me.data.email ?? '').toLowerCase();

    if (!email) {
      return NextResponse.json(
        { ok: false, error: 'no_email' },
        { status: 400 },
      );
    }

  
    const recruiter = await (prisma as any).recruiter.upsert({
      where: { email },
      update: {
        googleRefreshToken: tokens.refresh_token,
      },
      create: {
        email,
        googleRefreshToken: tokens.refresh_token,
      },
    });

    return NextResponse.json({ ok: true, email: recruiter.email });
  } catch (error) {
    console.error('Google OAuth callback error', error);
    return NextResponse.json(
      { ok: false, error: 'oauth_callback_failed' },
      { status: 500 },
    );
  }
}

