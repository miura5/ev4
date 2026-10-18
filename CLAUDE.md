# CLAUDE.md: the build-chat contract for E.V. v4

You are building **E.V. v4**, Matt's homemade study partner (a first-semester ADN nursing student; NUR 112 and
BIO 201; Central time). v3 is live in `miura5/ev-core` and stays live, untouched, until v4 passes parity. This
repository is v4 from its first commit. The design is finished before you start; your job is to build it.

**The design lives in one doc:** E.V. Foundation v4, https://claude.ai/artifact/Fgb2KjoLKcRgCRrBmM6kEf
(tabs: main · v3 audit · Data architecture · Operational architecture · Features · Build plan). Read it with the
Claude Docs tools. The Decisions log stays in the v3 doc: https://claude.ai/artifact/AXwVp9xqpWaUKLE4SqZzwg
(tabs: Board, Changelog, Decisions; next id **D-106**; D-084 to D-105 are accepted). The v3 code you port from is `miura5/ev-core`
(read-only to you; attach it with `add_repo` when a task needs it).

## Every session

1. Read this file, `BACKLOG.md`, and the Build plan tab. If `core/cli.mjs` has `verify-deploy`, run
   `node core/cli.mjs verify-deploy staging` and read its answer first.
2. Take the lowest `open` task in `BACKLOG.md` whose dependencies are `done`. Mark it `in progress` with the
   session's date in the Notes column, commit that, and say which task you took.
3. A task is one backlog id. If it needs a schema, a spec shape or a decision the design does not give, write the
   question in the task's Notes, mark it `blocked`, commit, and move to the next open task. Code-level choices are
   yours.
4. Prove it exactly as its definition of done says. `npm test` green first. Where a pipeline is involved, the proof
   is a scheduled task fired against staging and its `runs/<id>` read back, never a hand replay. Where the page is
   involved, the harness at phone and desktop width, and look at the screenshots.
5. Ship: commit with the task id first in the message (`B-07: lint and rebuild`), then the attribution lines the
   session gives you; push to `main`. If `deploy` exists: `deploy staging`, run every printed call, `verify-deploy
   staging` green. **Never deploy live** without Matt's explicit OK in the chat; `deploy live` also refuses unless
   `dist/verify-staging.json` is green at the same commit (B-35), so a build reaches live only through staging.
6. Record: mark the task `done` in `BACKLOG.md` with one line of Notes (commit it); a Board row in the v3 doc; a
   Changelog line per staging deploy. Never a date on anything that gates work.
7. Continue with the next open task until none is open or every open task is blocked. Then stop and leave a
   summary in the last task's Notes.

## Unattended runs

A build session may be a scheduled task with no one watching. Then: never wait for an answer; a question goes
into Notes with the task marked `blocked`; anything irreversible or outside staging is `blocked`, not attempted.
If the run was started by the `ev4-builder` task and open, unblocked tasks remain, fire the builder again
through the Claude Code Remote `fire_trigger` tool before ending, at most once per run. Stop firing when
`BACKLOG.md` has no open unblocked task, or when the same task has been `in progress` across two runs (mark it
`blocked` with what happened).

## Hard limits (unchanged from v3)

No help on graded or submitted work. No patient identifiers, ever. Canvas is read-only GETs through Matt's
signed-in browser; never a token. Nothing is deleted anywhere: records, Mac files, scheduled tasks, docs; retire
by marking. No passwords, nothing posted as Matt, the journal is read by the page only. Personal data never enters
this repository (`fixtures/` and `dist/` are ignored; a test greps for exports). Matt's explicit OK is required
for: publishing the live page, creating or changing a Mac-bound task, reading the journal, touching the live
record. A refused action is reported in Notes, never worked around.

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
- Spec edits: JSON with indent 1, no trailing newline. `node --test test/*.test.mjs > /tmp/t.log 2>&1; grep -E
  "^# (pass|fail)" /tmp/t.log` (never pipe node through grep inside `&&`).

## Where things live

| What | Where |
| --- | --- |
| v4 design | E.V. Foundation v4 (link above) |
| v3 source, live | `miura5/ev-core`; live record https://claude.ai/artifact/Bu8RevP4r1twPdSGc77nfg |
| v4 staging record + page | created in B-12 / B-15; ids go into `spec/ev.spec.json` `registry` |
| Mac folder | Documents/E.V. Study Watch (v4 uses its `staging/` subfolder until cutover) |
