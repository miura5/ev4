---
name: review
description: The whole-release code review (D-366) - one fresh agent (or 2 to 4 splitting it) reads a release's commit range for lost or wrong data, unexpected cost, security holes, crashes and controls Matt can't reach; reports only those, and changes nothing.
---

# The whole-release code review (D-366)

One review per release, before the release card, by a fresh agent that has not seen the work (or 2 to 4 splitting the
range). It replaces the per-task review. The review reads; it never edits, reverts, commits, deploys, fires a task or
writes to a record. It never blocks anything by itself: the build manager decides what to do with what it finds.

## Input

- A commit range, `<from>..<to>` (the last live build to the release head), and, when split, the files or commits this
  reviewer owns.

## Steps

1. Read `CLAUDE.md` (Delivery first, Guardrails, Hard limits), then for the tasks in the range
   `node tools/chart.mjs brief --task <id>`: its "Tenets in scope" (B-109) name what the diff is held to.
2. Read the range: `git log --format='%h %s' <range>`, `git diff --stat <range>`, then the diffs that matter.
3. Look only for what would hurt Matt:
   - **Lost or wrong data:** a write that drops, overwrites or misfiles a record document; a path that deletes (B-11);
     a migration or composer that loses fields.
   - **Unexpected cost:** a model call that runs more often, on a bigger model, or with more tokens than its feature
     needs; a loop or retry with no bound.
   - **Security holes:** a token or secret in the repository, a log or a URL; an unauthenticated route; personal data
     entering the repository.
   - **Crashes:** an uncaught error on a path Matt uses; a view that fails to render on real data.
   - **Controls Matt can't reach:** a button, tab or step that is hidden, dead or covered.
4. Check the diff against each tenet in scope: one checked by `harness`, `lint` or `ship` needs that check green on
   the release head; one checked by `review` is judged here, from the diff.
5. Watch the hard line (D-200, B-184): any diff to a guarded path (`spec.boundaries.guarded`: chart/rules.json,
   tools/hooks.mjs, .claude/settings.json, tools/gate.mjs, spec.boundaries, spec.actions, CLAUDE.md's Hard limits, any
   tenet) is reported, saying whether a chat with Matt present made it; and any create_trigger or update_trigger call in
   a builder run's transcript (a session whose first step wrote /tmp/ev/builder-run) is reported.
6. Checks retired or loosened: list every test, harness check or assertion the range removes or weakens (a narrower
   condition, a wider tolerance, a skip). Each is **Matt's call** or the build manager's (a superseding decision in
   the record covers it; never ask for it back) or **unrecorded** (a finding).
7. Size: lines added and removed in the range, judged against the area's map in `docs/trim/scan/`.
8. Edge cases outside step 3 (clock skew, rare network drops, wording, phrasing variants, timing windows) are not
   findings: list each in one line for the backlog. They never start a fix round.

## Report

```
Findings in <range>:
- <where>: <the harm (data, cost, security, crash, unreachable)>; <what would close it>
Guarded paths: <each, with who made it>, or none
Checks retired or loosened: <each, with "Matt's call (D-nnn)" or "unrecorded">, or none
Size: +<added> -<removed> lines; <in line, or what to fold>
Backlog (one line each): <edge cases>, or none
```

If there are none, the first line is `No findings in <range>.` and the other lines still follow: they go on Matt's
release card either way. Never list what is fine, never praise, never restate the work, never propose features.
