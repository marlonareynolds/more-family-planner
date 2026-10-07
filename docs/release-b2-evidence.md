# Release B, part two: the last review items — evidence register

This closes the items still open after Release B (`docs/release-b-evidence.md`). Branch `claude/more-v1-next-lcbqky`,
started from `main` at 3f66ca4 (Release B merged). The `tests/pg/` tests use a real Postgres 16 server with several
sessions; CI starts one as a service. There is no database change in this release.

The status words are the same as before: fixed and demonstrated, implemented but not exercised, deferred by decision,
unresolved.

| ID | Scenario | Status | What changed | Evidence |
| --- | --- | --- | --- | --- |
| BR-14 | Sync racing leaving a household | Fixed and demonstrated | Leaving or deleting a household now goes through `/api/v1/household/leave`. It first takes More's "Busy" blocks out of the leaver's connected Google or Outlook calendar; deleting a household takes out everyone's. If the provider can't be reached, the person still leaves, and Settings lists the blocks they may need to delete themselves. The request is checked first (membership, and the household name for delete), so a refused request touches no calendar. A block written by a sync while someone leaves is taken back out. | `tests/server/calendar-two-way.test.ts` "Leaving a household…", 5 tests: leaving removes 2 of 2 blocks; a provider failure still lets them leave and lists both blocks; a wrong name or a non-member touches nothing; deleting removes the other adult's blocks; the race case ends with no block left. Before: leaving left the block in the calendar (1 block remained, expected 0). Browser test: an adult leaves from Settings and lands on setup (phone and desktop). |
| BR-15 (extended) | Leave-by reminders for drop-offs and collections | Fixed and demonstrated (in tests); implemented but not exercised (real phones) | The adult who agreed to a drop-off or collection now gets "Leave by 15:10 to collect Ada from Holiday club." about twenty minutes before they need to set off, the same as for a child's event. Nothing is sent for one that is only asked, not agreed. Each reminder is checked again at delivery, so one handed back or changed is never sent, and it expires at the time to leave. | `tests/server/leftovers.test.ts` "leave-by reminders for drop-offs and collections", 3 tests: only the agreed adult is told, once, at the right time; an asked-only handover sends nothing and a handed-back one is dropped; the drop-off text names where the children are going. Before: new behaviour. |
| BR-16 | Recurrence moved across weeks, DST and travel-only overlap | Fixed and demonstrated (no code change needed) | The week you read and the clash checks that guard a change were already using the same loader. The new tests prove they agree. | `tests/server/boundaries.test.ts` "BR-16", 3 tests. Each probes the same time two ways: the conflict shown on the week, and the clash check when a parent offers care. A Monday choir moved to the next week's Wednesday is free where it was and busy where it went, and the week view shows it on the Wednesday it moved to. A Friday 18:00 club stays at 18:00 local after the clocks go back (18:00 GMT), and 17:00 is free. Travel time alone (30 minutes before a dentist) clashes in both paths; just outside it is free in both. These pass on main too. |
| BR-17 | Two sessions accepting overlapping plans, or revoke and join, at the same moment | Fixed and demonstrated | Found a real deadlock. Revoking an invitation locked the household and then the invitation; joining locked them in the opposite order. When both happened at once, Postgres aborted one, and the person saw "Someone else changed this" instead of the true answer. Joining now locks in the same order (household, then invitation), so the two queue instead. | `tests/pg/household-races.test.ts`, 4 tests on real Postgres sessions, 5–6 rounds each. Overlapping plans accepted at once: exactly one is agreed, the other gets a clash, and nobody is double-booked. Revoke versus join: exactly one wins, and the loser gets the right message. Two people joining with one link: only one gets in. A partner leaving while the other accepts: no time is left held for the person who left. Before: the revoke/join test failed (the join got "CONFLICT" from a deadlock; 2 deadlocks in the Postgres log). After: 3 repeated runs passed, with no new deadlocks. |
| BR-18 | Long series with thousands of exceptions | Fixed and demonstrated | Reading a week no longer loads a series' whole history of exceptions, only those near the week plus any moved into it. Occurrences from long before the week skip the time-zone work. | `tests/server/boundaries.test.ts` "BR-18": a ten-year daily series with 3,650 exceptions (every day either cancelled or moved). Before: the loader read 3,650 exceptions in 304 ms and the week view took 522 ms. After: 25 exceptions in 76 ms, and the week view took 149 ms. The payload was 3,005 bytes both times. The results are the same (3 moved occurrences that week, at their moved times). The test fails if more than 40 exceptions are read. Times are from the embedded test database and vary by machine. |

## Also in this release

- The browser journey now waits for an invitation to land before the partner looks for it. It failed once on phone because the partner's page loaded first. This is a test timing fix; the app didn't change.

## Still open

| Item | Status |
| --- | --- |
| BR-19 Real iPhone and Android | Unresolved. Needs Marlon's phones once push keys are on. |
| BR-20 Keyboard, screen reader, zoom, touch | Unresolved. Automated accessibility checks only. |
| BR-21 New partner joins: what history they see | Unresolved. Needs a product decision from Marlon. |
| Two-way calendar sync | Still hidden until Marlon adds Google and Microsoft keys. With leaving now cleaned up, nothing in the code holds it back. |

## Checks run on this branch

- `pnpm exec tsc --noEmit`: clean.
- `pnpm lint`: 0 errors.
- `pnpm exec vitest run` with a real Postgres 16 server: 42 files, 203 tests passed.
- `pnpm build`: passed.
- Playwright against the production build, phone and desktop: 6 passed.
