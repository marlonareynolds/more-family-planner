# More quality release: evidence

For Marlon's reviews of this branch (`claude/project-thread-32i1xh`, PR #11): 2026-10-07 23:38 UTC (five priorities, sections 1 to 5), 2026-10-08 08:45 UTC (Q01 to Q07) and 2026-10-08 10:29 UTC (R1 to R4) and the R1 to R4 closeout at 11:13 UTC (last two sections).
Each item is answered as **fixed and demonstrated**, **implemented, not exercised**, **deferred by decision** or **unresolved**.

### Current state (read this first)

- **Revision for review:** the head of PR #11 after the R1 closeout commit (it follows 8974b3c). Totals: 348 tests passed, 7 skipped (real-Postgres tests run in CI); typecheck and lint clean (4 old warnings); all 12 browser journeys (6 journeys, phone and desktop) passed locally. CI on this commit is recorded in PR #11; the previous commit, 8974b3c, passed CI run 37766446004.
- **Schema:** one database change in this release, 0013 (the `desk_items` table and three job columns), already applied to the live database on 8 Oct at about 08:15 UTC. The Q and R corrections add no schema change.
- **Earlier sections are history.** Sections 1 to 5 describe the first pass (3e2791a); the "Corrections" sections say what changed after. Where a later correction replaced a claim, the earlier row says so.
- **Acknowledged limitations, still open:** a date with no time goes in as all day and so shows as busy all day; a trip has nowhere to keep "what to bring"; a deadline-only letter can't be linked to an older entry; the AI allowance is one cap for all households, not per household; extraction accuracy has not been measured on unseen letters, repeated runs or imperfect photos; real-phone and assistive-technology checks have not been done; the AI cap is a conservative reservation, not an exact guarantee.
- **Before release:** check that the deployed commit is the merged head of PR #11, and that the nightly backup ran with `desk_items` in it (backup copies every table). A live AI read checks the plumbing only, not accuracy.

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
| Fallback model billed separately, so the cap undercounted | Fixed and demonstrated | "counts a refused attempt and its fallback, each at its own model's price": before 4p (only the answering attempt counted), after 6p (the true cost of both). "the reservation covers the dearest possible read: both attempts, full output, dearest model" checks four letter sizes up to a huge upload; before, the reservation covered one attempt only. Automatic retries are off, so there's no hidden third attempt. |
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
| Changed notice | Fixed and demonstrated | Changed end time or details: "changed", choose "Update the entry", the one entry is updated. (First pass also said a new start time the same day was a change; superseded by Q04 below: that is now asked as "another session, or has the time changed?") Since R2/R3, an entry with a linked job or with old mixed notes is changed by hand instead. |
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

History: all 10 browser journeys (5 journeys, phone and desktop sizes) passed on commit 3e2791a, including the Desk journey, which now also reads the same letter a second time and shows "Already in the diary: added by you" on both cards. The letter's words never appear in anything the browser sends except the titles of what was added.


## Corrections after Marlon's review of 8 October (08:45 UTC)

Reviewed revision: 3e2791a. Corrections are in the commit after dcba8a2 on the same branch. New tests are in `tests/server/quality-corrections.test.ts` unless named otherwise. "Failing before" means the test was run against 3e2791a's code and failed. The weather test was run against main before this PR (7efca29).

| Finding | Answer | Evidence |
|---|---|---|
| Q01 Linked jobs could cross households | Fixed and demonstrated | A link is only accepted for an event or trip in the same household that the adult can see, and job titles are looked up the same way (`src/server/linked.ts`). Tests: another household's shared event and trip are refused; a reference planted straight into the database shows no title; same-household links work; the other adult can't link to a private entry. Both failing before. |
| Q02 Desk updates could overwrite newer changes | Fixed and demonstrated | The card carries the entry's version; if the entry changed since, the update is refused ("was changed in the diary after you checked"). An update now changes only what the letter decides (title, dates and times, place, and its own note lines, which since R3 sit under "From the letter:") and keeps people, travel time, sharing and hand-added notes. Repeating entries are never rewritten from a letter. Tests: stale preview conflicts, then a fresh one keeps 30 min travel, "Alex driving" and the adults; repeating entry refused. Failing before. |
| Q03 Fingerprint missed arrival and repeat changes; old state | Fixed and demonstrated | The change fingerprint now includes arrive-by, repeat and repeat end. "Already in the diary" also needs the diary to still match the letter, so a hand edit shows as changed. An entry made private stops appearing in the other adult's check at once. Five tests, all failing before. |
| Q04 Second session called "changed" | Fixed and demonstrated | A same-name entry at another time that day, or on a nearby date, is now a question: "Is this another session, or has the time changed?" with the existing times shown, and "Another session" to keep both. Several matches are all listed and none is picked; updating is then done in the diary. Two tests, failing before. |
| Q05 Partner pickup bypassed agreement | Fixed and demonstrated | "Ask Sam to collect" creates a collection job with a take-it-on request to Sam; nobody is put on the event, and until Sam agrees it shows as asked. Declining leaves it unowned and in sight. "I'll collect" takes it on. The collection time is now its own field from both readers ("closes at 1.30pm" is 13:30). Tests failing before. The request and acceptance are now exercised in a browser journey (R section); the decline is a server test only. |
| Q06 Monthly repeat past its end | Fixed and demonstrated | The count comes from the actual occurrence dates. 20 Oct to 1 Nov is October only; before, on and after the next date; leap day; month end; an end before the start is refused. Failing before (except "on the next one" and "the day after", which were already right). |
| Q07 A malformed AI date failed the whole read | Fixed and demonstrated | Dates are checked without throwing; a bad item is left out and counted ("One thing in the letter couldn't be read properly"); the cost is settled from the provider's usage before the answer is checked, so it is never replaced by the worst case. Failing before. |
| One overall AI deadline | Fixed and demonstrated | Count up to 15s, the read gets what's left of 90s, leaving 30s of the route's 120s to settle and answer. With under 20s left, the read isn't started and nothing is reserved. A read cut off by its deadline keeps its reservation. If the server is stopped mid-read, the reservation stays counted at its maximum and is never released for being old. Tests failing before. Not exercised: a real platform timeout. |
| Weather alert privacy | Fixed and demonstrated | Synthetic forecast: for a surprise family plan only the organiser is told about rain, and the other adult's notifications never name it, including after a swap. Failing on main before this PR. |
| School break for one of two children | Fixed and demonstrated | A break that names no child now asks which child when there's more than one (both readers); an only child is covered as before. `tests/domain/desk-checks.test.ts`. |
| Failed import | Fixed | The cards stay as the person left them and the one that stopped the import says why. |
| Provider wording | Corrected | "Under its standard terms it normally deletes it within 30 days, but may keep it longer where the law requires or a safety review needs it." The letter and the items you add are described separately. |

Still open, by decision or for later: the cap is global, not per household; a real AI read (text, photo, PDF) is a smoke test of the request, not of accuracy, which needs the held-out Desk evaluation; real-phone delivery and assistive-tech tests remain as before.

At 7f1ce52 (superseded by the totals at the top): 334 passed, 7 skipped (real-Postgres tests run in CI). Typecheck and lint clean (4 old warnings). All 10 browser journeys passed locally. GitHub CI run 37755105015 on 7f1ce52: check (unit, real-Postgres, typecheck, lint, migration, build) and e2e both passed.


## Corrections after Marlon's second review of 8 October (10:29 UTC)

Reviewed revision: 7f1ce52. "Failing before" means the new test was run with 7f1ce52's code and failed. Tests are in `tests/server/quality-corrections.test.ts` (R1 to R3) and `tests/server/desk-ai.test.ts` (R4). No schema change.

| Finding | Answer | Evidence |
|---|---|---|
| R1 A "just for me" pickup put its private title in the shared collection job | Fixed by a server-enforced restriction | The import refuses any "just for me" card that has a pickup (whoever collects, or "not decided yet") or is a job: "a collection is shared with the household. Untick “Keep this just for me” so the collection can be shared." Nothing lands. "Keep this just for me" is no longer shown on pickup cards. As a second guard, a collection job never copies a private entry's title. Tests: the refusal (failing before: 7f1ce52 accepted it and put "SECRET spa day" into the job's notes); a private plan and a shared pickup the same day, where Sam's full Jobs response, his notifications and his household export contain no private title, while "Collect Mia at 12:30", the date and the request to him remain (passing before too: it guards that the shared care need still shows). |
| R2 Collection time missing from change detection; moving the event left the job stale; no way to correct the time | Fixed (detection, correction) plus a server-enforced restriction (updates) | The change fingerprint now includes the collection time, added only for pickups so other stored fingerprints don't change. Each pickup card has a "Collect at" time to correct a misread before adding, and the job, its title and its day-before reminder use it. The Desk no longer moves an entry that has a job hanging off it (collection or payment): the card says "A job hangs off it … change the entry in the diary and the job in Jobs. Whoever agreed to the job then sees the new time", "Update the entry" isn't offered, and the server refuses it anyway. A changed letter that adds a pickup to an entry with no job gets its collection job. Tests: collection-time-only change reads as changed; after Sam accepted, a moved date is refused and the entry, the job's date, time, owner and reminder are unchanged; the same while the request is pending; a corrected time is the one the job uses (passing before: the server already used the time sent, the gap was the missing field on the card); a pickup added by a changed letter. All others failing before. Not built: changing the job together with the entry (with a fresh request to whoever agreed); that is the follow-up if the restriction proves awkward. |
| R3 Old and new instructions side by side (£3 and £5) | Fixed and demonstrated | The Desk writes its lines under a heading, "From the letter:", one per line starting "• ". A changed letter replaces that block whole; anything the parent wrote above or below it is kept. Notes from before this change, with no heading, can't be told apart, so the update is refused with "change it in the diary" and nothing is altered. Superseded instructions are not kept in the entry (the letter itself was never kept); the entry just shows the current ones. Tests: amount, arrival and kit changed together, only the current lines remain, "Alex driving" survives, repeating the same update gives identical notes; legacy mixed notes refused untouched. Failing before. |
| R4 Time spent waiting to reserve wasn't taken off the read | Fixed and demonstrated | The time left is worked out again after the reservation lands, before anything is sent. If under 20s remain, the reservation is released (nothing was sent, so nothing billed) and the letter is read the simpler way. Waiting for another read's reservation is limited to 10s. Settlement still fits in the route's time. Tests: 45s spent reserving gives the read 40s, not 85s; a reservation landing at 80s sends nothing and the reservation reads "released". Both failing before. The existing uncertain-timeout test still passes. Not exercised: a real lock wait between two database sessions. |
| Browser journey | Demonstrated, phone and desktop | `tests/e2e/journeys.spec.ts` "a pickup from a letter": Alex pastes "school finishes at 2pm", corrects "Collect at" to 13:45, chooses "Ask Sam to collect" (no "Keep this just for me" on the card), adds it; Sam sees "Collect the children at 13:45" with "asked if you could take this on", taps "Yes, it's mine" and it reads "Yours"; Alex reads the letter again and the card explains why the Desk won't move it, with no "Update the entry". |
| Source comments promising an absolute cap | Corrected | `src/server/desk-ai.ts` now says the cap is a close, conservative bound resting on an estimated token count, not an exact one. |


## R1 closeout after Marlon's review of 8974b3c (11:13 UTC)

R2, R3 and R4 were closed for this restricted release; R1 had one remaining path. No schema change.

| Finding | Answer | Evidence |
|---|---|---|
| R1 remaining path: a Desk update adds a pickup to an entry that was imported shared and later made private in the diary; the card's "just for me" was off, so the collection job copied the private title | Fixed by a server-enforced restriction | The collection job now takes privacy from the entry as stored, in the same household, not from the card: a private entry gets no collection ("is private in the diary, and a collection is shared with the household. Add the pickup in Jobs yourself, or share the entry first.") and the whole import is refused. The Desk card says the same and doesn't offer the update. Children's names for the job title are also looked up only within the household. Test (`quality-corrections.test.ts`, "R1 (closeout)", once each for "I'll collect", "Ask Sam", "Not decided yet"): shared import, Alex makes it private, a fresh preview of the changed notice with a pickup, update with "just for me" off. Refused; no job; the entry's version, privacy and notes unchanged; nothing queued; Sam's notifications, full Jobs response and export carry no private title. All three failing before on 8974b3c (the update succeeded). The positive case, a pickup added to a genuinely shared entry, still passes. |
