# Release B: dependable planning — evidence register

Answer to "More — Independent Build Review and Builder Priorities" (7 October 2026), part two.
Branch `claude/more-v1-next-lcbqky`, started from `main` at 54a0a87 (Release A merged). Every test
named here runs in CI (`.github/workflows/ci.yml`).

Status words, as the review asked:

- **Fixed and demonstrated**: a test failed before the change and passes after it, or a test covers new behaviour that didn't exist before.
- **Implemented but not exercised**: the code is in, but it hasn't run against real households or devices yet.
- **Deferred by decision**: deliberately left for a later release.
- **Unresolved**: still open.

"Before" means the same tests run against `main` at 54a0a87 with this branch's code stashed: 20 of 26 failed.

## Findings R05–R08 and named handovers

| # | Finding | Status | What changed | Evidence |
| --- | --- | --- | --- | --- |
| R05 | Weekly "free together" omits days | Fixed and demonstrated | Free evenings are now worked out day by day (`freeEvenings` in `src/domain/free-time.ts`), separately from the ranked suggestions. Each day gets its first free start between 18:30 and 20:00 with two and a half hours clear for both adults. Nothing is dropped for variety. | `tests/server/release-b.test.ts` "R05": an empty week shows 7 evenings; blocking Wednesday removes only Wednesday; working until 19:30 moves that evening's start to 19:30; the week the clocks go back has 7 evenings. Before: 3 of 4 failed (only Mon, Tue, Sat, Sun came back). |
| R06 | Confirmed external care not used in suggestions | Fixed and demonstrated | Suggestions now check the care already arranged for the plan's whole time, for every child: "arranged" (all covered and confirmed), "pending" (asked, no answer yet), "partly arranged" (a child or a few minutes left uncovered), "a partner could have them" (possible, not agreed) or "needs care". The words on Week, Us picks and Find a time follow. | `release-b.test.ts` "R06", four children: nothing arranged gives "needs care"; Nana for all four gives "arranged"; Nana for three and a club for one ending ten minutes early gives "partly arranged"; an unanswered ask gives "pending" and removing it goes back to "needs care"; a free partner is never shown as confirmed care. Before: all 4 failed. |
| R07 | Private idea shelves not stable | Fixed and demonstrated | Declared policy (in `src/lib/private-split.ts`): More's own ideas keep a fixed seat by their position in the list, and lists only grow at the end. A new guard test fails if anyone reorders, removes or inserts in the middle. Seats are dealt alternately from a starting point that differs by household, so each adult gets half of every list. The household's own places are placed by a hash of household, place and adult, so adding or removing a place never moves another. An idea an adult has made into a plan stays on their shelf for good, whoever joins or leaves. While someone is the only adult they see everything; when a partner joins, only unused ideas are split. The server now deals each adult's shelf and sends the browser only that adult's own list, never which ideas the partner used. | `tests/domain/private-split.test.ts` "R07": adding 1 or 3 ideas, or removing any of 4, moves nothing; a partner change keeps the stayer's used ideas; a used idea is only ever on its user's shelf. Before: 3 of 3 failed. `release-b.test.ts` "R07": the two shelves split every idea; when Sam plans one of Alex's ideas it moves to Sam's shelf only, nothing else moves, Alex's page never contains that idea and Alex's suggestions over four weeks never offer it. `tests/domain/catalogue-order.test.ts` guards the order. |
| R08 | No care-reconfirmation journey | Fixed and demonstrated | On Holidays and care, the parent who promised care sees "Care you've said you'll do" with "Still OK?". Only they see it, and nothing is inferred from a check-in. The choices are: keep it (nothing changes, nobody is told); ask the partner to take over (the promise stays theirs until the partner says yes, so the children are never left uncovered; a yes moves it and frees the first parent); or withdraw (the gap shows again on every screen, and the partner is told "Alex can no longer look after the children, Wed 9 Oct, 17:30. Care is needed again."). No reason is asked for or passed on. | `release-b.test.ts` "R08", 6 tests: only the promising parent can review, and only before it ends; keep changes nothing; hand-over stays covered until the yes, a clash stops Sam saying yes and Alex is told they are still down for it; a yes declines the original, releases Alex's reserved time and tells Alex; withdraw turns the affected plan's care to "needs care" for Sam and the notice carries no private text (Alex's check-in note never appears in Sam's view). Browser test: Alex asks Sam to take over, Sam says yes, and the "Still OK?" button moves from Alex to Sam (`tests/e2e/journeys.spec.ts`, phone and desktop, accessibility checked). Before: new behaviour, did not exist. |
| — | Named handovers | Fixed and demonstrated | Care by someone outside the household (a club, a grandparent) now has a named drop-off and a named collection. Naming yourself agrees on the spot; naming the other adult asks them, with "Yes, I'll do it" / "I can't" under "Asked of you" and on Today. An agreed handover reserves the journey (20 minutes each way by default), so it clashes with other plans like anything else. It is also written as Busy to a connected calendar once two-way sync is switched on. Declining or stepping back tells the other adult that someone is still needed. Leaving the household hands that person's handovers back. | `release-b.test.ts` "Named drop-off and collection", 4 tests: self agrees and reserves 40 minutes; the partner is asked and sees it on Today; only the named adult can answer; declining clears it and tells Alex; a dentist appointment blocks Sam's collection; leaving clears Sam's collection and its reservation. Before: new behaviour, did not exist. |

## Acceptance pack items in this release

| ID | Scenario | Status | Evidence or reason |
| --- | --- | --- | --- |
| BR-09 | Seven empty days | Fixed and demonstrated | R05 tests. |
| BR-10 | Confirmed care, four children, one partial gap | Fixed and demonstrated | R06 tests. Readiness on Week already used the same per-child coverage; suggestions now match it. |
| BR-11 | Care capacity reviewed after agreement | Fixed and demonstrated | R08 tests and the browser journey. |
| BR-12 | Catalogue and place changes, partner transitions | Fixed and demonstrated | R07 tests, against the declared policy above. |
| BR-16 | Recurrence moved across weeks, DST and travel-only overlap | Unresolved | Not in this PR. The DST week is covered for free evenings only. |
| BR-17 | Overlapping accepts, revoke/join under real interleaving | Unresolved | Not in this PR. The `tests/pg` harness from Release A makes it testable. |
| BR-18 | Long series with thousands of exceptions | Unresolved | Not in this PR. |

BR-01 to BR-08, BR-13 to BR-15 and BR-22 are as reported in `docs/release-a-evidence.md`. BR-19 to BR-21 are unchanged.

## Not covered by this release

- Reminders for drop-offs and collections. The leave-by reminder still covers children's events only. Handovers show on Today and in calendars, but don't send a "leave by" notice yet.
- Handovers for care given by a parent. A parent looking after the children doesn't need one; this is by design.

## Not yet switched on

| What | Needs |
| --- | --- |
| Migration 0011 (handover and take-over columns on `care_arrangements`; adds columns only, removes nothing) | Marlon's go-ahead to apply it to Supabase before this PR merges. |

## Checks run on this branch

- `pnpm exec tsc --noEmit`: clean.
- `pnpm lint`: 0 errors (4 old warnings, unchanged).
- `pnpm exec vitest run` with a real Postgres 16 server: 40 files, 187 tests passed.
- `pnpm build`: passed.
- Playwright against the production build, phone and desktop: 4 passed, with accessibility checks and the content security policy watched.
