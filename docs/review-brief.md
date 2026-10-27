# The architecture review: brief (B-415)

The hand-off for E.V.'s in-depth architecture review. Matt hands this back to the build manager when the fixes
milestone is met (D-347); the build manager runs it from here. It holds no personal data: the repository is public.

## Why it matters

The review looks at E.V. at its most complex point, right after the switch to the app. Three things come out of it,
and each one carries weight:

1. **The consolidation plan.** The consolidation release (Phase 4) is only as good as this plan.
2. **A map of the whole system.** It becomes the textbook for Matt's hands-on engineering course (B-417).
3. **A list of small, well-scoped tasks.** Matt's first jobs when he joins development as an intern.

## Who does what

- **Matt is the customer, not a participant.** He does not frame, steer or read the review's working material. He
  answers a few plain questions about what he wants from E.V. long-term, reads one overview in everyday words at the
  end, and decides only what is his: anything large (Roles, D-317), such as retiring something he uses.
- **The build manager owns it end to end:** writes the frame, has it reviewed, runs every stage, keeps the findings
  record, and turns the result into the plan, the course outline and the task list.
- **Agents do the reading.** Every agent writes its output to files under `docs/review/`, never back into the build
  manager's context, so the manager's context stays free for steering.

## Ground rules

- **Read-only.** The whole review runs on one frozen commit, in separate worktrees. No deploys, no record writes, no
  task changes. The stability window (two weeks of stable use) is never touched.
- **Evidence or it doesn't count.** Every finding names the code (file and line) or a reproduction. An impression is
  not a finding.
- **Facts before opinions.** Agents start from the generated facts of Stage 1, not from skimming.
- **Budget.** Matt's Max 20x weekly usage. The manager checks usage between stages; if it runs hot, Stage 3 is trimmed
  first. Never more than 6 to 8 agents at once.

## Stage 0: the frame (build manager, then an independent check)

The build manager writes `docs/review/frame.md`:

- the frozen commit;
- the questions the review must answer (what to keep, merge, split or retire; where data is at risk; what makes
  releases slow; what a newcomer finds hardest);
- the upkeep numbers to measure before and after: lines of code, places E.V. runs, deploy steps, full-check time, flaky
  tests, open edge cases, scheduled runs per day and their usage;
- the areas and lenses below, and what each map must contain;
- the evidence rule and the budget.

A **fresh reviewer** who has not seen the work checks the frame for gaps and bias before anything starts. The build
manager fixes the gaps once.

**Matt's part:** answer up to five plain questions about the long term, in the chat, whenever suits him: for example
what E.V. must still do a year from now, what he would give up for simplicity, and what he most wants to learn. His
answers go into the frame as the customer's goals. Nothing else of Stage 0 reaches him.

## Stage 1: facts (scripts, cheap)

Generate the hard data before any agent forms a view, into `docs/review/facts/`:

- what calls what (modules and functions);
- which code writes which collection of the record, and through which store;
- dead code and duplicated logic;
- how much each part is tested, and which tests are flaky (from the nightly history);
- the spec's use: which parts of `spec/ev.spec.json` are read, and by what;
- the upkeep numbers of Stage 0, measured now.

## Stage 2: map every area twice (the fan-out)

About eight areas. Two mappers take each, independently, without seeing each other's work: 16 maps, in waves of 6 to 8.

1. The record and its data: schemas, collections, D1, migrations.
2. Core logic: weak spots, sessions, notes, planning (core/).
3. The page (page/app/).
4. The app and its server (pwa/, the Worker).
5. The scheduled runs (pipelines, the run protocol, prompts).
6. The Mac and backups (evening-mac, the restore drill, exports).
7. Tooling and deploy (tools/, the Chart, ship, workflows).
8. Tests and checks (test/, the harnesses, the nightly).

Each map, in `docs/review/maps/<area>-<a|b>.md`, covers: what the area is for; how data flows through it; what it is
tangled with; what is dead weight; where the risks are; and how a newcomer would learn it.

## Stage 3: lenses across every area (fresh agents)

One agent per lens, reading across all areas, into `docs/review/lenses/`:

- data safety and recovery;
- failure modes (what breaks, how it shows, how it recovers);
- duplication and simplicity;
- cost (Claude usage and API calls per day);
- release friction (what made Oct 26's release take an afternoon);
- learnability (what a newcomer, Matt, finds hardest).

## Stage 4: reconcile and challenge

- Where an area's two maps disagree, an agent settles it from the evidence and writes the area's reconciled map.
- A red team tries to knock down the top 20 findings. Anything that does not survive is dropped.
- The result is `docs/review/findings.md`: findings that survived, each with its evidence and its weight.

## Stage 5: two architects, two plans

Two architects draft consolidation plans independently from the reconciled maps and the findings. A third compares them
and merges the best of each into `docs/review/consolidation-plan.md`:

- the target shape;
- the steps in order, each shippable on its own through staging;
- before-and-after numbers for every upkeep measure;
- what to leave alone, and why.

## Stage 6: stress-test the plan

A fresh panel asks of every step: can it ship alone; is the record safe the whole way through; can it be reviewed; does
the order hold. Gaps are fixed once and checked once more; what is still open goes in the overview.

## Stage 7: outputs

- **For Matt:** a one-page overview in everyday words (a release-card style page): what E.V. looks like inside today,
  what the consolidation will change for him (nothing visible, plus the D-345 trash), the before-and-after numbers, and
  the large decisions, each with its options. He reads it and decides those; nothing else is asked of him.
- **The consolidation tasks**, filed in the Chart from the plan.
- **The course outline (B-417):** chapters drawn from the reconciled maps.
- **The intern task list:** small findings marked as good first tasks, ranked by what they teach.

## Scale

Roughly 30 to 40 agent runs over 2 to 3 days, never more than 6 to 8 at once. Stages 2 and 5 are where the Max plan pays
most: two independent maps per area and two independent plans catch what one would miss.

## Done when

The plan has passed Stage 6, its tasks are filed, Matt has read the overview and decided the large items, and the
course outline and intern task list exist.
