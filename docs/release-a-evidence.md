# Release A: trust and recovery — evidence register

Answer to "More — Independent Build Review and Builder Priorities" (7 October 2026).
Branch `claude/more-v1-next-lcbqky`, PR #6. Every test named here runs in CI
(`.github/workflows/ci.yml`). The `tests/pg/` tests use a real Postgres 16
server with several sessions; CI starts one as a service.

Status words, as the review asked:

- **Fixed and demonstrated**: a test failed before the change and passes after it, or a test covers new behaviour that didn't exist before.
- **Implemented but not exercised**: the code is in, but it hasn't run against the real provider, device or production yet.
- **Deferred by decision**: deliberately left for a later release.
- **Unresolved**: still open.

## Findings R01–R10

| # | Finding | Status | What changed | Evidence |
| --- | --- | --- | --- | --- |
| R01 | Expired helper links reveal childcare details | Fixed and demonstrated | `askView` returns nothing unless the ask is live: open (unanswered, not expired, care still proposed), or answered yes with the care confirmed and not yet ended. The public page then shows only "This link has ended." | `tests/server/release-a.test.ts` "R01". It renders the real public page for expired, declined, withdrawn, after-the-care and deleted-household links. Before the fix, 3 of 5 failed. |
| R02 | Two journal saves can overwrite each other | Fixed and demonstrated | Saves and deletes lock the owner's row (`for update`) and write only where `version` still matches. The loser gets STALE_VERSION, and the typed text stays on screen and in the draft. Check-ins stay last-write-wins by decision (one per person per day, no shared editing). | `tests/pg/races.test.ts` BR-02. Before the fix, 2 of 10 concurrent saves "succeeded" (silent overwrite). After, exactly 1 succeeds and 9 get a conflict. |
| R03 | Push can be lost, stale or too frequent | Fixed and demonstrated (in tests); implemented but not exercised (on real phones) | Each notice has a delivery state (pending, leased, sent, retry, failed, expired, superseded, skipped), a 2-minute lease, up to 5 retries with backoff and an expiry (16 h by default, the time to leave for leave-by reminders). Membership and relevance are rechecked at send time. A cancelled or changed plan marks its pending notices superseded. Policy: time-sensitive notices (invitations and answers, care, child wishes, job handovers, leave-by) go when due, outside quiet hours. Everything else is bundled at most twice a day, at 07:30 and 18:00. "Sent" means the push service accepted it, not that the phone showed it. | `tests/server/release-a.test.ts` "R03": BR-04 ×2, BR-05 ×2, BR-06, plus a bundle-frequency test. Before, 5 of 6 failed. `tests/server/leftovers.test.ts` covers BR-15. |
| R04 | Backup inconsistent; identity and key recovery unproven | Fixed and demonstrated (snapshot, identity); implemented but not exercised (first scheduled run) | (1) The backup reads every table in one repeatable-read, read-only transaction. (2) The restore marks accounts `relink:` by default. The owner's first sign-in with the same verified email takes the account back, once; unverified emails can't. (3) `docs/restore.md` now covers losing each key, including calendar reconnect when `MORE_SESSION_SECRET` is lost. (4) The rehearsal adds a "Sign-in recovery" check. | `tests/pg/backup-snapshot.test.ts` BR-07: a writer adds accounts and journal entries while three backups run. Before the fix, the restore had 33 orphaned journal entries; after, none. `tests/server/backup.test.ts` BR-08: restore, then both adults sign in with new ids and verified emails, land in their original accounts and see their own week with privacy intact. The nightly backup only starts once Marlon adds the `DATABASE_URL` and `BACKUP_PASSPHRASE` repository secrets. |
| R05 | Weekly "free together" omits days | Deferred to Release B | | |
| R06 | Confirmed external care not used in suggestions | Deferred to Release B | | |
| R07 | Private idea shelves not stable | Deferred to Release B | | |
| R08 | No care-reconfirmation journey | Deferred to Release B | | |
| R09 | Calendar disconnect claims cleanup after a failed deletion | Fixed and demonstrated (disconnect); unresolved (leaving a household) | A failed deletion keeps its mapping and is reported. A 404 counts as removed. Revoked permission lists every block left for manual removal, and the settings screen shows their times. A block written while the calendar is being disconnected is deleted again. Leaving a household still disconnects locally without removing blocks at Google or Outlook. Two-way sync stays hidden (no provider keys) until that is fixed in Release B. | `tests/server/calendar-two-way.test.ts`: timeout, revoked, already deleted, lost key, BR-14 race. |
| R10 | Scheduler budget and delivery evidence | Fixed (scheduler and alerts); implemented but not exercised (real phones) | The reminder tick moves from GitHub Actions (about 2,880 minutes a month) to Supabase pg_cron plus pg_net every 5 minutes, which uses no GitHub minutes. Each step of the tick is isolated. A failing step is recorded in `ops_runs` and the endpoint answers 500. `/api/v1/health` reports scheduler freshness (stale after 30 minutes), overdue outbox, outbox failures, lost pushes and waiting help messages. An hourly GitHub check fails, and so emails the owner, when anything is wrong; that is about 720 minutes a month. Leave-by reminders are queued 20 minutes ahead and expire at the time to leave, so a late scheduler never sends them late. | `tests/server/ops.test.ts`; the job is live in Supabase (`more-tick`). |

## Acceptance pack BR-01 to BR-22

| ID | Scenario | Status | Evidence or reason |
| --- | --- | --- | --- |
| BR-01 | Expired or revoked helper and display links | Fixed and demonstrated | Helper: the R01 tests. Display: revoked links, archived children and deleted households return nothing (`tests/server/trial-stage.test.ts`). Display links have no time expiry by decision: a kitchen screen stays on until it is switched off. |
| BR-02 | Two journal saves from one version | Fixed and demonstrated | `tests/pg/races.test.ts` |
| BR-03 | Journal edit racing deletion | Fixed and demonstrated | `tests/pg/races.test.ts`, 5 rounds. Exactly one wins; a deleted entry is never brought back. Before the fix, both "won". |
| BR-04 | Push fails, then recovers | Fixed and demonstrated | `release-a.test.ts` |
| BR-05 | Deferred, then cancelled or the adult leaves | Fixed and demonstrated | `release-a.test.ts` |
| BR-06 | Worker overlap or crash after claiming | Fixed and demonstrated | `release-a.test.ts`: two runs at once send once; an expired lease is taken over. |
| BR-07 | Snapshot during concurrent changes | Fixed and demonstrated | `tests/pg/backup-snapshot.test.ts` (references). Money and consent checks also pass in `backup.test.ts`. |
| BR-08 | Fresh recovery environment | Fixed and demonstrated (tests); implemented but not exercised (a real second Supabase project) | `backup.test.ts`; `docs/restore.md` "Signing back in" and "Losing a key". |
| BR-09 | Seven empty days | Deferred to Release B | R05 |
| BR-10 | Confirmed care with a partial gap | Deferred to Release B | R06 |
| BR-11 | Care capacity reviewed after agreement | Deferred to Release B | R08 |
| BR-12 | Catalogue and partner changes | Deferred to Release B | R07 |
| BR-13 | Provider deletion fails during disconnect | Fixed and demonstrated | `calendar-two-way.test.ts` |
| BR-14 | Sync racing disconnect or leaving | Fixed and demonstrated (disconnect); unresolved (leaving) | See R09. |
| BR-15 | Pickup moves, quiet hours, late scheduler | Fixed and demonstrated | `leftovers.test.ts`: a moved pickup drops the old reminder and queues the new one; a late run expires the notice unsent. |
| BR-16 | Recurrence, DST and travel-only overlap | Unresolved | Release B |
| BR-17 | Overlapping accepts and revoke/join under real interleaving | Unresolved | Release B. The `tests/pg` harness now makes this testable. |
| BR-18 | Long series with thousands of exceptions | Unresolved | Release B |
| BR-19 | Real iPhone and Android | Unresolved | Needs Marlon's phones once push keys are on. |
| BR-20 | Keyboard, screen reader, zoom, touch | Unresolved | Automated checks only so far. |
| BR-21 | New partner joins: historical access | Unresolved | Needs a product decision from Marlon. |
| BR-22 | Account closure | Fixed and demonstrated | `tests/server/account-close.test.ts` and `ops.test.ts`. Closing requires leaving the household first, which hands back shared plans, jobs and calendars. It then erases the journal, check-ins, feedback, preferences, trial answers, notifications, devices, email history and calendar export links. The account is anonymised as "Former member" and its sign-in is unlinked. Help messages stay but are detached. Backups holding the old data expire after 14 days (artifact retention). |

## Also in this release

- **Help page** (`/support`), reachable signed in or out and linked from sign-in and Settings. Messages are stored in `support_requests` and, once `MORE_SUPPORT_EMAIL` and the Resend key are set, emailed. Limited to 5 an hour per address.
- **Rate limits** on commands (120 a minute per account), helper answers, child wishes and calendar feeds.
- **Content Security Policy** and `frame-ancestors 'none'`. The browser tests fail on any policy violation.
- **Sunset-walk wording**: "Forty minutes to a viewpoint while someone you trust is at home with the children."

## Not yet switched on

| What | Needs |
| --- | --- |
| Migration 0010 (delivery states, `ops_runs`, `support_requests`) | Marlon's go-ahead to apply it to Supabase before this PR merges. |
| Reminder schedule | A Vercel redeploy so production picks up `CRON_SECRET`. The Supabase job is already running. |
| Health alerts and the old GitHub tick | Repository secrets `MORE_APP_URL` and `CRON_SECRET` for the hourly check. The GitHub tick becomes manual-only once Supabase calls succeed. |
| Nightly backup | Repository secrets `DATABASE_URL` (session pooler) and `BACKUP_PASSPHRASE`. |
| Help emails | `MORE_SUPPORT_EMAIL` and `RESEND_API_KEY` in Vercel. |
