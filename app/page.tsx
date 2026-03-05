export default function Home() {
  return (
    <main className="min-h-screen bg-white text-gray-900">
      <div className="max-w-3xl mx-auto px-6 py-20">

        <h1 className="text-4xl font-semibold tracking-tight">
          VelaLite
        </h1>

        <p className="mt-4 text-lg text-gray-600">
          AI interview scheduling over email.
        </p>

        <p className="mt-6 text-gray-700">
          VelaLite joins your email thread and handles interview scheduling
          automatically. It checks your calendar, proposes available time
          slots, and schedules the meeting once the candidate confirms.
        </p>

        <div className="mt-16 space-y-12">

          <section>
            <h2 className="text-xl font-medium">
              1. Reply to the candidate and CC the agent
            </h2>

            <p className="mt-3 text-gray-700">
              When a candidate emails you, simply reply and add the VelaLite
              agent in CC. This allows the assistant to join the thread.
            </p>

            <div className="mt-4 bg-gray-100 rounded-lg p-4 text-sm font-mono">
              From: recruiter@company.com <br/>
              To: candidate@gmail.com <br/>
              CC: velalite.agent@gmail.com
            </div>
          </section>


          <section>
            <h2 className="text-xl font-medium">
              2. VelaLite proposes interview slots
            </h2>

            <p className="mt-3 text-gray-700">
              The agent checks your Google Calendar availability and sends a
              few interview time options directly to the candidate while
              keeping you in CC.
            </p>
          </section>


          <section>
            <h2 className="text-xl font-medium">
              3. Candidate replies with a preferred time
            </h2>

            <p className="mt-3 text-gray-700">
              The candidate can reply normally in the email thread. VelaLite
              understands natural language replies and determines the intended
              action.
            </p>
          </section>


          <section>
            <h2 className="text-xl font-medium">
              4. Interview gets scheduled automatically
            </h2>

            <p className="mt-3 text-gray-700">
              Once the candidate confirms a time, VelaLite creates the calendar
              event and sends confirmation to everyone in the thread.
            </p>
          </section>

        </div>

        <div className="mt-20 border-t pt-8 text-sm text-gray-500">
          Built as a prototype demonstrating an AI scheduling assistant for
          interview coordination.
        </div>

      </div>
    </main>
  );
}