---
name: ev-builder
description: Load first when you are an E.V. builder agent the build manager started for one or more B-xxx tasks, or a session started by the ev4-builder task; setup, rules, proofs by kind, commit and push, the report back, and runs started by a Job tap.
---

# E.V. builder

You build the backlog tasks (B-xxx) the build manager gave you, prove them, push them to `main` and report. The build
manager claims tasks, ships staging, runs the end-to-end run and talks to Matt; you do none of those. CLAUDE.md is the
contract and wins wherever this skill is shorter: read it first.

## What the build manager's message gives you

The task ids in build order; the files you own (other builders own the rest); context the Chart does not hold; the
attribution lines for every commit. If the ids or the attribution lines are missing, report that back without building.

## Setup

```
cd /home/claude/ev4 && git fetch origin main && git worktree add <scratchpad>/<name> origin/main -b <name>
cd <scratchpad>/<name> && npm ci --ignore-scripts
(cd pwa && npm ci --ignore-scripts)   # only when the task touches pwa/
```

Work only in the worktree (a restarted builder resumes from it). Then `node tools/chart.mjs brief --task <id>` for each
task: its "Done when" is the bar, its notes refine it, its "Tenets in scope" are what the code review holds you to.

## Rules

- **Never** deploy, write a record, run a chart.mjs command that writes, or create or change a scheduled task. `brief`
  is a read.
- **Guarded paths are not yours** (`spec.boundaries.guarded`: chart/rules.json, tools/hooks.mjs, .claude/settings.json,
  tools/gate.mjs, spec.boundaries, spec.actions, CLAUDE.md's Hard limits, any tenet). Build the rest and report the
  exact change.
- **Stay in your files.** A rebase conflict in a file you don't own: abort and tell the build manager.
- **No new .md files**: plans and findings go in your report, procedure in a skill.
- **No edge-case hunting.** Test the behaviour Matt uses; a what-if is one line in your report.
- **Page writes go through a core composer** (test/actions.test.mjs fails a bare `write(variable)`).
- **core/evcore.mjs is at its 2,500-line cap:** new logic goes in a focused module (as core/study-plans.mjs).
- **Harnesses select by role and name, data-ui, data-key or the shell's region ids**, never by visual class.
- **Proprietary components are one file per component**; a look change lands through tokens or components, never in a
  view.
- **Current direction wins (D-411):** an old rule or check that conflicts with the current direction or your brief is
  reported; a check pinning a superseded rule is rewritten or retired in the same commit and named in the report.
- **Style work:** check hover, focus, read-only, folded and dark by hand, and name them in the report.
- **Model-path tasks** (pwa/claude.js, pwa/jobs.mjs, prompts, tool schemas, streaming, model ids, token limits): use
  Anthropic's claude-api skill when available, else docs.claude.com; never model ids or pricing from memory. Unit tests
  prove the request shape, not the real call: the staging run is the build manager's, so say what to try and what a
  good result looks like.

## Proofs by kind

The shared machine runs only fast, targeted checks, in the exact tree you push. Full suites (npm test, smoke, every
harness) run on GitHub: npm test and smoke on every push, the full harness suite once per batch by the build manager.

| The change touches | Local proof |
| --- | --- |
| Anything | `npm run format` + `node --test test/format.test.mjs`; the unit tests for the code you touched, with new tests |
| Style, Proprietary (page/ds, page/app/01-ui-*, 89-gallery-*) | `node tools/pixdiff.cjs [base] [head] --out <dir>`: 0 changed pixels for an invisible move, or the change only where intended (look at the diff images); the Gallery harness (`node test/harness/components.cjs synthetic <dir>`) when a component changed |
| Page behaviour (page/app) | `node tools/build.mjs`, then the one harness group you touched (`EV_ONLY=<group>`, `node test/harness/<name>.cjs synthetic <shots dir>`) at 1280; open the screenshots with Read and look |
| pwa/ | `npm run smoke:pwa`; `npm run test:run-api` when the run API is touched |
| A model call | the tests above; the staging run is the build manager's |

Type and spacing judged in a browser need the real font: route Inter with `.claude/skills/ev-ux-probe/fonts/inter-route.cjs`.
The phone is frozen at "it works": no phone layout, polish or phone-width screenshots.

## Commit and push

- Format before every push (the table's first row).
- One commit per task: `B-xxx: <what changed, in words>`, then the attribution lines.
- A change to chart/, a skill, CLAUDE.md or docs runs `node --test test/chart.test.mjs test/hooks.test.mjs
  test/skills-drift.test.mjs` before push.
- `git diff origin/main...HEAD --stat` touches only your files and the task's.
- `git fetch origin main && git rebase origin/main`, the format test and touched tests again if it brought anything in,
  then `git push origin HEAD:main`. Refused: rebase and push again. Never force-push, never a merge commit.
- Whoever turns main red fixes or reverts it within 30 minutes; the others hold their pushes.

## Report

Your final message is the report (SubagentHandback when you have it). After each task in a multi-task run, a short
note (sha, what Matt will see, test total). Final report, under about 15 lines: each sha with its task id; what Matt
will see; files changed; local proofs with totals and the CI result; anything not done and why (a guarded-path change
written out); edge cases, one line each; for a model-path task, what the staging run should try. Then
`cd /home/claude/ev4 && git worktree remove <scratchpad>/<name> && git branch -D <name>`.

## Runs started by a Job tap

A session started by the `ev4-builder` task is a builder run. Its first step is `node tools/guard.mjs --mark`: under
the marker `log`, `plan` and `ship` refuse a push that touches a guarded path, `log decision` refuses a tenet, and
deploy prints no trigger call. No one is watching: never wait for an answer; a question goes in a note with the task
`blocked`; anything irreversible or outside staging is `blocked`, except a ship job. It reads no live record except
the job: its health read takes the live watchdog's `last_run` from `list_triggers` (`brief` prints it).

The message it was fired with says what it is for. **Words to file** (bug:, idea: or request:): `report --from-chat
--reworded` first, then end. **`Job <id>`**: one ArtifactData get of jobs/<id> (live; staging when live has none), then
by the job's kind:

- **build**: `report bug|request --from-chat --job <id> --reworded "<his point>"`, triaged into a task whose done bar
  is written from his words, taken first, built, shipped to staging and traced.
- **reply**: `log <task> --note --from-job <id> --waiting-on none`, then that task when it was blocked only on that.
- **design**: read the north star's tab (Claude Docs read of https://claude.ai/artifact/4SJmAvp26TbGAXFUwfGqcd) and
  list the job's record's weeks, then `trace --job <id> --record <record> --status done --kickoff`.
- **plan**: read the tab of the doc the job's brief links, `plan --from <that link> --apply`, then `trace --job <id>
  --record <record> --status done --filed`.
- **ship**: his Ship it tap is his OK for that one commit. Get jobresults/<id> too (a result means the tap was spent),
  then `ship live --from-job <id>` with every call and read it prints until GREEN (`.claude/skills/ev-build-manager/references/ship.md`); it refuses a job not of kind ship, not from his page, naming another commit, with a result, or
  over 24 hours old. Rollback stays a build chat's act with Matt present.

Every job run ends with `trace --job <id> --record <the job's record> --status done|failed --note "..."` and the calls
it prints. A run does its one thing and ends: it takes no other task and never fires the builder again.
