---
name: review
description: Review one E.V. v4 backlog task (B-nn) before it is marked done; reports only the gaps against its definition of done and CLAUDE.md, and changes nothing.
---

# Review a task before it is marked done (B-59)

Use this on one backlog id, from a build chat, before that task is marked `done`. Best run by a subagent that has not
seen the work, so the work is not grading itself. The review reads; it never edits, reverts, commits, deploys, fires a
task or writes to a record. It never blocks anything by itself: the build chat decides what to do with what it finds.

## Inputs

- The task id, e.g. `B-47`.
- Optionally the commit range of the work; otherwise every commit whose message starts with the task id.

## Steps

1. Read the task's row in `BACKLOG.md` (Task, Depends, Notes) and its definition of done. The definition of done is
   the "Definition of done" column of the Build plan tab of E.V. Foundation v4 (read it with the Claude Docs tools);
   when that tab is not reachable, use the "Done when" text in the row's Notes and say so.
2. Read `CLAUDE.md`, then the task's tenets in scope: `node tools/chart.mjs brief --task <id>` lists them under
   "Tenets in scope" (B-109), each with its scope and how it is checked.
3. Find the work: `git log --format='%h %s' --grep='^<id>'` (and the range if given); `git show --stat` each commit and
   read the diffs that matter.
4. Check each clause of the definition of done against evidence you can point to: a test by name that exists and
   passes (`node --test test/*.test.mjs > /tmp/review.log 2>&1; grep -E "^# (pass|fail)" /tmp/review.log`), a run id
   read back, a harness check by name, a verify-deploy result. A clause with no evidence is a gap.
5. Check the work against `CLAUDE.md`:
   - every new branch of logic in `core/` has a test that reaches it;
   - spec edits are JSON at indent 1 with no trailing newline (`test/spec.test.mjs` checks the file; look at the diff);
   - every commit message starts with the task id and ends with the session's attribution lines;
   - nothing outside the task's scope changed;
   - no date gates work anywhere the task touched; gates are evidence;
   - nothing personal entered the repository (`fixtures/` and `dist/` stay ignored);
   - a pipeline's proof is a scheduled task fired against staging and its `runs/<id>` read back, not a hand replay;
     a page's proof is the harness at phone and desktop width with screenshots looked at;
   - shipping steps that apply: pushed, `ship staging` with every printed call until it says GREEN,
     never live without Matt's explicit OK;
   - recording: the task's Notes line through `log`, the deploy through `ship` (CHANGELOG.md, D-172).
6. Check the diff against each tenet in scope: one checked by `harness`, `lint` or `ship` needs that check named and
   green for this work; one checked by `review` is judged here, from the diff. A change that goes against a tenet is a
   gap unless a superseding tenet and its sweep task are in the record.
7. Report.

## Report

Only gaps, one line each, most important first, each naming where it is (file and line, commit, or the clause it
leaves unproved) and what would close it:

```
Gaps in B-nn:
- <where>: <what is missing or wrong>; <what would close it>
```

If there are none, the whole report is: `No gaps in B-nn.`

Never list what is fine, never praise, never restate the work, never propose features. A judgment call the definition
of done does not settle is not a gap; leave it out.
