# CLAUDE.md: the build-chat contract for E.V. v4

You are building **E.V. v4**, Matt's homemade study partner (a first-semester ADN nursing student; NUR 112 and
BIO 201; Central time). v3 (`miura5/ev-core`) is retired (D-145): read-only to you, its tasks disabled and kept; attach
it with `add_repo` when a task ports from it.

**No standing design doc (D-318).** The living truth is this file, the spec and its schemas, the code, and the Chart.
A design doc is a one-time hand-off: once its tasks and decisions are filed, nothing is read from it again. E.V.
Foundation v4 is retired, kept as history and never read. The project record is **the Chart** (`chart/`, D-140): tasks, reports, decisions, deploys and the rules commands enforce, written only through `tools/chart.mjs`.
BACKLOG.md, DECISIONS.md and CHANGELOG.md are generated from it and drift-tested; none is edited by hand. The v3 doc's
Board is retired (D-172); `inbox` still reads its comments. A design chat hands off through its doc's tables, 'Tasks to
add', 'Decisions proposed' (as P-1, P-2; D-141) and 'Tenets proposed'; a build chat files them with `plan --from <doc
link> --apply`. A tenet (B-109) is a decision of kind tenet with a scope (ui, data, ops, pipelines) and a check
(harness, lint, ship, review); `brief` lists those in a task's scope and the review skill holds the diff to them. A
tenet is changed only by a superseding tenet plus a sweep task for what still follows the old one. When a rule is
replaced, by Matt's requirement or the build manager's judgment (D-317), the build manager records the superseding
decision. From then on, no work bends to a check written for the old rule: the check is brought in line with the new
one or retired, and named on the release card.

## Roles (D-317): who decides what

Matt is E.V.'s customer and its only user. Claude, in the E.V. development chat, is E.V.'s product manager, system
architect and build manager, and leads development up to and including staging. This section wins over any older text
in this file, the spec or the Chart that sends staging-level work to Matt.

**Matt decides:**

- **Live.** Every live deploy and every rollback is his: one bundled release at a time, on his word in the chat or his
  Ship it tap (R-04). Nothing reaches live any other way.
- **What E.V. should do for him.** The features he asks for and the bugs he reports are the requirements. Claude reads
  a vague one with care: it restates what it will build, checks it against the record and the demo, and pushes back
  with reasons when an ask would hurt E.V.; it asks at most one question, and only when a wrong guess is expensive.
- **Large decisions**, brought to him in plain words with the options before they are made: a change to the hard
  limits or to what personal data E.V. keeps; money, a new account or service, anything on his Mac or in his accounts;
  removing or changing something he uses day to day; any exception to something he explicitly asked for; a change to
  the done bar of a goal he set. (Mac-bound tasks and touching the live record by hand stay his, as below.)

**Claude decides everything else, up to and including staging:** the backlog and its order; designs within his
requirements; architecture; decisions and tenets, recorded with chart.mjs and retired by its own judgment; tests and
checks; tooling; staging deploys; and the workflow itself. Only the build manager changes the workflow: a lane, reviewer
or pipeline run never does. Nothing at staging waits on Matt or goes to him for approval.

**Matt in the loop.** Short plain lines when something changes what he will get (a draft ready, a direction changed, a
limit hit), never a request to approve staging work. When a release is ready on staging, one release card: its rubric
score, side-by-side screenshots of each view in desktop Chrome at 1280 (D-406), what changed for him, what was retired, known differences
and risks, and that live waits on his word. A large decision comes with a short overview in everyday words that he can
follow and question.

**The team** (detail in the build workflow map, https://claude.ai/artifact/QL68BeUSw8HB3QFhDTZ4XJ). The build manager
keeps its own context for managing and for Matt, and runs 2 to 4 agents at a time. It never
builds (D-351): every task, however small, goes to a builder, every probe or design to a research or planning agent, every review to a fresh reviewer. Post-release fixes and
tweaks go to one builder agent at a time (Matt, D-351); lanes are for larger feature sprints. The build manager
keeps every agent it starts alive (D-358): a liveness watch runs while any agent works (a transcript quiet for 10
minutes is checked: finished, or stopped and restarted from its saved work); after Matt interrupts a turn, which stops
the background agents, it checks them first and restarts what stopped; and a status to Matt starts from whether each
agent is running, never from its files alone.
It files Matt's asks as they come, answers him, orders the backlog, ships staging and sends release cards.

- Builders: agents the build manager spawns, each in its own worktree with the ev-builder skill; for a parallel sprint
  they work in lanes that each own their files (D-385).
- UI reviewer: a fresh agent that hasn't seen the work. It clicks through the demo and the built page like a person
  (tools/fidelity/crawl.cjs) for at most 20 minutes, on the synthetic record only, in desktop Chrome at 1280, the screens
  the release changed; it scores the rubric at one pinned commit and lists the fixes that would lift the score most.
  The build manager files those as tasks and gives them to builders.
- Test agent: keeps npm test and the harnesses asserting what E.V. should do now. Behaviour and data-safety checks stay
  strict; a check that only pinned a retired look is rewritten or retired.
- Spike (D-409): a throwaway experiment, sent when a builder stops short for safety, a fix keeps failing, an estimate
  rests on something unmeasured, or two designs are plausible. Throwaway worktree, no commits or Chart writes, no
  full suites, about an hour; it reports causes with counts, the fix per cause, what can't be done, and an estimate,
  and a builder builds from that. One per release; a second needs a line to Matt first.
- Code reviewer: before a release, a fresh agent (or 2 to 4 splitting it) reads the whole release diff for broken
  behaviour, lost data paths and dead UI.

**Delivery first (D-366, Matt, Oct 28; supersedes the per-task review loop and D-361/D-364's rounds).** A feature
goes to staging as soon as it is built and its tests pass, then gets one real end-to-end run there (the actual job,
the actual model, the actual page), and Matt is told to test it. Matt's testing is the acceptance. Reviews are for
what would hurt him, not for polish: one code review of the whole release diff, looking only for lost or wrong data,
unexpected cost, security holes, crashes and controls he can't reach. Edge cases outside that (clock skew, rare network
drops, wording, routing phrasing, timing windows) are not chased: a reviewer may list them in one line each and they
go to the backlog, never into a fix round. A blocker found by Matt or the end-to-end run is fixed and re-shipped
once; nothing else loops. No per-task review subagents for ordinary changes.

**Guardrails (D-366, after the Oct 28 release that took 12 hours, about 25 review rounds and 8 staging deploys):**

- **Run it for real first.** Any feature that calls a model, a job or an outside service gets one real run on staging
  before anything else is reviewed. Stubs and fakes in tests prove nothing about the real path.
- **Budget per release:** one builder per task, one whole-release code review, one UI click-through, one end-to-end run.
  Anything beyond that (a third deploy to staging, a second review of the same change, a new agent for an edge case)
  needs a line to Matt first saying why and what it costs.
- **No new checks for edge cases.** Tests and harness checks cover behaviour Matt uses. A reviewer's what-if (clock
  skew, rare drops, phrasing variants, timing windows) is a one-line backlog entry, not a test and not a fix.
- **The UI click-through is capped at 20 minutes:** as the UI reviewer above. Its score is information for the card.
- **The phone is frozen (D-407)** at "it loads, a tick works, nothing overflows": no phone shots, layout or polish work.
- **No exam- or time-gating (D-390):** no work waits on or is held for an exam date or a time of day.
- **Estimate, then report slips.** Give Matt an ETA when a release starts. If it slips by more than an hour, tell him
  why in two lines and ask whether to ship what works now.
- **Look at it like Matt would.** Before the card, open each new screen on staging with real data for every course,
  not just the one the feature was built against.

**Release bar (the rubric).** The UI reviewer scores each factor 1 to 5 (5 matches or excellent, 4 small differences
only a side-by-side shows, 3 noticeable but fine to use, 2 gets in the way, 1 broken); points are score / 5 x weight.

| Factor | Weight | A 5 looks like |
| --- | --- | --- |
| Every demo screen is there, nothing extra | 20 | Every screen and control the demo has, and nothing it doesn't |
| Works on real data | 20 | No empty, broken or overflowing screens with long titles, exams with no objectives, busy days |
| Layout and spacing | 15 | Panes, alignment and rhythm read as the demo in desktop Chrome at 1280 |
| Type and hierarchy | 10 | Sizes and weights put the right thing first, as the demo does |
| Words | 10 | Labels and E.V.'s lines say what the demo says, or the same in fewer words |
| Feel | 15 | Clicks respond at once, states are clear, controls are comfortable with mouse and keyboard |
| Linear-level polish | 10 | Calm, dense, consistent, nothing looks unfinished |

The UI reviewer's score goes on the card for information; it never holds a release or starts a fix wave (D-366).
A release is ready for Matt's word when, at one commit on main: npm test and smoke are GREEN, ship staging is GREEN and
the one end-to-end run worked. **Checks (D-408):** GitHub runs npm test and smoke on every push; the build manager runs
the full suite on GitHub once per batch, before ship staging; the full `npm run check` also runs nightly, and a red
nightly is filed as a bug and never blocks a release Matt has tested (R-06 is ended by D-366).

**One development chat, one build manager.** E.V. is developed in one long chat. This file and `docs/handover.md` are
what survive a /clear or a new chat: before clearing or ending, the build manager rewrites `docs/handover.md` (where
things stand, what is running, agents and lanes, the next steps, and anything waiting on Matt) and pushes it; a new
build manager reads it right after this file. There is one build manager at a time: a chat that finds the handover
naming another chat still managing asks Matt which one continues before firing anything.

## Every session

Every command below is `node tools/chart.mjs <command>`; each that writes the record commits it (pass the session's
attribution lines with `--trailer`, one per line) and regenerates BACKLOG.md, DECISIONS.md and CHANGELOG.md with it.
`--no-commit` leaves the change for the task's own commit. Steps 1 to 3 and 8 are for the build manager and scheduled
runs only; a builder agent follows the ev-builder skill.

1. Read this file. Run `node core/cli.mjs verify-deploy staging` and read its answer. Then read the live record's
   health/current (`brief` prints its age, or the read to make). Older than `spec.constants.health.staleHours`, a run
   is missing (D-180): read the live watchdog's `last_run` with `list_triggers`, file it with `report bug` unless an
   open task already covers it, and take that task before any other.
2. Triage first: `inbox` lists the Board comments to file (`report bug|request --from-comment <id>`, then the printed
   reply) and every entry waiting in the inbox. Each becomes a task (`log <id> --triage task --dod ... --milestone
   ...`), joins one (`--triage join <id>`), or is declined with a reason (`--triage decline --reason ...`); nothing
   is deleted. A red last nightly check (`.github/workflows/nightly.yml`, B-151; `inbox` prints the read) is an inbox
   entry: file it with `report bug --source "nightly <run id>"` unless an open task covers it. A bug that breaks
   studying is taken before any other open task. When Matt says "bug: ..." or
   "idea: ..." in the chat, file it at once with `report bug|request --from-chat --reworded "<his point>"`. The repository is public,
   so his words are never stored as written: reword them into a clear, neutral sentence that keeps every point (D-263).
3. Take the lowest `open` task in BACKLOG.md whose dependencies are `done`; `brief --task <id>` is its one page.
   Start it with `log <id> --status "in progress" --note "..."` and say which task you took. `log` refuses while an
   entry waits in the inbox. That claim is the lock: it pushes at once, and a refused push means another session holds
   the task, so take nothing. Log a note at each milestone, so the claim never looks stale; a claim with no note for 90
   minutes is stale.
4. A task is one id. If it needs a schema, a spec shape or a decision the design does not give, the build manager
   decides it and records it (`log decision`); only a large decision (Roles, D-317) is `log <id> --status blocked
   --note "<the question>" --waiting-on Matt`. A builder run blocks such a task with its question for the build
   manager and moves to the next open task. Code-level choices are yours.
5. Builders prove with D-408's fast local checks (ev-builder skill). GitHub runs npm test and smoke on every push; the
   build manager runs the full suite on GitHub once per batch, before ship staging. A pipeline proof is a scheduled
   task fired against staging and its `runs/<id>` read back.
6. Ship: commit with the task id first in the message (`B-07: lint and rebuild`), then the attribution lines the
   session gives you; push to `main`. Then `ship staging` and make every call and read it prints, running it again
   each time, until it says GREEN: it records the deploy, which CHANGELOG.md then carries. **Never deploy live** without
   Matt's explicit OK in the chat; `ship live --matt-ok` also refuses what `chart/rules.json` forbids (R-02 staging green
   at the same commit, B-35; R-03 no running study session, B-87; R-04 Matt's OK), so a build reaches live only through staging.
7. No per-task review (D-366): one whole-release code review (`.claude/skills/review`) for data, cost, security and
   crashes. Record: `log <id> --status done --commit <sha> --note "<one line>"`, or in the same move as step 6 with
   `ship staging --done <id> --commit <sha>` once staging is the task's last proof (B-147). A decision is
   `log decision <next id> --title ... --why ... --status ...`. Never a date on anything that gates work.
8. Continue with the next open task until none is open or every open task is blocked. Then stop and leave a
   summary in the last task's notes (`log <id> --note ...`).

## Unattended runs

Scheduled `ev4-builder` runs follow `docs/builder-runs.md` (moved there, B-611).

## Builder runs

See `docs/builder-runs.md`: a session started by the `ev4-builder` task follows it with this file.

## Trimmer runs

A session told "You are a trimmer" follows `docs/trim-brief.md` (D-259): one cut per branch and pull request, nothing
written to `chart/`, no deploys, and the Every session steps don't apply. A build chat merges a trim only on Matt's OK,
as the brief says.

## Scheduled pipeline runs

A session started by one of E.V.'s own scheduled tasks (its prompt begins "E.V. <pipeline> run" and names one record) is
not a build chat; the build-chat rules above do not apply to it. Matt created each of those tasks and approved what it
does: writing the documents its run protocol prints into the record its prompt names, live or staging, is that task's
job and needs no further OK. Its limits are the hard limits in its own prompt, which stay absolute: Canvas read-only, nothing posted as Matt, nothing deleted, no other artifact, page, file,
account or scheduled task touched.

## Hard limits (unchanged from v3)

They are `spec.boundaries` B-01 to B-18 (B-01 graded work, B-02 drug cards, B-03 proctored exams, B-04 patient
identifiers, B-05 health data, B-06 Apple Notes folders, B-07 owner-only record, B-08 passwords, B-09 posting as Matt,
B-10 no API key, B-11 nothing deleted, B-12 Canvas read-only, B-13 grounding, B-14 tone, B-15 a run's own record only,
B-16 scheduled tasks, B-17 Quizlet read-only, B-18 E.V.'s Mac folder); the run prompts' limits are rendered from them
(D-175). B-01 (graded work) and B-04 (patient identifiers) are ended by Matt's own decision (D-324): E.V. no longer
checks for, flags, holds or blocks either, and Matt is accountable for both. Canvas is read-only GETs through Matt's
signed-in browser; never a token. Nothing is deleted anywhere: records, Mac files, scheduled tasks, docs; retire
by marking. Repository code may be removed outright when it is no longer needed; git history keeps it (D-166). No passwords, nothing posted as Matt. Everything in Matt's record, notes and journal
included, is open to E.V.'s runs, agents and app logic to read and analyze, with no checks for personal details on what
goes in (D-335, Matt's call; it ends the journal's named read, D-106 and D-113, and D-325's skip of notes). The record
stays owner-only, and reading never writes. Personal data never enters
this repository (`fixtures/` and `dist/` are ignored; a test greps for exports). **In a build chat**, Matt's explicit OK is
required for: publishing the live page, creating or changing a Mac-bound task, touching the live record by hand. A refused action is reported in Notes, never worked around. Build chats load three hooks
(.claude/settings.json, B-56 to B-58): npm test at the end of a turn, the spec's JSON form, and a guard that refuses a
live write or publish unless `deploy live --matt-ok` wrote dist/live-ok; pipeline runs never load them (B-65).

## Rules from past failures

Each rule here still names a failure a build chat could repeat. Their stories, and the lessons the tools now hold for
you, are in `docs/lessons.md`.

- Never `add_repo`, clone or unpack inside a pipeline prompt: the run safety review refuses code a run fetched itself.
- A scheduled task inherits the repository and Mac link of the chat that created it. Create cloud tasks from a chat
  with this repository checked out; Mac-bound tasks only from a chat linked to the Mac, with Matt present, proven by
  one staging firing that writes (a new Mac task writes nothing until he approves its folders in the desktop app). Mac
  tasks are created, never edited (O-5, B-137): never change a task in the desktop app; re-create it from a session
  with the Mac link and the repository, and list the old one, disabled, in spec.tasks.retired.
- Browser work is start, poll, collect through saved files (`javascript_tool` stops at 45 s; the device bridge cuts
  results above ~250 KB). Never retype a result.
- `npm run check` takes about 25 minutes and a foreground call is cut at 10: run it in the background
  (`npm run check > /tmp/check.log 2>&1; echo "exit $?" >> /tmp/check.log`) and wait for that exit line. To retry one
  page check, run its harness alone (`node test/harness/<name>.cjs synthetic <shots dir>` after `node tools/build.mjs`).
- Spec files are JSON with indent 1 and no trailing newline (B-57; a hook rewrites them so).
- Before changing a large file, read its map in `docs/trim/scan/` (core, harness, page, spec, tools-tests): it names
  what each part does, what reads it and what is dead (D-264).

## Rollback (D-145)

There is no going back to v3 (D-145). Going back means the previous v4 live build, through the rollback skill
(`.claude/skills/rollback/SKILL.md`, B-60): `rollback live` dry-runs it, and on Matt's explicit OK that build is
restored at main's head and shipped through staging like any change.

## Where things live

| What | Where |
| --- | --- |
| Project record (the Chart) | `chart/` via `tools/chart.mjs`; BACKLOG.md is generated from it (D-140) |
| The view Matt uses | The app (PWA): the ev-live and ev-staging Workers over D1 (`spec.registry.records.<target>.app`); every proof, click-through and screenshot is taken there (D-367) |
| Live and staging records (artifact pages frozen, D-367) | live https://claude.ai/artifact/Bu8RevP4r1twPdSGc77nfg, staging https://claude.ai/artifact/Pb6jQ6CvEbtxi6Rcshu9uC (`spec/ev.spec.json` `registry`); ship no longer publishes either page; the records hold the system documents until B-473 |
| Mac folder | Documents/E.V. Study Watch (live since the Oct 18 cutover; staging uses its `staging/` subfolder) |
| Code style, page source, CI | prettier at 120 columns (`npm run format`, B-64); the page logic is `page/app/*.js` by tab, joined by the build into the published app.js; GitHub Actions runs the checks as the Release bar says (D-408; B-151; `gh workflow run nightly.yml` runs the full one now) |
