# Running More safely: operator notes

For the one person running More. Each section says what the app does on its
own and what needs a key, a setting or a click from the operator.

## Error tracking (Sentry, EU region)

More reports unexpected server errors to Sentry when `SENTRY_DSN` is set, and
does nothing otherwise. Server errors only: no browser script, no session
replay, no performance traces. Before anything is sent, request bodies,
cookies, headers, addresses, query strings, log breadcrumbs, local variables
and the values of a failed database query are removed
(`src/server/ops/error-report.ts`). Each report carries the short reference
the person saw ("Something went wrong. Reference 1a2b3c4d").

Plan: Sentry Developer, free (1 user, 5,000 errors a month). Team is about
$26 a month billed yearly, only needed for a second person or more volume.

Setup (about 10 minutes):

1. Open https://family-ai-assistant.sentry.io (your existing Sentry account, EU data region).
2. Projects, then **Create Project**. Platform **Next.js**. Alert frequency
   **Alert me on every new issue**. Name it `more`. Create.
3. On the next screen, skip the wizard. Open **Settings > Projects > more >
   Client Keys (DSN)** and copy the DSN (it starts `https://` and ends in
   `.ingest.de.sentry.io/...`).
4. In Vercel: project **more-family-planner > Settings > Environment
   Variables > Add**. Key `SENTRY_DSN`, value the DSN, environments
   **Production** and **Preview**. Save.
5. **Deployments**, the top production deployment, **...** menu, **Redeploy**.
6. Sentry emails the account owner for each new issue. To check: **Alerts**
   in the left menu should list "Send a notification for new issues".

## Uptime check

`/api/v1/health/live` answers `{"ok":true}` when the app is up and can reach
its database, 503 when it can't. No secret, nothing else in the answer.

The hourly GitHub "Health check" workflow is the deeper check (scheduler,
backlog, failed reminders, AI spend) and emails on failure, but GitHub runs
scheduled jobs late: in the week to 27 October 2026 it ran every 3 to 7
hours, not hourly. So an outside monitor watches the live check every few
minutes.

Plan: Better Stack Uptime, free (10 monitors, email alerts; "free for
personal projects", so move to a paid plan before charging anyone).

Setup (about 5 minutes):

1. Sign up at https://betterstack.com/uptime with your email.
2. **Monitors > Create monitor**. Alert us when: **URL becomes unavailable**.
   URL: `https://more-family-planner.vercel.app/api/v1/health/live`.
   Check frequency: **3 minutes**. On-call escalation: **E-mail**. Create.
3. To test, Better Stack has **Send test alert** on the monitor page.

## AI letter reading: allowance and ceiling

Every AI read reserves its worst case (about 70 to 80p) while it runs, then
settles at its real cost (a few pence). Two limits apply per calendar month
(UTC):

| Setting (Vercel environment variable) | Default | Meaning |
| --- | --- | --- |
| `DESK_AI_HOUSEHOLD_MONTHLY_PENCE` | 200 (£2) | Each household's own allowance |
| `DESK_AI_MONTHLY_CAP_PENCE` | 1000 (£10) | Ceiling for all households together |

When either is reached, letters are still read, by the simpler on-phone
reader, and the person is told which limit applied. The health check fails
(and GitHub emails you) when spend passes 90% of the ceiling.

This month's spend per household:

```
DATABASE_URL=… pnpm ops:ai-spend
```

or in the Supabase SQL editor:

```sql
select left(household_id::text, 8) as household,
       count(*) filter (where state <> 'released') as reads,
       coalesce(sum(actual_cost_minor) filter (where state = 'settled'), 0) as settled_pence,
       coalesce(sum(max_cost_minor) filter (where state = 'reserved'), 0) as running_pence
from usage_reservations
where request_id like 'desk-%' and created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'
group by household_id
order by settled_pence + running_pence desc;
```

## Rate limits

Request limits are counted in Postgres (`rate_limits`), so every server
instance shares one count. Keys are stored as hashes, never as an address or
an account id, and the scheduler sweeps finished windows. If the database
can't be reached, each instance falls back to counting in its own memory.

## Bad requests

A body that isn't JSON, or that carries a null character, answers 400 with a
plain message. Before this, both ended as a 500.

## Function time limits

The Desk read route declares `maxDuration = 120`. Vercel's published limits
(docs/functions/limitations, updated 24 August 2026) are 300 seconds on Hobby
and 800 on Pro with Fluid compute, which Vercel turns on by default for new
projects; this project was created on 6 October 2026. The 60-second Hobby
limit applies only without Fluid compute. Production has deployed with the
120-second setting since 7 October without a build error and showed no
runtime errors in the week to 27 October 2026. Whether Fluid compute is on
is a dashboard setting the connector can't read: **Settings > Functions >
Fluid Compute** should show Enabled. A test (`tests/server/ops-safe.test.ts`)
keeps the declared time at or under 300 seconds and above the read's own
90-second budget plus room to settle the cost.
