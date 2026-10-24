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
   read back, a harness check by name, a verify-deploy result. A clause with no evidence is a gap. The review runs
   before `ship staging`, so a clause that only the staging deploy can prove (staging GREEN, a staging page read) is
   not a gap: name it on the Size line as "staging: after review".
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
   - the hard line (D-200, B-184): any diff to a guarded path (`spec.boundaries.guarded`: chart/rules.json,
     tools/hooks.mjs, .claude/settings.json, tools/gate.mjs, spec.boundaries, CLAUDE.md's Hard limits, any tenet) is
     reported, saying whether a chat with Matt present made it; and any create_trigger or update_trigger call in a
     builder run's transcript (a session whose first step wrote /tmp/ev/builder-run) is reported.
6. Check the diff against each tenet in scope: one checked by `harness`, `lint` or `ship` needs that check named and
   green for this work; one checked by `review` is judged here, from the diff. A change that goes against a tenet is a
   gap unless a superseding tenet and its sweep task are in the record.
7. Checks retired or loosened: list every test, harness check or assertion the diff removes or weakens (a narrower
   condition, a wider tolerance, a skip). Each one is either:
   - **Matt's call:** a superseding decision in the record covers it, or the task's Notes carry his OK for it. List it
     on the Checks line below. It is not a gap: never ask for it back, and never ask the work to bend to it. Matt
     overrides checks that the work would otherwise route around for the task's sake at the milestone's expense
     (Oct 24).
   - **Unrecorded:** a gap: bring it in line with the tenets now in force, keep it, or record Matt's OK.
8. Size: count lines added and removed in the diff. Judge any growth against the area's map in `docs/trim/scan/`
   (core, harness, page, spec, tools-tests). Growth the definition of done doesn't call for is a gap that names what to
   fold: a second copy of something that exists, a special case where one general rule would do, or scaffolding left
   behind.
9. Report.

## Report

Only gaps, one line each, most important first, each naming where it is (file and line, commit, or the clause it
leaves unproved) and what would close it:

```
Gaps in B-nn:
- <where>: <what is missing or wrong>; <what would close it>
Checks retired or loosened: <each, with "Matt's call (D-nnn or the note)">, or none
Size: +<added> -<removed> lines; <in line with the definition of done, or the growth named as a gap above>
```

If there are no gaps, the first line is `No gaps in B-nn.` and the Checks and Size lines still follow: they go on
Matt's card either way.

Beyond those two lines: never list what is fine, never praise, never restate the work, never propose features. A
judgment call the definition of done does not settle is not a gap; leave it out.
