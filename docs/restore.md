# Backups and restore

Targets (spec section 15): lose at most 24 hours of data (RPO), be back
within 4 hours (RTO). A backup only counts once it has been restored and
checked.

## What runs

`.github/workflows/backup.yml` runs every night at 02:17 UTC and on demand
(Actions → Backup and restore rehearsal → Run workflow):

1. `pnpm db:backup` copies every row of every table into one gzipped JSON
   file, encrypted with AES-256-GCM using `BACKUP_PASSPHRASE`. All tables
   are read in one repeatable-read, read-only transaction, so the file is a
   single moment even while people are writing (tested against a real
   Postgres server with a concurrent writer: `tests/pg/backup-snapshot.test.ts`).
2. `pnpm db:rehearse` restores that file into an empty embedded Postgres
   with the same migrations and checks it. The job fails if any check fails.
3. The encrypted file is kept as a workflow artifact for 14 days.

The checks: schema version matches, row counts match per table, every
reference resolves, everyone acting in a household is or was its member,
at most two adults per household and one household per adult, money totals
(estimate, committed, net paid) match per household, no adult is
double-booked, private tables carry no household id, a partner's week
shows none of the other adult's private titles or notes, and every account
has an email its owner can sign back in with.

Logs and the job summary show counts and check results only, never rows.

## Switching it on

Add two repository secrets (Settings → Secrets and variables → Actions):

- `DATABASE_URL`: the Supabase **session pooler** connection string
  (Project → Connect → Session pooler). GitHub runners can't reach the
  IPv6-only direct host.
- `BACKUP_PASSPHRASE`: a long random passphrase. Keep a copy in your
  password manager: without it the backups can't be opened.

Scheduled workflows run from the default branch, so this starts once the
workflow is on `main`.

## Restoring for real

1. Download the latest artifact from the most recent green run.
2. Create a fresh Supabase project (London) and run `pnpm db:migrate` against it.
3. Rehearse first: `BACKUP_PASSPHRASE=… pnpm db:rehearse more.json.gz.enc`.
4. Load it: `DATABASE_URL=<new session pooler URL> BACKUP_PASSPHRASE=… pnpm db:restore more.json.gz.enc`.
   It refuses a database that already has accounts and runs the same checks.
5. Point Vercel's `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` at the new project, add the new
   `https://more-family-planner.vercel.app/**` redirect URL in its Auth
   settings, and redeploy.
6. Everyone signs in as usual with their email. See "Signing back in".

## Signing back in

A new Supabase project has new user ids, and this backup doesn't copy
Supabase's `auth` schema. So `db:restore` marks every open account as
waiting (`identity_subject` becomes `relink:<old id>`). The first sign-in
whose email Supabase has verified (the magic link does this) and matches
the account's email takes that account back, with its household, plans,
journal and settings. After that the account is tied to the new id, so
nobody else with that email can claim it. A sign-in with an unverified
email never claims an account. Closed accounts stay closed.

If Supabase Auth itself was restored (same project, or its own backup),
run `pnpm db:restore <file> --keep-sign-ins` instead: the old ids still work.

The "Sign-in recovery" check lists accounts with no email, which can't be
reclaimed this way; re-invite those people to their household instead.
`tests/server/backup.test.ts` rehearses this end to end: both adults sign
in with new ids and land in their original accounts, privacy intact.

## Losing a key

| Key | If it's lost | What to do |
| --- | --- | --- |
| `BACKUP_PASSPHRASE` | Backups taken with it can't be opened. | Keep it in a password manager. Set a new one; tonight's backup uses it. |
| `MORE_SESSION_SECRET` | Connected Google/Outlook calendars can't be read. More shows "Reconnect" on each one instead of failing silently; the household's own data is unaffected. | Set a new one and redeploy. Each person reconnects their calendar once. |
| `VAPID_PRIVATE_KEY` | Phones stop accepting pushes. | Generate a new pair (`npx web-push generate-vapid-keys`), set both, redeploy. Each person turns phone reminders off and on again. |
| `CRON_SECRET` | The reminder scheduler is refused. | Set a new one in Vercel and in the Supabase Vault secret `more_cron_secret`. |
| `RESEND_API_KEY`, Google/Microsoft client secrets | Email or calendar sign-in stops. | Issue a new one at the provider and set it. |
