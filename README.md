# More

A shared planner for two adults raising a family: one week view, time for
each adult and for the couple, family time, school-holiday childcare, and
clear spending. Built from the *More Business Plan and Technical
Specification*.

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| App | Next.js 16 (App Router, React 19, TypeScript) on Vercel | One codebase for web and installable PWA; server components keep private data on the server |
| Data | Postgres (Supabase, London) via Drizzle ORM | Exclusion constraints, transactions and row locks enforce the spec's invariants in the database |
| Local/test DB | PGlite (embedded Postgres) | Real Postgres semantics with zero setup; every test runs on it |
| Auth | Supabase Auth magic links; synthetic dev sign-in when unconfigured | No passwords to store |
| Time | Temporal polyfill | DST gaps and overlaps handled explicitly in the household timezone |
| Validation | Zod | One schema per command, shared by API and UI |
| Tests | Vitest (domain + acceptance), Playwright + axe (journeys, accessibility) | |

## Run it

```bash
pnpm install
pnpm dev            # http://localhost:3000, embedded database in .data/
```

Sign in as "Alex", set up a household, then open Settings to make an
invitation link and open it in a private window as "Sam".

```bash
pnpm test           # 47 domain and acceptance tests on embedded Postgres
pnpm typecheck
pnpm lint
pnpm test:e2e       # two-adult journeys on phone and desktop, with axe
```

In a sandbox without Playwright's own browser, set `PW_CHROMIUM` to a Chromium binary.

## How it works

- **Commands, not CRUD.** Every change is a typed command posted to
  `/api/v1/commands` with an idempotency key and the revisions the client
  saw. The pipeline locks the household row, checks membership at commit,
  rejects stale writes, writes an audit row and queues notifications in an
  outbox in the same transaction (`src/server/pipeline.ts`).
- **Database-enforced invariants.** One adult can't be booked twice
  (`EXCLUDE USING gist` on reservations), positive durations, integer pence.
- **Privacy by ownership.** Journal, check-ins, feedback and learned
  preferences belong to the account, not the household: no partner, payer
  or export of the household can reach them, and they survive leaving.
- **Agreement is versioned.** Changing time, people, care or budget on a
  shared plan bumps its material version; everyone must agree again.
- **Notifications re-check before sending.** The outbox worker validates
  that a reminder is still true before delivering it.

## Deploy

### Demo preview (no database account)

Set `MORE_DEMO_DB=1`, `MORE_ALLOW_DEV_AUTH=1` and a long random
`MORE_SESSION_SECRET` on the Vercel project. The app then runs on an
embedded database in `/tmp` with synthetic sign-in, and shows a banner
saying data can reset at any time. Never use this with real families.

### Real deployment

1. Create a Supabase project in London; run `pnpm db:migrate` with the direct `DATABASE_URL`.
2. Import the repo in Vercel; set the variables in `.env.example`.
3. The outbox cron in `vercel.json` runs daily, the Hobby plan limit.
   On Pro, change it to every five minutes for timely reminders.

## Not switched on yet

- The AI concierge is off: no paid API calls until the founder approves.
- Email and push delivery: notifications are stored in-app only; no
  message is sent to anyone.
- Row-level security policies: access is enforced in the server layer;
  RLS is a planned second line of defence.
- The activity catalogue is illustrative starter content and has not been
  expert-reviewed.
- End-to-end encryption is not offered and is not claimed.
