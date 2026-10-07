# What would help: evidence

Feature: private needs on For Us that shape the partner's small kindnesses and date night menu.
Design: /mnt/project-files/reports/private-wishes-design.md
Branch: claude/project-thread-86bzlt, commit f91bb10, on top of main 51f25cf (after PR #8).
Migration: 0012_private_needs (additive: three new account-owned tables, RLS on, API grants revoked). Applied to Supabase (London) 2026-10-07 ~16:20 UTC with Marlon's OK on the decision card: 13 journal rows; all three tables owned by postgres, RLS on, no anon or authenticated access (checked like journal_entries).

Each item below is marked: fixed and demonstrated / implemented not exercised / deferred by decision.

## Before
The new tests run against main 51f25cf fail: `Cannot find package '@/lib/kindness'` for tests/domain/kindness.test.ts and tests/server/kindness.test.ts (2 files failed, no tests ran). Main had no way for a partner to say what would help.

## After (all on this branch)
- `pnpm lint`: 0 errors (4 warnings, all pre-existing).
- `pnpm typecheck`: clean.
- `vitest run`: 41 files passed, 3 skipped (need a real Postgres); 215 tests passed, 7 skipped.
- `playwright test` (phone and desktop): 8 of 8 journeys passed, including the new one.

| # | Rule | Test | Status |
|---|---|---|---|
| W1 | The author gets their needs and words back; the note is sealed at rest | server: "the author gets their needs and words back" | fixed and demonstrated |
| W2 | Nothing the partner's page, kindness card, concierge positions or exports receive carries the need or the words | server: "nothing the partner's browser or exports receive…"; e2e: Sam's page HTML has no trace of Alex's line | fixed and demonstrated |
| W3 | A change counts from next week, never this one, when added or removed | server: "a change counts from next week…" | fixed and demonstrated |
| W4 | "Just for me" shapes nothing; your own need never shapes your own card | server | fixed and demonstrated |
| W5 | Everyone gets the card every week; with nothing shared every kindness turns up about equally (within ±25% over 4,000 weeks) | domain | fixed and demonstrated |
| W6 | A need tips the odds without making anything certain: matching share rises from about 12% to about 36%, and over 30% of weeks still show nothing from it | domain | fixed and demonstrated |
| W7 | Each partner has their own half of the kindness list; nothing on one card can appear on the other's (30 weeks checked in the server test) | domain and server | fixed and demonstrated |
| W8 | The concierge gets positions only, and a need makes a matching first course likelier (at least 1.5×) | domain | fixed and demonstrated |
| W9 | Needs about a partner who left shape nobody and show as paused to their author; saving again points them at the new partner from next week | server | fixed and demonstrated |
| W10 | Closing an account erases needs, note and marks; only the author's own export includes them | server | fixed and demonstrated |
| W11 | Ended needs are erased once they can no longer count (8 days), by the scheduler | server (purge) | fixed and demonstrated; the scheduler step itself is implemented, not exercised on production |
| W12 | Kindnesses never send a notification or appear on the kitchen display, child view, emails or trial report | none of those code paths read the new tables | implemented, not exercised |
| W13 | Order can't be recomputed from outside: the seed is an HMAC of MORE_SESSION_SECRET | code review | implemented, not exercised |
| W14 | Backup integrity check counts the three tables as account-owned (no household id) | ops check list updated | implemented, not exercised |

Screenshots (phone): (project files) reports/private-wishes/what-would-help-phone.png, (project files) reports/private-wishes/kindness-phone.png

## Known limits
- A need saved before a partner joins applies to whoever joins first.
- Kindness and need wording is starter content, not expert-reviewed, like the activity catalogue.
- Over months a partner may sense a general lean (for example towards thanks). That is the honest point of the feature, and the "Why these?" line says so.
