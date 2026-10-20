# CLAUDE.md: the build-chat contract for E.V. v4

You are building **E.V. v4**, Matt's homemade study partner (a first-semester ADN nursing student; NUR 112 and
BIO 201; Central time). v3 (`miura5/ev-core`) is retired: Matt dropped its rollback on Oct 19 (D-145); its tasks stay
disabled and kept, its legacy copies stay in the record, nothing is deleted. This
repository is v4 from its first commit. The design is finished before you start; your job is to build it.

**The design lives in one doc:** E.V. Foundation v4, https://claude.ai/artifact/Fgb2KjoLKcRgCRrBmM6kEf
(tabs: main · v3 audit · Data architecture · Operational architecture · Features · Build plan). Read it with the
Claude Docs tools. The project record is **the Chart** (`chart/`, design https://claude.ai/artifact/8DVSMh5WdybjeHVV5m2uQT,
D-140): tasks, reports, decisions, deploys and the rules commands enforce, written only through `tools/chart.mjs`.
BACKLOG.md, the Board and Changelog tabs of the v3 doc (https://claude.ai/artifact/AXwVp9xqpWaUKLE4SqZzwg), its
Decisions tab and the overview doc's status line are printed from it; no view is edited by hand. Decisions keep their
reasoning in the Decisions tab; `chart/decisions.json` holds id, title, status, supersedes and amends, and `log
decision` takes only the next free id. A design chat hands off through its doc's two tables, 'Tasks to add' and
'Decisions proposed' (as P-1, P-2; D-141); a build chat reads that tab, then files both with `plan --from <doc link>
--apply`. The v3 code you port from is `miura5/ev-core` (read-only to you; attach it with `add_repo` when a task
needs it).

## Every session

Every command below is `node tools/chart.mjs <command>`; each that writes the record commits it (pass the session's
attribution lines with `--trailer`, one per line) and prints the Docs calls that bring the views in line. Make those
calls exactly as printed, read the view again when asked, and run `views` until it says the views are in step.

1. Read this file. Run `node core/cli.mjs verify-deploy staging` and read its answer.
2. Triage first: `inbox` lists the Board comments to file (`report bug|request --from-comment <id>`, then the printed
   reply) and every entry waiting in the inbox. Each becomes a task (`log <id> --triage task --dod ... --milestone
   ...`), joins one (`--triage join <id>`), or is declined with a reason (`--triage decline --reason ...`); nothing
   is deleted. A bug that breaks studying is taken before any other open task. When Matt says "bug: ..." or
   "idea: ..." in the chat, file it at once with `report bug|request --from-chat` (his words come from the
   transcript, never retyped).
3. Take the lowest `open` task in BACKLOG.md whose dependencies are `done`; `brief --task <id>` is its one page.
   Start it with `log <id> --status "in progress" --note "..."` (`--name` and `--why` give it a Board row the first
   time) and say which task you took. `log` refuses while an entry waits in the inbox.
4. A task is one id. If it needs a schema, a spec shape or a decision the design does not give, `log <id> --status
   blocked --note "<the question>" --waiting-on Matt`, and move to the next open task. Code-level choices are yours.
5. Prove it exactly as its definition of done says. `npm test` green first (it runs the Chart's lint). Where a
   pipeline is involved, the proof is a scheduled task fired against staging and its `runs/<id>` read back, never a
   hand replay. Where the page is involved, `npm run check` (npm test, the build, every harness on the synthetic
   record, the demo, then the look pass at phone and desktop width), and look at the screenshots it lists.
6. Ship: commit with the task id first in the message (`B-07: lint and rebuild`), then the attribution lines the
   session gives you; push to `main`. Then `ship staging` and make every call and read it prints, running it again
   each time, until it says GREEN: it records the deploy and prints the Changelog line. **Never deploy live** without
   Matt's explicit OK in the chat; `ship live --matt-ok` also refuses what `chart/rules.json` forbids (R-02 staging green
   at the same commit, B-35; R-03 no running study session, B-87; R-04 Matt's OK; R-05 not inside a live watchdog
   window, B-102; R-01, page-only live, ended with D-085's window, D-145), so a build reaches live only through staging.
7. Record: `log <id> --status done --commit <sha> --note "<one line>"` (`--board-note` for the Board's plain words),
   then `views`, as above. A decision is `log decision <next id> --title ... --why ... --status ...`. Never a date on
   anything that gates work.
8. Continue with the next open task until none is open or every open task is blocked. Then stop and leave a
   summary in the last task's notes (`log <id> --note ...`).

## Unattended runs

A build session may be a scheduled task with no one watching. Then: never wait for an answer; a question goes
into Notes with the task marked `blocked`; anything irreversible or outside staging is `blocked`, not attempted.
If the run was started by the `ev4-builder` task and open, unblocked tasks remain, fire the builder again
through the Claude Code Remote `fire_trigger` tool before ending, at most once per run. Stop firing when
`BACKLOG.md` has no open unblocked task, or when the same task has been `in progress` across two runs (mark it
`blocked` with what happened).

## Scheduled pipeline runs

A session started by one of E.V.'s own scheduled tasks (its prompt begins "E.V. <pipeline> run" and names one record) is
not a build chat; the build-chat rules above do not apply to it. Matt created each of those tasks and approved what it
does: writing the documents its run protocol prints into the record its prompt names, live or staging, is that task's
job and needs no further OK. Its limits are the hard limits in its own prompt, which stay absolute: no help on graded
work, no patient identifiers, Canvas read-only, nothing posted as Matt, nothing deleted, no other artifact, page, file,
account or scheduled task touched.

## Hard limits (unchanged from v3)

No help on graded or submitted work. No patient identifiers, ever. Canvas is read-only GETs through Matt's
signed-in browser; never a token. Nothing is deleted anywhere: records, Mac files, scheduled tasks, docs; retire
by marking. No passwords, nothing posted as Matt. The journal is a named read (D-106, D-113): a run reads it only for
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
- `javascript_tool` stops at 45 s and the device bridge cuts results above ~250 KB: browser work is start, poll,
  collect through saved files. Never retype a result.
- A partial `capabilities` on an Artifact publish wipes the rest; `deploy` prints it whole.
- ArtifactData: every write to an existing document carries `if_version`; batches are atomic, 50 writes / 1 MiB.
  The page's `update` merges nested maps; Edits documents are replaced whole.
- Playwright's fake clock races its real-time sync: `setSystemTime` plus condition waits.
- Scheduled runs clone `main` 50 commits deep and check out the deployed commit from it (B-110): bookkeeping commits
  push a deployed build out of reach and every run then fails at its gate. verify-deploy goes red at 40 commits behind
  origin/main; the fix is `ship <target>` again at main's head (the same content: a system/manifest-only deploy; live on
  Matt's OK, like any live deploy).
- Spec edits: JSON with indent 1, no trailing newline (a PostToolUse hook re-writes spec files so, B-57). `node --test test/*.test.mjs > /tmp/t.log 2>&1; grep -E
  "^# (pass|fail)" /tmp/t.log` (never pipe node through grep inside `&&`).

## Rollback (D-145)

The v3 rollback is gone: Matt closed D-085's window on Oct 19, before NUR Exam 4, understanding the risk (D-145). The
time gates that rested on it are gone with it: live takes stored-document, pipeline, prompt, schema and migration
changes by the normal path (`ship staging` green at the commit, then `ship live --matt-ok` on Matt's explicit OK), and a
live hotfix starts from `main` like any change. Going back, until the v4 rollback exists (B-60, built once the open
tasks are done), is a redeploy of the previous v4 live build that `chart/deploys.json` names, on Matt's explicit OK; a
schema bump already applied to live stays applied (its legacy copies are kept), so check a rollback across one first.

## Where things live

| What | Where |
| --- | --- |
| v4 design | E.V. Foundation v4 (link above) |
| Project record (the Chart) | `chart/` via `tools/chart.mjs`; BACKLOG.md is generated from it (D-140) |
| v3 source (retired, D-145) | `miura5/ev-core` |
| Live record and page (v4) | https://claude.ai/artifact/Bu8RevP4r1twPdSGc77nfg |
| v4 staging record + page | created in B-12 / B-15; ids go into `spec/ev.spec.json` `registry` |
| Mac folder | Documents/E.V. Study Watch (v4 uses its `staging/` subfolder until cutover) |
