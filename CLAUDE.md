E.V. build chat: load the ev-build-manager skill before anything else.

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

**The build manager's playbook is the `ev-build-manager` skill (D-410)**, loaded at the start of every build chat:
session start, the release loop, judgment, intake, agents (2 to 4 at a time is stated there), checks, ship staging and
live, the end-to-end run, the release card and the handover. Builders follow the `ev-builder` skill. New .md files are
refused by the md-guard hook outside skills, design hand-offs and the generated files: plans, notes and reports go in
the Chart or an agent's report.

**Delivery first (D-366, Matt, Oct 28; supersedes the per-task review loop and D-361/D-364's rounds).** A feature
goes to staging as soon as it is built and its tests pass, then gets one real end-to-end run there (the actual job,
the actual model, the actual page), and Matt is told to test it. Matt's testing is the acceptance. Reviews are for
what would hurt him, not for polish: one code review of the whole release diff, looking only for lost or wrong data,
unexpected cost, security holes, crashes and controls he can't reach. Edge cases outside that (clock skew, rare network
drops, wording, routing phrasing, timing windows) are not chased: a reviewer may list them in one line each and they
go to the backlog, never into a fix round. A blocker found by Matt or the end-to-end run is fixed and re-shipped
once; nothing else loops. No per-task review subagents for ordinary changes.

**Guardrails, budget, rubric and the release bar** are in the ev-build-manager skill. For everyone: run a feature
that calls a model, a job or an outside service for real on staging before anything else is reviewed; no new checks for
edge cases; the phone is frozen at "it works" (D-407); no exam- or time-gating (D-390).

## Every session

Every chart command is `node tools/chart.mjs <command>`; each that writes the record commits it (the session's
attribution lines as `--trailer`, one per line) and regenerates BACKLOG.md, DECISIONS.md and CHANGELOG.md.
`--no-commit` leaves the change for the task's own commit. The build manager's session start, triage, claim and loop
are its skill; a builder follows ev-builder. For everyone:

1. A task is one id. A schema, spec shape or decision the design does not give is the build manager's to decide and
   record (`log decision`); only a D-317 large decision is `log <id> --status blocked --note "<the question>"
   --waiting-on Matt`. Code-level choices are the builder's.
2. Prove with D-408's fast local checks; GitHub runs npm test and smoke on every push. A pipeline proof is a scheduled
   task fired against staging and its `runs/<id>` read back.
3. Commit with the task id first (`B-07: lint and rebuild`), then the attribution lines; push to `main`. **Never deploy
   live** without Matt's explicit OK; `ship live --matt-ok` also refuses what `chart/rules.json` forbids, so a build
   reaches live only through staging. Never a date on anything that gates work.

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
required for: publishing the live page, creating or changing a Mac-bound task, touching the live record by hand. A refused action is reported in Notes, never worked around. Build chats load four hooks
(.claude/settings.json, B-56 to B-58, B-613): at the end of a turn the format test and the changed files' own tests (D-408, 90 s cap), the spec's JSON form, and a guard that refuses a
live write or publish unless `ship live --matt-ok` wrote dist/live-ok, and md-guard (B-613), which refuses a new .md
outside skills, design hand-offs and the generated files; pipeline runs never load them (B-65).

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
| Code style, page source, CI | prettier at 120 columns (`npm run format`, B-64); the page logic is `page/app/*.js` by tab, joined by the build into the published app.js; GitHub Actions runs the checks as the ev-build-manager skill's Checks say (D-408; B-151; the full one runs per commit as parallel jobs in checks.yml, B-606) |
