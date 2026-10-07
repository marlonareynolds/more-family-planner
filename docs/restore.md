# Backups and restore

Targets (spec section 15): lose at most 24 hours of data (RPO), be back
within 4 hours (RTO). A backup only counts once it has been restored and
checked.

## What runs

`.github/workflows/backup.yml` runs every night at 02:17 UTC and on demand
(Actions → Backup and restore rehearsal → Run workflow):

1. `pnpm db:backup` copies every row of every table into one gzipped JSON
   file, encrypted with AES-256-GCM using `BACKUP_PASSPHRASE`.
2. `pnpm db:rehearse` restores that file into an empty embedded Postgres
   with the same migrations and checks it. The job fails if any check fails.
3. The encrypted file is kept as a workflow artifact for 14 days.

The checks: schema version matches, row counts match per table, every
reference resolves, everyone acting in a household is or was its member,
at most two adults per household and one household per adult, money totals
(estimate, committed, net paid) match per household, no adult is
double-booked, private tables carry no household id, and a partner's week
shows none of the other adult's private titles or notes.

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
5. Point Vercel's `DATABASE_URL` and Supabase Auth keys at the new project
   and redeploy. Accounts keep their ids, so sign-ins map back once the
   Auth users are restored from Supabase's own backup or re-invited.

Supabase Auth users live in Supabase's `auth` schema, which this backup does
not copy: More's `accounts.identity_subject` links to them.
