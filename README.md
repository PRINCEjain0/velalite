This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## VelaLite – Google Calendar

To use **real** calendar availability and create real events:

1. **Google Cloud**: Create a project, enable [Calendar API](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com), create a **Service Account**, download its JSON key.
2. **Share the recruiter's calendar** with the service account email (e.g. `xxx@project.iam.gserviceaccount.com`): Google Calendar → Settings → Share with specific people → add that email with “See all event details”.
3. **Env** (one of):
   - `GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json`
   - or `GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}` (full JSON string).
4. Use the **recruiter's primary calendar ID** in the flow (we use their email as `calendarId` for primary calendar). When the first email has `to=recruiter@gmail.com`, we call freebusy and create events on `recruiter@gmail.com`.

Without these env vars, the app falls back to placeholder slots and a log-only “event” on confirm.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
