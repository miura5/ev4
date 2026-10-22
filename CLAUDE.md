# CLAUDE.md: the build-chat contract for E.V. v4

You are building **E.V. v4**, Matt's homemade study partner (a first-semester ADN nursing student; NUR 112 and
BIO 201; Central time). v3 (`miura5/ev-core`) is retired: Matt dropped its rollback on Oct 19 (D-145); its tasks stay
disabled and kept, its legacy copies stay in the record, nothing is deleted. This
repository is v4 from its first commit. The design is finished before you start; your job is to build it.

**The design lives in one doc:** E.V. Foundation v4, https://claude.ai/artifact/Fgb2KjoLKcRgCRrBmM6kEf
(seven tabs: main · v3 audit · Data architecture · Operational architecture · Features · Build plan · UI and
UX), design history since D-184: a design doc is a hand-off, and no current fact is cited from it. The living truth is
this file, the spec and its schemas, and the Chart. The project record is **the Chart** (`chart/`, design https://claude.ai/artifact/8DVSMh5WdybjeHVV5m2uQT,
D-140): tasks, reports, decisions, deploys and the rules commands enforce, written only through `tools/chart.mjs`.
BACKLOG.md, DECISIONS.md and CHANGELOG.md are generated from it into the repository and drift-tested; none is edited by
hand. The Docs views (the v3 doc's Board, Changelog and Decisions tabs, https://claude.ai/artifact/AXwVp9xqpWaUKLE4SqZzwg,
and the overview's status line) are retired (D-172): nothing writes them, and the inbox still reads Board comments.
`chart/decisions.json` holds every decision's id, title, why, status, supersedes, amends and kind, and `log decision`
takes only the next free id. A design chat hands off through its doc's two tables, 'Tasks to add' and
'Decisions proposed' (as P-1, P-2; D-141), plus 'Tenets proposed' for standing principles; a build chat reads that tab,
then files them with `plan --from <doc link> --apply`. A tenet (B-109) is a decision of kind tenet with a scope (ui,
data, ops, pipelines) and a check (harness, lint, ship, review); `brief` lists those in a task's scope and the review
skill holds the diff to them. A tenet is changed only by a superseding tenet plus a sweep task for what still follows
the old one. The v3 code you port from is `miura5/ev-core` (read-only to you; attach it with `add_repo` when a task
needs it).

## Every session

Every command below is `node tools/chart.mjs <command>`; each that writes the record commits it (pass the session's
attribution lines with `--trailer`, one per line) and regenerates BACKLOG.md, DECISIONS.md and CHANGELOG.md with it.
`--no-commit` leaves the change for the task's own commit.

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
   "idea: ..." in the chat, file it at once with `report bug|request --from-chat` (his words come from the
   transcript, never retyped).
3. Take the lowest `open` task in BACKLOG.md whose dependencies are `done`; `brief --task <id>` is its one page.
   Start it with `log <id> --status "in progress" --note "..."` and say which task you took. `log` refuses while an
   entry waits in the inbox.
4. A task is one id. If it needs a schema, a spec shape or a decision the design does not give, `log <id> --status
   blocked --note "<the question>" --waiting-on Matt`, and move to the next open task. Code-level choices are yours.
5. Prove it exactly as its definition of done says. `npm test` green first (it runs the Chart's lint). Where a
   pipeline is involved, the proof is a scheduled task fired against staging and its `runs/<id>` read back, never a
   hand replay. Where the page is involved, `npm run check` (npm test, the build, every harness on the synthetic
   record, then the look pass at phone and desktop width), and look at the screenshots it lists.
6. Ship: commit with the task id first in the message (`B-07: lint and rebuild`), then the attribution lines the
   session gives you; push to `main`. Then `ship staging` and make every call and read it prints, running it again
   each time, until it says GREEN: it records the deploy, which CHANGELOG.md then carries. **Never deploy live** without
   Matt's explicit OK in the chat; `ship live --matt-ok` also refuses what `chart/rules.json` forbids (R-02 staging green
   at the same commit, B-35; R-03 no running study session, B-87; R-04 Matt's OK; R-05 not inside a live watchdog
   window, B-102; R-01, page-only live, ended with D-085's window, D-145, and is kept in `chart/rules.json` marked
   ended), so a build reaches live only through staging.
7. Record: `log <id> --status done --commit <sha> --note "<one line>"`, or in the same move as step 6 with `ship staging
   --done <id> --commit <sha>` once staging is the task's last proof (B-147). A decision is `log decision <next id>
   --title ... --why ... --status ...`. Never a date on anything that gates work.
8. Continue with the next open task until none is open or every open task is blocked. Then stop and leave a
   summary in the last task's notes (`log <id> --note ...`).

## Unattended runs

A build session may be a scheduled task with no one watching. Then: never wait for an answer; a question goes
into Notes with the task marked `blocked`; anything irreversible or outside staging is `blocked`, not attempted.
If the run was started by the `ev4-builder` task with `continue` and open, unblocked tasks remain, fire the builder again
through the Claude Code Remote `fire_trigger` tool with the text `continue` before ending, at most once per run. A
builder run waits for the message it was fired with ('Job <id>', words to file, or `continue`; its prompt ends its
first turn until that arrives, B-187), and a run fired with words to file files them first (`report --from-chat`). Stop firing when
`BACKLOG.md` has no open unblocked task, or when the same task has been `in progress` across two runs (mark it
`blocked` with what happened).

## Builder runs

A session started by the `ev4-builder` task is the builder (D-194). Its prompt's first step is `node tools/guard.mjs
--mark`, which writes /tmp/ev/builder-run: under it `log`, `plan` and `ship` refuse a push that touches a guarded path,
`log decision` refuses a tenet and deploy prints no trigger call (B-184, D-200). A builder run reads no live record, so
its step 1 health read is the live watchdog's `last_run` from `list_triggers` (`brief` prints it). The message it was
fired with says what it is for:

- `Job <id>`: one ArtifactData get of jobs/<id> (from live; from staging when live has no such document), then by the
  job's kind. **build**: `report bug|request --from-chat --job <id>` (the words come from the fired message or the job,
  never retyped; the source is "E.V. page, job <id>"), triaged into a task whose definition of done is written from his
  words (D-182), and that task taken first in this run, the one exception to the BACKLOG order (D-191); built, shipped
  to staging and traced. **reply**: `log <task> --note --from-job <id> --waiting-on none`, then that task taken when it
  was blocked only on that. **design** (B-183, D-197): read the north star's tab (Claude Docs read of
  https://claude.ai/artifact/4SJmAvp26TbGAXFUwfGqcd, then its tab's node) and list the job's record's weeks with an
  out_dir, then `trace --job <id> --record <the job's record> --status done --kickoff`: the kickoff is built from those
  reads and the Chart (its theme is the job's brief), lands as E.V.'s line with a Copy chip, and nothing is filed from
  it. **plan**: read the tab of the doc the job's brief links, `plan --from <that link> --apply` (a row's Depends sets
  depends), then `trace --job <id> --record <the job's record> --status done --filed`, whose line names what was filed.
  **ship**: as B-185 says once it is built.
- Words to file (bug:, idea: or request:): `report --from-chat` first, then as Every session says.
- `continue`: Every session, from step 1.

Every run started with a job ends with `trace --job <id> --record <the job's record> --status done|failed --note "..."`
and the calls it prints, done or not, so the page shows what happened. A run started with a job or with words to file
does that one thing and ends: it takes no other task and never fires the builder again (Oct 21: a reply run's
`continue` started a run that would have taken a build chat's next task).

## Scheduled pipeline runs

A session started by one of E.V.'s own scheduled tasks (its prompt begins "E.V. <pipeline> run" and names one record) is
not a build chat; the build-chat rules above do not apply to it. Matt created each of those tasks and approved what it
does: writing the documents its run protocol prints into the record its prompt names, live or staging, is that task's
job and needs no further OK. Its limits are the hard limits in its own prompt, which stay absolute: no help on graded
work, no patient identifiers, Canvas read-only, nothing posted as Matt, nothing deleted, no other artifact, page, file,
account or scheduled task touched.

## Hard limits (unchanged from v3)

They are `spec.boundaries` B-01 to B-18 (B-01 graded work, B-02 drug cards, B-03 proctored exams, B-04 patient
identifiers, B-05 health data, B-06 Apple Notes folders, B-07 owner-only record, B-08 passwords, B-09 posting as Matt,
B-10 no API key, B-11 nothing deleted, B-12 Canvas read-only, B-13 grounding, B-14 tone, B-15 a run's own record only,
B-16 scheduled tasks, B-17 Quizlet read-only, B-18 E.V.'s Mac folder); the run prompts' limits are rendered from them
(D-175). No help on graded or submitted work. No patient identifiers, ever. Canvas is read-only GETs through Matt's
signed-in browser; never a token. Nothing is deleted anywhere: records, Mac files, scheduled tasks, docs; retire
by marking. Repository code may be removed outright when it is no longer needed; git history keeps it (D-166). No passwords, nothing posted as Matt. The journal is a named read (D-106, D-113): a run reads it only for
a step that names it, backups and the mirror include it, and a build session may read it. Personal data never enters
this repository (`fixtures/` and `dist/` are ignored; a test greps for exports). **In a build chat**, Matt's explicit OK is
required for: publishing the live page, creating or changing a Mac-bound task, touching the live record by hand. A refused action is reported in Notes, never worked around. Build chats load three hooks
(.claude/settings.json, B-56 to B-58): npm test at the end of a turn, the spec's JSON form, and a guard that refuses a
live write or publish unless `deploy live --matt-ok` wrote dist/live-ok; pipeline runs never load them (B-65).

## Gotchas carried from v3, each with its rule

- The run safety review refuses code a run fetched or unpacked itself ("Code from External"). Runs execute the
  checkout their session started in, moved to the tag `system/manifest` names. Never `add_repo`, clone or unpack
  inside a pipeline prompt.
- A scheduled task inherits the repository and Mac link of the chat that created it. Create cloud tasks from a chat
  with this repository checked out; Mac-bound tasks only from a chat linked to the Mac, and only with Matt present.
  A new Mac task writes nothing until Matt approves its folder access in the Claude desktop app (Oct 21: three tasks
  listed their folders and were refused every write until he did); prove it with one staging firing that writes.
  Mac tasks are created, never edited (O-5, B-137): never change a task in the desktop app; re-create it from a
  session with the Mac link and the repository (deploy's create_trigger printout names every notification channel and
  the folders; the old task is disabled and listed in spec.tasks.retired, never deleted).
- `javascript_tool` stops at 45 s and the device bridge cuts results above ~250 KB: browser work is start, poll,
  collect through saved files. Never retype a result.
- A partial `capabilities` on an Artifact publish wipes the rest; `deploy` prints it whole.
- ArtifactData: every write to an existing document carries `if_version`; batches are atomic, 50 writes / 1 MiB.
  The page's `update` merges nested maps; Edits documents are replaced whole.
- Playwright's fake clock races its real-time sync: `setSystemTime` plus condition waits.
- Scheduled runs clone `main` 50 commits deep and check out the deployed commit from it (B-110). When record commits
  push it out of that clone, the gate stays on the clone's head and goes on only if every file the manifest hashes is
  the same there (D-170, B-132; its source is `tools/gate.mjs`); verify-deploy notes the distance and never reds on it.
- Spec edits: JSON with indent 1, no trailing newline (a PostToolUse hook re-writes spec files so, B-57). `node --test test/*.test.mjs > /tmp/t.log 2>&1; grep -E
  "^# (pass|fail)" /tmp/t.log` (never pipe node through grep inside `&&`).

## Rollback (D-145)

The v3 rollback is gone: Matt closed D-085's window on Oct 19, before NUR Exam 4, understanding the risk (D-145). The
time gates that rested on it are gone with it: live takes stored-document, pipeline, prompt, schema and migration
changes by the normal path (`ship staging` green at the commit, then `ship live --matt-ok` on Matt's explicit OK), and a
live hotfix starts from `main` like any change. Going back is the rollback skill,
`.claude/skills/rollback/SKILL.md` (B-60): the previous v4 live build that `chart/deploys.json` names, restored at main's
head and shipped through staging, on Matt's explicit OK; `rollback live` dry-runs it first. A schema bump already
applied to live stays applied (its legacy copies are kept), and the dry run names any it goes back across.

## Where things live

| What | Where |
| --- | --- |
| v4 design | E.V. Foundation v4 (link above) |
| Project record (the Chart) | `chart/` via `tools/chart.mjs`; BACKLOG.md is generated from it (D-140) |
| v3 source (retired, D-145) | `miura5/ev-core` |
| Live record and page (v4) | https://claude.ai/artifact/Bu8RevP4r1twPdSGc77nfg |
| v4 staging record + page | https://claude.ai/artifact/Pb6jQ6CvEbtxi6Rcshu9uC (`spec/ev.spec.json` `registry`) |
| Mac folder | Documents/E.V. Study Watch (live since the Oct 18 cutover; staging uses its `staging/` subfolder) |
| Code style, page source, CI | prettier at 120 columns (`npm run format`, B-64); the page logic is `page/app/*.js` by tab, joined by the build into the published app.js; GitHub Actions runs `npm test` on every push and `npm run check` nightly with its screenshots (B-151; `gh workflow run nightly.yml` runs it now) |
