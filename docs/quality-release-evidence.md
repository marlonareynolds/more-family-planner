# More quality release: evidence

For Marlon's review of 2026-10-07 23:38 UTC (five priorities). Branch `claude/project-thread-32i1xh`.
Each item is answered as **fixed and demonstrated**, **implemented, not exercised**, **deferred by decision** or **unresolved**.
"Failing before" means the new test was run against the code as it stood after PR #10 and failed; "passing after" means it passes on this branch.

Whole suite on this branch: 307 tests passed, 7 skipped (was 252 passed before). Typecheck and lint clean (4 old warnings). Every browser journey run on phone and desktop sizes (see the end of this file).

## 1. Privacy leaks across every output

The privacy split (decision card in the thread, recommended option used until Marlon says otherwise; written down in `src/domain/moments.ts`, `withheldFromOthers`):

| Private to the organiser of a surprise or Me time | Shared with the other adult |
|---|---|
| Title, notes, place, activity, preparation tasks, highlights, the planned spending limit | When and how long (shown as busy), who is busy, which children, whether care is needed and who covers it, money actually recorded (under the label "Surprise plan" or "Time for themselves") |

| Item | Answer | Evidence |
|---|---|---|
| A1: a clash with an accepted surprise showed its title on the other adult's card, and in the "can't do that, it clashes with…" error | Fixed and demonstrated | `tests/server/privacy-leaks.test.ts`: "A1: a clash … shows as busy", "a refused change … no leak". Failing before, passing after. The organiser still sees their own title (test passes before and after). |
| A2: the household export named the surprise through its expense line | Fixed and demonstrated | "A2: export labels the expense Surprise plan". Failing before, passing after. |
| A3: the surprise's planned budget (£450) showed in the partner's week and export | Fixed and demonstrated | "A3: budget hidden in week and export", plus "whole week and export carry no secret words". Failing before, passing after. The organiser still sees 45000. |
| Me time: export and week labels | Fixed and demonstrated | "Me time … Time for themselves". Failing before, passing after. |
| Shared info stays shared (recorded money for Me time, £80) | Fixed and demonstrated | "shared information stays shared". Passing before and after (guards against over-hiding). |
| Weather-swap and "activity swapped" notifications could name a surprise to the other adult | Implemented, not exercised | Both now skip anyone who may not see the plan (`src/server/weather.ts`, `src/server/commands/moments.ts`). No test drives a live weather swap yet. |
| Future AI answers | Deferred by decision (rule set) | No AI feature reads the diary today; the Desk's AI reader sees only the letter. Rule: any future AI answer must be built from the same withheld views (week, export) as the screens, never from raw rows. |
| Desk privacy wording | Fixed | AI reader now says: "The letter is sent to Anthropic for Claude, its AI, to read. Anthropic doesn't use it for training, but may keep a copy for up to 30 days for safety checks, as its terms allow. More itself doesn't save the letter." Rule reader: "read here on your phone … isn't sent anywhere or saved. To spot repeats, More compares fingerprints, never the words." |

## 2. The AI spending cap (conservative reservation, not an absolute guarantee)

| Item | Answer | Evidence |
|---|---|---|
| Large upload, uncertain failure: £1.54 reserved but £6.67 recorded | Fixed and demonstrated | `tests/server/desk-ai.test.ts` "large upload uncertain failure records exactly what was reserved". Before: reserved 154p, recorded 667p (fails). After: More counts the letter's size first (a free call that still carries the letter to Anthropic; the count is an estimate, so a 2,000-token margin is added), reserves the most the read should be able to cost, and on an uncertain failure records exactly that. |
| Fallback model billed separately, so the cap wasn't hard | Fixed and demonstrated | "counts a refused attempt and its fallback, each at its own model's price": before 4p (only the answering attempt counted), after 6p (the true cost of both). "the reservation covers the dearest possible read: both attempts, full output, dearest model" checks four letter sizes up to a huge upload; before, the reservation covered one attempt only. Automatic retries are off, so there's no hidden third attempt. |
| Counting fails | Fixed and demonstrated | "can't reach the counting service: no read is sent and nothing is reserved". The counting request itself did carry the letter. The Desk falls back to the rule reader. |
| Wording | Corrected 8 Oct | This is conservative, reservation-based control. If a bill ever exceeded its reservation, More logs it loudly; it can't prevent a charge already made. Exact invoice reconciliation would also need the provider's non-billed refusals and price modifiers. |
| A real read against Anthropic | Implemented, not exercised | Not run from here, to avoid spending Marlon's money. Worth one live read on the preview link. |

## 3. Uncertainty visible before anything enters the diary

Every Desk card now lists what the letter didn't say, and some cards wait for a choice before "Add" works (`src/lib/desk-checks.ts`, `src/components/desk.tsx`).

| Item | Answer | Evidence |
|---|---|---|
| Missing time silently became a 1-hour event | Fixed and demonstrated | Card says "Time not stated, so it goes in as all day."; with a start but no end: "End time not stated. Shown as 16:30, an estimate." and the time reads "about 16:30". The diary entry's notes keep the same line. `tests/domain/desk-checks.test.ts` (new module, so nothing to run before). Still open: a date with no time goes in as all day, which shows as busy all day; the diary does not yet tell "time unknown" apart from a real all-day commitment. |
| Ambiguous dates omitted | Fixed and demonstrated | The AI reader now returns unclear dates marked uncertain instead of dropping them; the card needs "I've checked the date". Test "a worked-out date must be checked". |
| Earlier arrival time discarded | Fixed and demonstrated | "Arrive by 08:30" is kept; the entry starts then and its notes say "Arrive by 08:30; it starts at 09:00." `tests/server/desk-import.test.ts` "keeps place, kit, arrival time and repeats". |
| Early finish classed as merely optional | Fixed and demonstrated | Now a pickup decision: "This changes a pickup. Choose who collects, or leave it out." `desk-read-review.test.ts` (failing before) and `desk-checks.test.ts`. |
| Ambiguous pickups and payment deadlines need a deliberate decision | Fixed and demonstrated | Pickup: choose who collects. Payment: "I'll pay / Sam pays / Not decided yet". Which child: asked when the letter names a year group and there's more than one child. A quote not word for word in the letter must be checked. These cards sit under "needs your decision" and Add stays off until answered. Browser journey passes. |

## 4. Duplicates and follow-through

The server now remembers what the Desk put in the diary (new table `desk_items`, migration 0013). The phone asks "is this already there?" with fingerprints only, so the rule reader's letter still never leaves the phone. Fingerprints are data minimisation, not anonymity: a fingerprint of a guessable title could be matched, so the check also requires membership of the household and current visibility of each entry. Matching is by kind, title, children, date and start time, never a similar title alone.

All in `tests/server/desk-import.test.ts` (14 tests). Before this release there was no server memory and no import command, so none of these could pass: the old Desk added each card separately from the phone.

| Item | Answer | Evidence |
|---|---|---|
| The same letter read twice | Fixed and demonstrated | Second import returns "already"; one diary entry. Browser journey also re-reads the same letter: "Already in the diary: added by you" on both cards. |
| Both parents importing | Fixed and demonstrated | Sam sees "added by Alex"; Sam's import is "already". Both at the same moment: one added, one already, one entry. That simultaneous test runs on the embedded test database; it is not a new real-Postgres multi-session race (the seven real-Postgres tests are the existing ones). |
| Changed notice | Fixed and demonstrated | Changed end time or details: "changed", choose "Update the entry", the one entry is updated. A new start time the same day is a change, not a second entry. |
| Moved notice | Fixed and demonstrated | Same thing on another date within 60 days: "Has it moved?", "Move it" moves the one entry. |
| Siblings and two sessions are legitimate | Fixed and demonstrated | School photos for Mia and for Leo, and a second session at 13:00, are all separate. A hand-made entry with the same name that day is pointed out, but not blocked. |
| Partial imports | Fixed and demonstrated | An import lands whole or not at all; nothing is remembered from a failed one. |
| "Just for me" cards | Fixed and demonstrated | Invisible to the other adult's duplicate check. |
| Keep location, kit, payment instructions, arrival and collection times, recurrence | Fixed for events; partial elsewhere | Place, "what to bring or pay", arrive-by and repeats go into an event. Collection time is now its own field (8 Oct). A trip keeps its destination and times but has nowhere to keep "what to bring" yet. A deadline links to its event or trip when both are in the same letter, or when the earlier one is re-read with it; a deadline-only letter about an older entry can't be linked yet. |
| Link a trip to its payment or consent task | Fixed and demonstrated | A deadline becomes a job linked to its event or trip, even one added from an earlier letter; the job shows "For Year 4 trip to the Science Museum". |
| Jobs need due-time support ("by noon") | Fixed and demonstrated | Jobs take an optional "Due by" time; overdue after noon, not before; the reminder says "by 12:00". Asking the partner to pay sends the usual "can you take this on?" request rather than assigning it. |

## 5. Reliability

| Item | Answer | Evidence |
|---|---|---|
| Rule reader's 13-hour disco ("6:00-7:15pm" read as 06:00 to 19:15) | Fixed and demonstrated | `tests/domain/desk-read-review.test.ts` (9 cases from the review probe, all failing before, passing after), including the £12.50 deadline title, two dated things on one line, the overnight New Year's Eve party. |
| Sign-in redirect flaw | Fixed and demonstrated | `tests/server/reliability.test.ts`: `/\evil.com` used to send you to evil.com after sign-in (failing before); now stays on More. Every odd form (`//`, encoded slashes, control characters) is refused. |
| One notification job's database error rolled back the whole batch | Fixed and demonstrated | Each job now runs in its own savepoint. Test: one bad job plus one good one gives delivered 1, failed 1, and the bad one is retried later. Before: the good one was lost too (error 25P02). |

## Outside this release (by the coordinator's brief)

E4, E7 and E8 were not started. E1 and E2 are partly done by this release (full-detail event capture, due-time jobs, duplicate and update handling); the Desk journey backlog should start from what's here rather than rebuild it. Marlon's point that "100% accurate" overstates things is accepted; measured accuracy belongs to the Desk journey.

## Needs Marlon

1. Database change 0013 was applied to the live database on 8 Oct at about 08:15 UTC, at Marlon's "Apply now". It only adds a table and three empty job columns, so the live app (main) runs unchanged on it; checked: 14 migration journal rows, the new table has row-level security on and no public access. The nightly backup copies every table, so it includes the new one from the next run (02:17 UTC). The corrections need no further database change. After merge, the deployed commit should be checked against the PR's head.
2. One real AI read on the preview link, if he's happy to spend a few pence.

## Browser journeys

All 10 browser journeys (5 journeys, phone and desktop sizes) passed on commit 3e2791a, including the Desk journey, which now also reads the same letter a second time and shows "Already in the diary: added by you" on both cards. The letter's words never appear in anything the browser sends except the titles of what was added.


## Corrections after Marlon's review of 8 October

Reviewed revision: 3e2791a. Corrections are in the commit after dcba8a2 on the same branch. New tests are in `tests/server/quality-corrections.test.ts` unless named otherwise. "Failing before" means the test was run against 3e2791a's code and failed. The weather test was run against main before this PR (7efca29).

| Finding | Answer | Evidence |
|---|---|---|
| Q01 Linked jobs could cross households | Fixed and demonstrated | A link is only accepted for an event or trip in the same household that the adult can see, and job titles are looked up the same way (`src/server/linked.ts`). Tests: another household's shared event and trip are refused; a reference planted straight into the database shows no title; same-household links work; the other adult can't link to a private entry. Both failing before. |
| Q02 Desk updates could overwrite newer changes | Fixed and demonstrated | The card carries the entry's version; if the entry changed since, the update is refused ("was changed in the diary after you checked"). An update now changes only what the letter decides (title, dates and times, place, its own note lines) and keeps people, travel time, sharing and hand-added notes. Repeating entries are never rewritten from a letter. Tests: stale preview conflicts, then a fresh one keeps 30 min travel, "Alex driving" and the adults; repeating entry refused. Failing before. |
| Q03 Fingerprint missed arrival and repeat changes; old state | Fixed and demonstrated | The change fingerprint now includes arrive-by, repeat and repeat end. "Already in the diary" also needs the diary to still match the letter, so a hand edit shows as changed. An entry made private stops appearing in the other adult's check at once. Five tests, all failing before. |
| Q04 Second session called "changed" | Fixed and demonstrated | A same-name entry at another time that day, or on a nearby date, is now a question: "Is this another session, or has the time changed?" with the existing times shown, and "Another session" to keep both. Several matches are all listed and none is picked; updating is then done in the diary. Two tests, failing before. |
| Q05 Partner pickup bypassed agreement | Fixed and demonstrated | "Ask Sam to collect" creates a collection job with a take-it-on request to Sam; nobody is put on the event, and until Sam agrees it shows as asked. Declining leaves it unowned and in sight. "I'll collect" takes it on. The collection time is now its own field from both readers ("closes at 1.30pm" is 13:30). Tests failing before. Not exercised: the request and decline in a browser. |
| Q06 Monthly repeat past its end | Fixed and demonstrated | The count comes from the actual occurrence dates. 20 Oct to 1 Nov is October only; before, on and after the next date; leap day; month end; an end before the start is refused. Failing before (except "on the next one" and "the day after", which were already right). |
| Q07 A malformed AI date failed the whole read | Fixed and demonstrated | Dates are checked without throwing; a bad item is left out and counted ("One thing in the letter couldn't be read properly"); the cost is settled from the provider's usage before the answer is checked, so it is never replaced by the worst case. Failing before. |
| One overall AI deadline | Fixed and demonstrated | Count up to 15s, the read gets what's left of 90s, leaving 30s of the route's 120s to settle and answer. With under 20s left, the read isn't started and nothing is reserved. A read cut off by its deadline keeps its reservation. If the server is stopped mid-read, the reservation stays counted at its maximum and is never released for being old. Tests failing before. Not exercised: a real platform timeout. |
| Weather alert privacy | Fixed and demonstrated | Synthetic forecast: for a surprise family plan only the organiser is told about rain, and the other adult's notifications never name it, including after a swap. Failing on main before this PR. |
| School break for one of two children | Fixed and demonstrated | A break that names no child now asks which child when there's more than one (both readers); an only child is covered as before. `tests/domain/desk-checks.test.ts`. |
| Failed import | Fixed | The cards stay as the person left them and the one that stopped the import says why. |
| Provider wording | Corrected | "Under its standard terms it normally deletes it within 30 days, but may keep it longer where the law requires or a safety review needs it." The letter and the items you add are described separately. |

Still open, by decision or for later: the cap is global, not per household; a real AI read (text, photo, PDF) is a smoke test of the request, not of accuracy, which needs the held-out Desk evaluation; real-phone delivery and assistive-tech tests remain as before.

Whole suite on the corrected revision: 334 passed, 7 skipped (real-Postgres tests run in CI). Typecheck and lint clean (4 old warnings). All 10 browser journeys passed locally.
