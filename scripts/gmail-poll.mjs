const POLL_URL = process.env.GMAIL_POLL_URL ?? 'http://localhost:3000/api/gmail/poll';
const INTERVAL_MS = Number(process.env.GMAIL_POLL_INTERVAL_MS ?? '10000');

if (!Number.isFinite(INTERVAL_MS) || INTERVAL_MS < 5000) {
  console.error('GMAIL_POLL_INTERVAL_MS must be >= 5000');
  process.exit(1);
}

let inFlight = false;

async function tick() {
  if (inFlight) return;
  inFlight = true;
  try {
    const res = await fetch(POLL_URL, { method: 'POST' });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }

    const ts = new Date().toISOString();
    if (!res.ok) {
      console.error(`[${ts}] poll failed`, res.status, json);
    } else {
      console.log(`[${ts}] poll ok`, json);
    }
  } catch (err) {
    console.error('poll error', err);
  } finally {
    inFlight = false;
  }
}

console.log(`Gmail poller running`);
console.log(`- URL: ${POLL_URL}`);
console.log(`- Interval: ${INTERVAL_MS}ms`);

// Run immediately, then on interval.
await tick();
setInterval(tick, INTERVAL_MS);

