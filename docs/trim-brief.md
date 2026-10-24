# The trim brief (D-258, D-259, B-262)

E.V. works, but the machinery around it grew as big as the study logic itself. The trim makes it smaller and easier
for Matt to understand **without changing what studying feels like**. It runs during the freeze, in parallel with
Matt's onboarding: every cut comes to him as a product review card (D-261), and nothing reaches main until he approves it.

**To start a trimmer:** open a new Claude Code session on `miura5/ev4` with the prompt "You are a trimmer. Read
docs/trim-brief.md and do the next job." **To review a cut:** a fresh session or subagent gets the pull request and
this brief, nothing else.

## The four roles

| Who | Does | Never |
| --- | --- | --- |
| Trimmer | One cut per branch and pull request | Merges, deploys, writes `chart/`, or adds new machinery |
| Reviewer | Checks one pull request against this brief, without the trimmer's reasoning first | Writes code |
| Freeze chat | Turns an approved pull request into Matt's product review card (D-261), then merges it on his OK | Merges without Matt's OK |
| Matt | Approves each cut once he can explain it in a sentence | |

## Trimmer: the next job

Read CLAUDE.md's hard limits and this brief. The build chat's "Every session" steps don't apply to a trimmer: you take
no backlog task and write nothing to `chart/`.

1. **If `docs/trim/inventory.md` doesn't exist, write it first** (it is also freeze-exit task B-258). It has one row
   for each of these:
   - every rule in `chart/rules.json`
   - every hook in `.claude/settings.json`
   - every workflow in `.github/workflows/`
   - every pipeline in `spec.pipelines`
   - every tool in `tools/`
   - every section of CLAUDE.md

   Columns:
   - What it is.
   - The failure it prevents, named with its decision or incident.
   - When it last fired, with evidence from git log, run records or Chart notes, or "never" or "unknown".
   - Lines.
   - Risk to studying if it goes: none, low or high.
   - Suggestion: keep, shrink or retire.

   Open it as its own pull request. It removes nothing.
2. **Otherwise take the top row marked shrink or retire that no open pull request has claimed.** Order:
   1. Process that never fired, and cuts that are only text in `tools/`, `.github/`, `.claude/` or `docs/`.
   2. CLAUDE.md: the gotchas move to a lessons file, and only rules that still name a failure stay.
   3. Dead code.
   4. Test and check time.

   Study logic, the record, schemas and pipeline behavior are out of scope.
3. **One cut per branch** (`trim/<what>`, from main's head). The pull request is titled `B-262: trim <what>`, and its
   body has these headings:
   - **What goes**
   - **The failure it guarded**
   - **Evidence it can go**
   - **What Matt should understand:** three plain sentences, and an analogy is welcome.
   - **Risk to studying**
   - **Budgets before and after:** CLAUDE.md words, process lines (tools/, core/deploy, gates, guards, hooks), check
     minutes.
   - **Tests:** npm test green.

Ask "would a senior engineer keep this in a one-person study app?", not "can I make the tests pass?". Prefer a cut
that is easy to explain over a large one.

**Never:**
- Write `chart/`, change `spec.boundaries` or a hard limit, touch a live or staging record, deploy, or change a
  scheduled task.
- Delete anything outside the repository. Repository code may go outright; git keeps it (D-166).
- Replace what you cut with a new rule, gate or tool. If you think one is needed, say so in the pull request and stop.

## Reviewer

Read the diff and this brief, and only then the pull request's text. Check that:

- **The evidence is real:** "never fired" is shown, not assumed.
- **Nothing study-facing changed:** what the page shows, what a run writes, the record and the schemas are untouched,
  unless the pull request says so plainly.
- **The hard limits are intact.**
- **No replacement machinery was added.**
- **Lines went down,** and the explanation for Matt is true and plain.

Verdict, in one line: approve, change (what) or reject (why).

## Freeze chat: merging

When a pull request has the reviewer's approve:

1. Turn it into a product review card (D-261: what changes for him, why, the parts it touches, what could break, size, checks done; no code) and wait for Matt's verdict.
2. On his OK, squash-merge to main with the message `B-262: trim <what>` and the session's attribution lines.
3. Ship as the files require:
   - **Only `tools/`, `.github/`, `.claude/`, `docs/` or CLAUDE.md changed:** npm test green is enough. These files
     aren't in the deployed build (tools/build.mjs HASHED).
   - **A hashed file changed** (`core/`, `page/`, `scripts/`, `spec/`): ship staging, the full check, and live on
     Matt's OK, like any change.
4. Mark its inventory row done, and update How E.V. Works or the System Map if the cut changes what they describe.

No merges in the days around an exam, and a bug that breaks studying always comes first.
