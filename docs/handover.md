# Build manager handover

The build manager rewrites this file before a chat is cleared or ends (CLAUDE.md, Roles, D-317). A new build manager
reads it right after CLAUDE.md. It holds no personal data: the repository is public.

**Managing chat:** the chat Matt opened on Oct 28 after the evening hand-off (it took over from
session_01CWeveciiiW2pUvFQtQJ3HK at about 21:05 UTC and is managing now). One manager at a time.

## Update (Oct 30, afternoon Central): release card #2 sent, waiting on Matt (read this first)

- **Live:** v4.5.19 at ceba846. **Staging:** GREEN at 2f50284 (v4.5.19+184), the release candidate. npm test, smoke, all 11 harnesses, the whole-release code review (no blockers) and the UI review (76/100) are done. No agents are running.
- **Waiting on Matt:**
  - the one real run: he presses Make a plan or Remake on staging and reports the time, which also sets B-549's "usually" line;
  - "ship 2f50284". Then run `ship live` with a running-sessions query and pwa-live.yml (he approves in the GitHub live environment).
- **Next after release, in order:**
  1. B-522: ticked plan minutes off the day's list and on past days don't count (staging data, Oct 29: 100 min ticked, Progress shows 2); Record bypasses E.sessionMinutes.
  2. The course fallback for sessions with no folder (Chapter 9 counts as NUR 112).
  3. The UI review fixes and the review's backlog lines (suggestion chips, Undo toast at 390, Cards row alignment, wide Today rows, draft Put away on own exams, Undo for the latest tick only).
  4. B-577: not reproduced; ask Matt for the width and course if he sees it again.
- **Lessons today:**
  - Builders pushed unformatted code four times. The ev-builder skill now formats and runs the format test before every push (B-586).
  - Skipping heavy checks let 2 breaks through (B-579, B-580). Run the full harness pass before a card.
  - Synthetic data missed drafts and real minutes, so check the staging data before every card.
  - A builder hand-edited chart/tasks.json for B-586's milestone. Tell builders never to do that.

## Update (Oct 30, early morning Central): staging look done, view lanes running (read this first)

- **Live:** v4.5.19 at ceba846. Matt is asleep. Nothing waits on him until release card #2.
- **Staging:** GREEN at 9a8cbe5 (v4.5.19+123). It has the tokens, every component lane and the smoke fix.
- **Done tonight:**
  - D2c (37b0df8): legacy is dropped through legacy-carry.css, with carry.mjs keeping its precedence.
  - Tokens (267db1c).
  - Components:
    - buttons and motion (949176b, 0f772e7)
    - Line, check and no outlines (08f4f1d)
    - type, toast, notice, meter and the ✦ line (ca4f404)
    - badges (9a8cbe5)
  - B-574: the smoke workflow was red for 25+ commits on smoke:pwa's plant; fixed at 7c469ba.
- **Running, view wave 1 (4 agents):** Today B-564/565/566, Study B-567/568, Notes and Record B-569/570, and Conversation B-572. A liveness Monitor watches them.
- **Next:**
  1. Progress B-571.
  2. Ship staging.
  3. One real end-to-end run: time a plan, and set B-549's "usually" line from it.
  4. One whole-release code review.
  5. Release card #2. Live waits on Matt's word.
- **Running late:** about an hour behind the plan given to Matt. Card ETA ~5 to 6 am.
- **Open bars for the view lanes:** B-541's Today column, B-544's Today rows, B-546's toolbar rows, B-542's budget hairline, and B-548's Undo on approve and save.

## Update (Oct 29, ~8 pm Central): the UI build tonight

- **Live:** v4.5.19 (ceba846). It carries flashcards complete, the bug and probe fixes, and the invisible Proprietary skeleton.
- **The UI polish design passed** (round 5, with the L frame restored). The doc is https://claude.ai/artifact/9w83U8c79EjxijPXqs9xKi, the reference is in docs/design/ui-polish/ (on staging at /reference), and the tasks are B-539 to B-572 (D-392 to D-396).
- **How the look and view lanes run:** docs/design/ui-polish/LANES.md (D-397). Brief every lane from it.
- **Tonight's order (D-390: by completion, never time-gated):**
  1. E2 and E3 finish the E.V. window (B-514). U1 finishes app-wide behaviour (B-552 to B-561, B-563).
  2. Staging card #1.
  3. Cleanup B-515 in lanes A (foundation, running), then B and C in parallel, then D last, per scratchpad/design-system/cleanup-map.md.
  4. The tokens lane, then 5 component lanes, then one staging look, then up to 9 view lanes.
  5. One real run, one review, release card #2. Live only on Matt's word.
- **Matt's direction:**
  - desktop first (D-394);
  - graceful motion with no scale;
  - neutral Linear-like look with no lines (D-392);
  - dot badges (D-395);
  - his four approved items (D-393);
  - no 1:1 gate (D-396);
  - split slow steps into parallel lanes by files.
- **Leftover naming:** the Arc, not "flower" (renamed in B-515).

## Update (Oct 29, ~noon Central): v4.5.18 live; Proprietary design system started; three builders running

- **Live:** v4.5.18 at db90509, recorded GREEN. It contains flashcards part 1 (B-487), the stringified-plan fix (B-491), the new icon (B-490) and the stray verify words fix (B-493).
- **The UX map probe (D-369) is done.** Doc: https://claude.ai/artifact/Ts4o6bG8FjQF3Dkyr8Rx37. It records 66 findings, a rubric baseline of 2.6/5 and 19 tasks to add. Matt is marking it up with agree/disagree; file its look tasks after his pass. Its 42 behaviour findings are filed as B-517 to B-535, milestone "UX probe fixes", plus B-497 to B-500. The probe method is in the workflow map.
- **Proprietary (D-370, D-371 to D-387):** E.V.'s own design system, with its reference page named the Gallery. Doc: https://claude.ai/artifact/Lf1aKShdVK5ojjjgwk5yfv.
  - D-384 (Matt): it is built now, before the UI polish and before the Phase 3 review.
  - D-385 (Matt): one-time exception allowing up to 4 builders in tracks or lanes with file ownership. Staging stays serialized, and live stays on his word.
  - Tasks B-501 to B-516. B-503 and B-504 are done. The component list is 16 components plus 7 patterns, in page/app/01-ui.js under the `DS` namespace (D-386). Harness selectors follow D-387.
  - The roadmap (v11) carries the calendar: Gallery Oct 29, components Oct 30, pilot Oct 31, views Nov 1–2 (staging only around Matt's Sunday exam), E.V. window Nov 3, cleanup Nov 4, polish about Nov 5–6.
- **Running now** (D-358: check each one's status first):
  - The flashcards track has B-488 built at 44c867e (with B-494) and is now on B-489, then B-495, then B-496.
  - The bugs track is on B-498 (cross-course mixing), B-499, B-500, B-497.
  - The Proprietary track is on B-502, then B-501. Next after those: B-505 foundations, then B-506 Gallery.
  - When bugs and flashcards wrap up, a lane planner cuts B-507 to B-514 into lanes.
- **Tonight:** one staging release (bugs + flashcards + the invisible Proprietary skeleton + Gallery), then one real run, one review and a card. Live only on "ship <sha>".
- **Waiting on Matt:**
  - His markup of the UX map.
  - The Max-plan choice, only if the calendar slips past Nov 23.
  - Installing the new icon: remove the app from the home screen and re-add it.
- **Filed small items:** B-492 (staging read-back retry), B-495, B-496.

## Update (Oct 29, morning Central): v4.5.17 live

- **Live: v4.5.17 at 91847f6**, recorded GREEN (record and the ev-live app; the claude.ai page is frozen, D-367).
  Carries everything in the overnight batch (see the 5 am entry below).
- **Next, in order:** B-485 (flashcards routed by code; long general answers), B-484 (dosage sets reach the asked
  count), B-486 (day-item plan refs by plan id), B-475 (retire the staging duplicate exam), then the older open items
  (B-451, B-436, B-457, B-458, B-460, B-468, B-471) and the stale-backlog pass. B-473 waits for a Mac sitting.
- Nothing running.

## Update (Oct 29, ~5 am Central): overnight batch on staging, card sent, waiting on Matt

- **Live: v4.5.16 at f39d054.** **Staging GREEN at 91847f6** with: B-472, B-461/B-477, B-448, B-464, B-481/B-480
  (three fix rounds: null weak spot, answer in stem, over-strict rationale check), B-483 (two fix rounds: graded plan
  ref, legacy tick scoped to its plan), B-478, B-479 (kind accepted; end-to-end still fails, B-485), B-462, B-463,
  B-474, B-482, B-467 (deploy errors as annotations). One whole-release code review done (its two findings fixed).
- Open follow-ups: B-484 (dosage sets come back short), B-485 (flashcards still routed to a general job), B-486
  (day-item plan refs by exam id). Cloudflare asset uploads failed for ~1 h (code 10013); a re-run went through.
- **Waiting on Matt:** his test on staging and "ship 91847f6". Then ship live (tags v4.5.17; re-ship staging), the
  live calls, pwa-live dispatch and his Approve in GitHub. Heartbeats stop once the card is out.

## Update (Oct 28, ~11 pm Central): overnight run (Matt asleep; he asked the team to keep working)

- **Live: v4.5.16 at f39d054.** Staging GREEN at c83d9c4 with B-472 (page no longer published), B-461 + B-477
  (Ask for changes edits that plan by id; Add exam beside Coming up; plain failure text), B-448 (day arrows on Today).
- **Overnight order, one builder at a time, each shipped to staging as it lands:** B-464 (UI look fixes, running),
  B-481 (wrong dosage answer keys: code recomputes calculation items; top priority), B-483 (plan tasks and Today share
  one tick; approve puts tasks on Today), B-478 (objectives ask scoped to the next exam), B-479 (flashcards as a
  Quizlet block), B-480 (sets top up to the asked count), B-462, B-463, B-474, then B-482 (Practice sets card in Study).
  Then one whole-release code review and the card. **Matt (Oct 28, late): keep working through the backlog as long as there are tasks and
  bugs; he checks in in the morning.** The card goes out when the batch is ready (aim for his ~5 am CT wake). No live
  deploys without his word.
- A send_later heartbeat every 60 min wakes the build manager to check builders and continue.
- Matt's call (Oct 28): plans stay one per exam; no shared time or multi-exam plans; small fixes only.

## Update (Oct 28, ~9 pm Central): v4.5.16 live

- **Live: v4.5.16 at f39d054**, recorded GREEN (record, page, ev-live app). It carries B-465 (exams for every course,
  Add exam; derivation waits for date edits, skips past, courseless and non-exam titles), B-469 (Put away a plan) and
  B-470 (thinking blocks, 16k plan edits, no "[cards: …]"). Live dry-run of exam derivation before ship: 0 writes.
- Matt's next steps on live: NUR 112 Put away then Make a plan; BIO 201 Add exam for Sunday's Ch 9 exam (his Ch 9
  dates were only entered on staging) then Make a plan.
- **Next, in order:** B-472 (stop publishing the claude.ai page, D-367), then B-461, B-448, B-464, B-462, B-463, B-474,
  B-475 (retire the staging duplicate exam). B-473 waits for a Mac sitting. Ops: B-467 (red nightly), B-468 (brief
  reads stale health).
- Ship gotcha seen tonight: after a dispatched app deploy fails, re-running ship prints "reads to make" for calls it
  thinks were made; `rm dist/ship-<target>.json` resets the checklist. tool-result.mjs saves the newest ArtifactData
  result, so save each read right after making it.

## Update (Oct 28, ~8 pm Central): plan-fix release on staging, waiting on Matt's test

- **Live:** v4.5.15 at f0bd996, recorded GREEN (record, page and the ev-live app).
- **Staging GREEN at fd4f69f** (v4.5.15+27): B-465 (exams for every course from calendar dates, Add exam; ids like
  BIO201.20261028, now in spec.collections.exams.key), B-469 (Put away a plan, marked in planedits/<exam>.retired,
  nothing deleted), B-470 (thinking blocks assembled and never replayed empty; plan-edit max_tokens 16000; the
  "[cards: …]" marker stripped). Real runs in the staging app: BIO 201 plan made; NUR 112 plan put away, remade, and a
  rework edit applied. Four staging deploys this release (Matt was told; the extra two were blockers found by the runs).
- **Running:** one whole-release code review (f0bd996..fd4f69f). **Waiting on Matt:** his test in the staging app and
  his word "ship fd4f69f". Then: ship live --matt-ok (it tags v4.5.16; re-ship staging once), the live calls, pwa-live
  dispatch and his Approve in GitHub.
- **Next:** B-472 (the claude.ai page stops being published, D-367), then B-448, B-461, B-464, B-462, B-463, B-474.
  B-473 waits for a sitting at the Mac. B-467 (red nightly) and B-468 (brief's stale health read) are small ops tasks.
- Staging e2e scripts (scratchpad, may not survive): open.cjs, plan2.cjs, putaway.cjs, edit.cjs, say.cjs under
  scratchpad/e2e; they open the staging app with the staging Worker token from system/worker.json.

## Update (Oct 28, late evening Central): v4.5.15 going live; the next batch running

- **v4.5.15 is tagged at f0bd996** (a81e819 + the B-450 harness fix + B-466, which removed the R-06 gate; the hashed
  build content equals a81e819's). Nightly 40766119523 at 5c4e68a was red (filed B-467; its log is unreadable from the
  sandbox), so B-466 went first, as Matt said. Staging GREEN at f0bd996 (recorded). The live record and page carry
  f0bd996; the pwa-live run 40774588837 passed its gate on R-02 alone and **waits on Matt's Approve in GitHub**. After
  it finishes: `node tools/pwa-app.mjs readback live`, the three live system reads, `ship live --matt-ok` again until
  GREEN (it records the deploy; tags.yml then pushes the v4.5.15 tag). Live versions written by this ship: manifest 46,
  spec 57, environments 46, yourturn 20.
- **Health:** the live Worker's health/current was 2 h old and clean at 21:20 UTC. `brief` reads the record's
  ArtifactData copy, which froze at the Oct 27 move to D1, so it wrongly says 44 h stale (B-468). Read live health with
  `node core/cli.mjs api pull --worker <saved system/worker.json> --reads <[{"collection":"health","out_dir":...}]>`.
- **Inbox triaged:** B-460 to B-468 are tasks (B-460 only when cheap, Matt).
- **Next batch, in progress (one release, ETA given to Matt: card about 10 pm CT Oct 28):** B-465 (builder running),
  then B-448, B-461, B-464, B-462, B-463, one builder agent at a time; each shipped to staging as it lands; one real
  end-to-end run (a BIO 201 plan on staging); one whole-release code review (data, cost, security, crashes); one
  20-minute UI click-through; then the card.

## Update (Oct 28, evening Central): HAND-OFF to a new chat (Matt asked)

**Read first:** "Delivery first" and "Guardrails" (D-366) in CLAUDE.md. They replace the review-loop workflow that cost a whole day on one release.

**Where things stand**

- **Live is half-deployed.**
  - The record and the claude.ai page are on v4.5.15 (a81e819).
  - The phone/PWA app (ev-live Worker) is still on 219358d.
  - pwa-live run 40763121785 was refused at its gate because no green GitHub nightly existed at a81e819. R-06 is retired by D-366, but the gate code still enforces it; B-466 removes it.
- **Main is at 5c4e68a**: a81e819 plus one harness-only fix (the phone toolbar check allows Start session on its own row). A GitHub nightly was started at 5c4e68a (run 40766119523) and nobody is watching it.
- **To finish the release** (the next chat's first job; Matt already said "ship a81e819", and 5c4e68a only adds a test change):
  - **If nightly 40766119523 is green:** run `ship live --matt-ok` at 5c4e68a. It tags v4.5.16 and asks for staging to carry it, so re-ship staging once. Then make the live calls, dispatch pwa-live, and Matt taps Approve. Live versions at the last ship: manifest 45, spec 56, environments 45, yourturn 19. Staging versions: manifest 324, spec 321, environments 321, yourturn 197.
  - **If it's red:** don't chase it. One builder does B-466 (remove the R-06 gate from tools/pwa-live.mjs and chart/rules.json), then ship.
- **Proved on staging:** a real NUR 112 plan (job-20261028-newplan-nur112-9). The path was 202 → Durable Object → streamed Sonnet; it finished in about 215 s with 90 tasks, a score of 87 and a cost of about $0.55. A Haiku edit also worked.

**Next batch, in Matt's order**

1. **B-465:** BIO 201 and other courses get exams. Detect exams for every course and let Matt add one by its date, so any course can get a plan. This is the obvious bug he hit.
2. **B-448:** day arrows on Today, to go back to earlier days.
3. **B-461:** Ask for changes reaches the plan edit reliably.
4. **B-464:** the UI review fixes.
5. **B-462, B-463.**

B-457, B-458 and B-460 only when cheap. The architecture review (B-415) and the consolidation follow, per the roadmap.

**Running now:** nothing. All agents are stopped. The nightly 40766119523 runs on GitHub by itself.

## Update (Oct 28, midday Central): PAUSED for Claude peak hours (Matt)

- **Live:** v4.5.14 at 219358d. **Staging:** v4.5.14+104 at e26d231, ship staging GREEN.
- **The batch on staging** (since live): B-446, B-447, B-449, B-450, B-452, B-453, B-454, B-455, B-456, B-389, plus D-357 to D-364. It carries study plans and the merged plan screen, the conversation tweaks, the notes clock on saved notes, the weak-spot objective picker and tap-to-start plans (D-362).
- **Rules now:** at most two review rounds and two fix waves per release (D-364 supersedes D-361). Open gaps go on the card. No hand-made documents in records (D-363).
- **Blocking the card:**
  0. **Builder's report (fix pushed as d359e77; not on staging, not reviewed yet).**
     - Matt's job job-20261028-newplan-nur112-5 did reach the Worker. It has been `running` since 11:58:32 UTC and never finished, so the long silent request (B-459) likely died on his device too.
     - The connector error came from the page wrongly reporting mcp_unavailable for every job started in the app; that is fixed.
     - A stalled new-plan job now frees "Making…": after 2 minutes with no result, or 15 minutes still running.
     - On resume: review d359e77, then B-459 (run the plan in the Worker's background so the page doesn't hold the request). B-459 is likely needed before plans work at all.
  1. **Make a plan fails in the staging PWA.** Matt tapped it and got an error about needing a remote connector, then "Making…" stuck.
     - A builder was diagnosing and fixing it in its own worktree, /tmp/claude-0/-home-claude/018a6162-6713-5595-b2c2-e8ae330cda7f/scratchpad/b456stuck, WIP branch b456-stuck-wip if not pushed.
     - Its brief: the PWA must always reach the Worker job route; "Making…" never sticks (a job with no result releases the guard after ~2 min); the claude.ai page says plans are made in the app.
     - On resume: read its report, review it (deploy/data path), ship staging, and have Matt tap Make a plan on the staging PWA. This sandbox's proxy cuts requests at 30 s, so a Sonnet plan can't finish from here.
  2. **The full `npm run check` must be re-run fresh** at the final commit. The last run was spoiled by a builder working in the ship worktree.
  3. **The UI rescore was stopped.** Re-run it at the final commit. The first score at 8c274d3 was 74/100; fix wave 1 landed at e0f3715.
- **Card notes so far:** /tmp/claude-0/-home-claude/018a6162-6713-5595-b2c2-e8ae330cda7f/scratchpad/card-notes.md (scratch; may not survive). Open items for the card:
  - B-457: a Sonnet ask cut in transit can be under-counted.
  - B-458: the staging check's 'E.V. app' source plus a pipeline writer.
  - B-459: the plan ask is one long silent request; a dropped connection loses it, so make it background.
  - The code reviews' minor items.
- **Next batch:** B-457, B-458, B-459, B-448, B-451, B-436. Parked for the architecture review (B-415): B-443, B-444, B-445.

## Update (Oct 28, early morning Central)

- Live is **v4.5.14 at 219358d** (B-429, B-430, B-431, B-434, B-435, B-437 to B-442), recorded GREEN. Staging carries
  the same build. Matt has been told what to try.
- D-351: the manager never builds. One builder agent at a time after a release; lanes only for feature sprints.
- Running builders (background agents of this chat): **B-449** study plans (exception, top priority, D-354; Sonnet only
  for exam plans D-355, Haiku patches for edits D-356) and **B-452** Conversation tweaks (scroll feel, no pills, no Go
  deeper, Back to now centred and lower). A fresh second review of the **B-446** fix (1268102) is running; B-447 had no
  gaps. Those four go to the next batched release.
- After B-449 lands: launch the **B-450** builder (study plan UI) from mock-up v3 (scratchpad planmock/v3) plus the UI
  reviewer's five fixes: done count matches ticks, phone popover below the toolbar, carry-over once inside Today, phone
  toolbar rows laid out on purpose, wording and fixture slips.
- Queue after that: B-448, B-451, B-436. Parked for the architecture review (B-415): B-443, B-444, B-445.

## Update (Oct 27, late evening)

- Live is **v4.5.13 at 6bd6483** (B-432 keyboard, B-433 tab bar and Record), recorded GREEN. Matt has not yet reported
  how it behaves on his iPhone.
- **Batch at 02066e6 is GREEN on staging with a green nightly** (B-429, B-430, B-431, B-434, B-435; UI review 80/100,
  code reviews No gaps after one fix round). Card sent; **live waits on Matt's word for 02066e6**. ship live will re-tag
  it, so re-ship staging first; R-03 via D1 sessions.
- B-435 (D-349): Claude ceilings are a D1 setting: `PUT /api/claude/limits {hour, day}` on the Worker with the run-API
  client (core/runapi-client.mjs, scratchpad live|stg/system/worker.json). Matt chose 500k/hour, 1.5M/day and will raise
  his Console spend limit. Matt wants batched releases, not tiny ones.
- Next: B-436 (UI review fixes), B-421 (three of three green nightlies now: mark done), B-424 live drill check.

## Update (Oct 27, evening)

- Live is **v4.5.12 at 74499d4** (B-418, B-428), recorded GREEN.
- **Phone fix release at 6bd6483 is GREEN on staging with a green nightly** (B-432 keyboard, B-433 installed-app tab bar
  and Record overflow; UI review 94/100, its gaps fixed). The card went to Matt; **live waits on his word for 6bd6483**.
  ship live will re-tag it v4.5.13, so re-ship staging first (as at 74499d4). R-03: read D1 sessions via the Worker.
- After live: Matt tries on his iPhone (keyboard, tab bar on E.V., Record). The tab-bar fix rests on an iOS hypothesis
  (standalone viewport shortened by the status bar when the page cannot scroll).
- Open next: B-429, B-430, B-431, B-434 (release-keyed page files), B-421 (two of three green nightlies).

## Where things stood (Oct 27, earlier)

- Live is v4.5.11 at 94c0035 (ev-live Worker and D1), recorded GREEN.
- **Release candidate v4.5.11+18 at 74499d4 is GREEN on staging** (B-418 read-along and the Worker's Claude ceilings;
  B-428 phone composer scroll lock). Full nightly green (run 40564393339). UI review 80/100, no blocker. Release code
  review: no blocking gaps. The release card went to Matt; **live waits on his word for 74499d4**.
- Phase 2 (D-347): at least two weeks of stability, fixes only, to about Nov 9; then the architecture review (B-415) per
  the doc Matt owns: https://claude.ai/artifact/WnTyVKBRYFdYxEyvhtvnLs.

## Next (after the live ship; staging must stay at 74499d4 until then)

- B-429: claude.js body-read throw keeps the read mark; four untested paths.
- B-430: read-along's limit toast repeats about every 11 minutes.
- B-431: the UI review's five look fixes (New button edge, Back to now pill, toggle off state, exam date wrap, 1 px).
- B-421: mark done after three green nightlies (two so far: ac87cd1 and 6bb4290).
- B-424 needs a live restore-drill firing after the next live ship.
- After a week live: read GET /api/claude/usage on live to see whether read-along and chat crowd the hourly ceiling.

## Waiting on Matt

- His OK for 74499d4 live.
- Try the swipe on his iPhone after live (B-428 was proven in Chromium emulation, not iOS).
- Re-create the staging restore-drill Mac task with him present (its prompt predates 8d3dc1b; D-342).

## Later

- B-414 window, B-415 review, B-416, B-417 course, B-422 trash, B-423 tier switch.
