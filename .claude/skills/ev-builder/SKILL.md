---
name: ev-builder
description: Load first when you are an E.V. builder agent the build manager started for one or more B-xxx tasks; setup, rules, proofs by kind, commit and push, and the report back.
---

# E.V. builder (D-351, D-366, D-385)

You build one or more backlog tasks (B-xxx) the build manager gave you, prove them, push them to `main` and report. The
build manager claims the task in the Chart, ships staging, runs the end-to-end run and talks to Matt; you do none of
those. CLAUDE.md is the contract and wins wherever this skill is shorter or older: read it before anything else.

A scheduled `ev4-builder` run or a lane run (fired "Lane <name>") is not this kind of builder: it follows CLAUDE.md
("Every session", "Builder runs") and its own prompt, which may have it claim, record or ship. It may still use the
proofs and lessons here.

## What the build manager's message gives you

- **Tasks:** the ids, in the order to build them.
- **Track or lane:** its name and the files it owns (D-385, D-388). Other builders own the rest.
- **Context** the Chart does not hold: what Matt said, related tasks running now, a staging run to reuse.
- **Attribution lines** for every commit.

If the ids or the attribution lines are missing, report that back without building.

## Setup

```
cd /home/claude/ev4 && git fetch origin main && git worktree add <scratchpad>/<name> origin/main -b <name>
cd <scratchpad>/<name> && npm ci --ignore-scripts
(cd pwa && npm ci --ignore-scripts)   # only when the task touches pwa/
```

Work only in the worktree: a container restart can stop you, and the worktree is what a restarted builder resumes from.

Then read, in this order:

1. CLAUDE.md: Roles, "Delivery first (D-366)", Guardrails, Every session steps 5 and 6, Rules from past failures.
2. `node tools/chart.mjs brief --task <id>` for each task. Its "Done when" is the bar; its notes can refine it, and its
   "Tenets in scope" are what the code review will hold the diff to.
3. Before changing a large file, its map in `docs/trim/scan/` (core, harness, page, spec, tools-tests).

## Rules

- **Never** deploy (no `ship`, no `deploy`), write a record, run a chart.mjs command that writes, or create or change a
  scheduled task. `brief` is a read and is fine.
- **Guarded paths are not yours:** `spec.boundaries.guarded` lists them (chart/rules.json, tools/hooks.mjs,
  .claude/settings.json, tools/gate.mjs, spec.boundaries, spec.actions, CLAUDE.md's Hard limits, any tenet). If a fix
  needs one, build everything else and report the exact change; the build manager takes it to Matt.
- **Stay in your files.** Small local edits elsewhere are fine; a conflict in a file you don't own means abort the
  rebase and tell the build manager, never resolve it in their file.
- **Hard limits** are CLAUDE.md's. Nothing personal enters the repository; nothing is deleted from a record.
- **No edge-case hunting (D-366).** Test the behaviour Matt uses. A what-if (clock skew, rare drops, phrasing variants,
  timing windows) is one line in your report, never a test or a fix round.
- **Page writes go through a core composer.** test/actions.test.mjs's D-200 lint fails a bare `write(variable)`.
- **core/evcore.mjs is at its 2,500-line cap.** New logic goes in a focused module (as core/cards.mjs,
  core/study-plans.mjs).
- **Harnesses select by role and name, data-ui, data-key or the shell's region ids (D-387)**; never by visual class.
- **Proprietary components are one file per component (D-388)**; a look change lands through tokens or components,
  never in a view (D-380, D-382).

## Model-path tasks

A task that touches E.V.'s model calls (pwa/claude.js, pwa/jobs.mjs, prompts, tool schemas, streaming, thinking,
caching, model ids, token limits) reads Anthropic's claude-api skill first: the `claude-api` project skill in
`.claude/skills/claude-api/` (vendored unchanged from github.com/anthropics/skills under its Apache 2.0 licence). Use it
for model ids, parameters and pricing; never answer those from memory. The real staging run of that path is the build
manager's (Guardrails, "Run it for real first"): your report says what to try and what a good result looks like.

## Proofs by kind

Run each in the exact tree you push. See `references/proofs.md` for commands, the sandbox's known failures and how to
read the results.

| The task touches | Proof |
| --- | --- |
| Anything | `npm test` GREEN with new tests for the change; read the total (`# pass`) |
| The page (page/) | `npm run smoke` GREEN; the harness for each view touched at 390 and 1280; screenshots looked at |
| pwa/ | `npm run smoke:pwa` GREEN; `npm run test:run-api` when the run API is touched |
| Proprietary (page/ds, 01-ui-*) | the Gallery harness, and `node tools/pixdiff.cjs` showing nothing moved that shouldn't |
| A model call | the tests above; the staging run is the build manager's |

Before reporting, run `npm run check -- --touched` once (Every session step 5), in the background.

## Commit and push

- **Format before every push (B-586).** Run `npm run format`, then `node --test test/format.test.mjs`, and push only
  when it passes. This holds on every push, even one where you skipped the heavier checks: builder pushes on Oct 30 turned main red on formatting alone (B-575, B-579, B-586).
- One commit per task: `B-xxx: <what changed, in words>`, then the attribution lines from the message.
- `git fetch origin main && git rebase origin/main`, `npm test` again if the rebase brought anything in, then
  `git push origin HEAD:main`. Refused: rebase and push again. Never force-push, never a merge commit.
- Whoever turns main red fixes it or reverts within 30 minutes; the others hold their pushes until it is green.

## Report

Subagents cannot hand back files: the report is your final message (SubagentHandback when you have it).

- After each task in a multi-task run, a short note to the build manager (sha, what Matt will see, test total), then
  go on.
- Final report, under about 15 lines:
  - each sha with its task id;
  - what Matt will see, in plain words;
  - files changed;
  - proofs with totals (`npm test` pass count, smoke, harnesses, `--touched`), and any check that failed for a known
    sandbox reason, named;
  - anything not done or skipped, and why (including a guarded-path change, written out);
  - edge cases noticed, one line each, for the backlog;
  - for a model-path task, what the staging run should try.

Then remove the worktree and its branch:
`cd /home/claude/ev4 && git worktree remove <scratchpad>/<name> && git branch -D <name>`.
