# Unattended and builder runs

Moved from CLAUDE.md (B-611). CLAUDE.md is still the contract; this is the part only scheduled `ev4-builder` runs
follow.

## Unattended runs

A build session may be a scheduled task with no one watching. Then: never wait for an answer; a question goes
into Notes with the task marked `blocked`; anything irreversible or outside staging is `blocked`, not attempted, with one
exception: a builder run started with a ship job deploys live through `ship live --from-job <id>` (D-198, B-185).
If the run was started by the `ev4-builder` task with `continue` and open, unblocked tasks remain, fire the builder again
through the Claude Code Remote `fire_trigger` tool with the text `continue` before ending, at most once per run. A
builder run waits for the message it was fired with ('Job <id>', words to file, or `continue`; its prompt ends its
first turn until that arrives, B-187), and a run fired with words to file files them first (`report --from-chat --reworded`). Stop firing when
`BACKLOG.md` has no open unblocked task, or when the same task has been `in progress` across two runs (mark it
`blocked` with what happened).

## Builder runs

A session started by the `ev4-builder` task is the builder (D-194). Its prompt's first step is `node tools/guard.mjs
--mark`, which writes /tmp/ev/builder-run: under it `log`, `plan` and `ship` refuse a push that touches a guarded path,
`log decision` refuses a tenet and deploy prints no trigger call (B-184, D-200). A builder run reads no live record, so
its session-start health read (the ev-build-manager skill's session-start reads: `node core/cli.mjs verify-deploy
staging`, `brief`'s health age, then `inbox`) takes the live watchdog's `last_run` from `list_triggers` (`brief` prints it). The message it was
fired with says what it is for:

- `Job <id>`: one ArtifactData get of jobs/<id> (from live; from staging when live has no such document), then by the
  job's kind. **build**: `report bug|request --from-chat --job <id> --reworded "<his point>"` (the job proves his request; the
  words are reworded, D-263; the source is "E.V. page, job <id>"), triaged into a task whose definition of done is written from his
  words (D-182), and that task taken first in this run, the one exception to the BACKLOG order (D-191); built, shipped
  to staging and traced. **reply**: `log <task> --note --from-job <id> --waiting-on none`, then that task taken when it
  was blocked only on that. **design** (B-183, D-197): read the north star's tab (Claude Docs read of
  https://claude.ai/artifact/4SJmAvp26TbGAXFUwfGqcd, then its tab's node) and list the job's record's weeks with an
  out_dir, then `trace --job <id> --record <the job's record> --status done --kickoff`: the kickoff is built from those
  reads and the Chart (its theme is the job's brief), lands as E.V.'s line with a Copy chip, and nothing is filed from
  it. **plan**: read the tab of the doc the job's brief links, `plan --from <that link> --apply` (a row's Depends sets
  depends), then `trace --job <id> --record <the job's record> --status done --filed`, whose line names what was filed.
  **ship** (B-185, D-198): his Ship it tap is his OK for that one commit. Get jobresults/<id> too (a result means the
  tap was spent), then `ship live --from-job <id>` with every call and read it prints until GREEN, as ship live does;
  it refuses a job that is not kind ship, not written by his page, names another commit, has a result or is over 24
  hours old. Then the trace names live at the commit GREEN, or where it stopped. Rollback stays a build chat's act
  with Matt present.
- Words to file (bug:, idea: or request:): `report --from-chat --reworded` first, then as the ev-build-manager skill's session start says (verify-deploy, `brief`'s health, `inbox`).
- `continue`: the ev-build-manager session-start reads (verify-deploy, `brief`'s health, `inbox`), then the next task.

Every run started with a job ends with `trace --job <id> --record <the job's record> --status done|failed --note "..."`
and the calls it prints, done or not, so the page shows what happened. A run started with a job or with words to file
does that one thing and ends: it takes no other task and never fires the builder again (Oct 21: a reply run's
`continue` started a run that would have taken a build chat's next task).

