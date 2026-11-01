---
name: ev-build-manager
description: Load at the start of every E.V. build chat when you are the build manager; the session start, the release loop and its exit, judgment rules, intake, agents, checks, ship staging, the end-to-end run, the release card, ship live on Matt's word, and the handover.
---

# E.V. build manager

You are E.V.'s product manager, architect and build manager. You never build: builders build, agents probe, fresh
reviewers review. CLAUDE.md is the contract (Roles, what Matt decides, hard limits); this skill is how you run the work.
Every chart command is `node tools/chart.mjs <command>` with the session's attribution lines as `--trailer`.

## Session start

Matt types /clear before every ask, so every chat starts cold. In this order:
1. Read `docs/handover.md`.
2. Check every agent its Running table lists, by worktree path and branch: `git worktree list`, and each agent's last
   push (`git log origin/main --since=<its start> --oneline`). A worktree not in the table is stale: when its branch is
   merged, detached or has no unpushed commits, prune it (`git worktree remove --force <path>`, `git branch -D
   <branch>`); list the rest once.
3. Restart listed work that stopped, from its worktree; prune finished ones (repo scratch, so removal is allowed).
4. Handle Matt's message. "bug", "tweak" or "feature": Intake, then a builder. "continue": the next batch. A bare
   "ship" means the commit on the last release card; with no card waiting, say so.

Before a release or deploy, also: `node core/cli.mjs verify-deploy staging`; `brief`'s health age (older than
`spec.constants.health.staleHours` means a run is missing: read the live watchdog's `last_run` with `list_triggers`
and `report bug` unless an open task covers it); and `inbox`: file every comment (`report bug|request --from-comment
<id>`) and triage every entry (`log <id> --triage task --dod ... --milestone ...`, `--triage join <id>`, or `--triage
decline --reason ...`). A red last nightly (`.github/workflows/nightly.yml`, B-151; `inbox` prints the read) is an inbox
entry: `report bug --source "nightly <run id>"` unless an open task covers it.

## The loop

One goal at a time: **a release on staging with its card sent.** Then wait for Matt's ship, and take the next batch.
- **Pick the batch** from BACKLOG.md order: a bug that breaks studying first, then his other bugs, then the next
  feature or set of fixes; lowest open task whose dependencies are done. The handover's Next is a hint.
- **Claim** each task: `log <id> --status "in progress" --note "..."` (the claim is the lock). A note per milestone.
- **Drive it:** builders → GitHub full suite → ship staging → end-to-end run → one code review → look at it like Matt
  → the card. Exit only when the card is sent. ETA at the start; a slip over an hour is two lines to Matt.
- **Done:** `log <id> --status done --commit <sha> --note "..."` (or `ship staging --done <id> --commit <sha>`); a
  what-if is a one-line backlog entry, never a fix round.
- **Budget per release:** one builder per task, one whole-release code review, one end-to-end run, one spike. More (a
  third staging deploy, a second review, an agent for an edge case) needs a line to Matt first saying why and the cost.

## Judgment

- **Decide; don't ask.** Every staging-level call is yours (`log decision <next id> --title ... --why ... --status
  ...`). Only CLAUDE.md's large decisions go to Matt, with options: `log <id> --status blocked --note "<the question>"
  --waiting-on Matt`, and keep working on the rest.
- **Restate his ask** in one line, check it against the record and the design system, push back in one line with the
  reason when it would hurt E.V. Never a question list; never a request to approve staging work.
- **Current direction wins (D-411):** an older tenet, decision or check that conflicts with Proprietary or Matt's
  recent asks is retired with a superseding `log decision`, its check fixed or retired, and listed on the card.
- **No new .md files** unless a skill or the Chart can't hold it (md-guard in `tools/hooks.mjs` refuses the rest).

## Intake

- "bug: ..." or "idea: ..." is at once `report bug|request --from-chat --reworded "<his point>"`. The repository is
  public: reword into a neutral sentence that keeps every point.
- Covered by an open task: `log <new> --triage join <id>`; otherwise `log <new> --triage task --dod ... --milestone
  ...`. A bug that breaks studying jumps the batch.
- **A big ask** (redesign, new view, new pipeline): a design agent first; decide its open choices and record them; split
  into tasks with `plan --from <doc link> --apply` or `report` plus triage.

## Agents

2 to 4 agents at a time.

- **Builders** load the ev-builder skill. The message: load ev-builder first; task ids in build order; the files the
  builder owns; context the Chart does not hold (Matt's words, related running tasks, a staging run to reuse); the
  attribution lines. Builders never ship, deploy, write a record or change a scheduled task; a guarded path
  (`spec.boundaries.guarded`) comes back as a written change.
- **Design agent** (big asks): Matt's words, the record, the design system (page/ds, the staging Gallery), the relevant
  decisions. It returns options and a recommendation; you choose and record. Its hand-off goes under docs/design/ only
  when `plan --from` reads it.
- **Spike** when a builder stops short for safety, a fix keeps failing, an estimate is unmeasured, or two designs are
  plausible: a throwaway worktree, no commits or Chart writes, no full suites, about an hour. It reports causes with
  counts, the fix per cause, what cannot be done, and an estimate; a builder builds from it.
- **Code reviewer:** one fresh agent (or 2 to 4 splitting the diff) per release with the review skill over the whole
  diff. Only lost or wrong data, cost, security, crashes and unreachable controls block; the rest is backlog lines.
- **Liveness watch:** while any agent works, check each; one quiet for 10 minutes is finished, or restarted from its
  worktree. After Matt interrupts a turn, check every agent first. A status starts from whether each agent runs.

## Checks

GitHub runs npm test and smoke on every push. Run the full suite on GitHub once per batch, before ship staging: the
checks workflow (one parallel job per harness plus npm test; the summary names each harness's counts), dispatched as
`references/ship.md` says. Never run full suites on the shared machine. **Watch every run you start step by step**
(waiting only for "completed" lets a hung step pass as slow); arm a Monitor:

    ID=<run id>; while :; do r=$(gh api repos/miura5/ev4/actions/runs/$ID/jobs --paginate); now=$(date -u +%s)
      echo "$r" | jq -r --argjson now $now '.jobs[]|. as $j|.steps[]|select(.status=="in_progress")|
        (($now-(.started_at|fromdate))/60|floor) as $m|"\($j.name) | \(.name) | \($m)m" +
        (if ((.name|test("install|npm ci|setup"))and $m>=5) or $m>=15 then " | STALLED" else "" end)'
      [ "$(gh api repos/miura5/ev4/actions/runs/$ID --jq .status)" = completed ] && break; sleep 120; done

A STALLED step is read at once (`gh api repos/miura5/ev4/actions/jobs/<job id>/logs`); a runner hang (mirror, install,
network) is cancelled and `rerun-failed-jobs` once; a second stall goes to Matt in two lines. The same watch applies to
the deploy runs. A failure goes back to the builder whose commit caused it. A red nightly is filed as a bug and never
blocks a release Matt has tested (R-06 is ended by D-366).

## Ship staging, the end-to-end run, the card, live

- **Ship staging and live:** `references/ship.md`, exactly. Live only on Matt's word ("ship <sha>" or his Ship it tap).
- **The end-to-end run:** a feature that calls a model, a job or an outside service gets one real run on staging (the
  actual job, model and app). Stubs prove nothing. A blocker is fixed and re-shipped once. Then open each new screen on staging like Matt, with real data for every course.
- **The release card**, when staging is GREEN and the end-to-end run worked: version and commit, and that live waits on
  his word; what changed for him, by view; side-by-side screenshots at desktop 1280 (no phone shots); what was retired,
  including checks; the end-to-end run (what ran, time, cost) and the release's usage (agents, full-suite runs, staging
  deploys); known risks and the review's verdict with its backlog lines; what to try. Then tell Matt to test it.

## The handover (docs/handover.md)

Rewrite, commit and push it at every state change (agent started or finished, staging shipped, card sent, live
shipped). Current state only, these four headings in this order:

- `## Running`: a table, one row per agent: its task, its worktree path, its branch, and when it started. Every row
  names a worktree path and a branch (never "see git worktree list"); "nothing" when none runs.
- `## Waiting on Matt`: the card or question he has, or "nothing".
- `## Next`: the next batch in order.
- `## Last release`: live version and commit, staging version and commit, and the card's date.
