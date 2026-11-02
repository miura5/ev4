# The one-time probe

Goal: a map of ev4 the designer can trust without reading code. Agents read; the designer synthesises. Run it once,
then add to it only by a targeted question (end of this file).

## Before starting

- `git fetch` and note the ev4 commit; every finding cites it.
- Tell Matt the plan in two lines: eight read-only agents in parallel, about 20 to 40 minutes, then a synthesis.
- Use read-only agents (Explore). They never edit, run full suites, deploy, or touch records.

## The eight areas

| Area | Reads |
| --- | --- |
| A. Views | page/app view files (Today, Study, Notes, Progress, Record, E.V. window), how they share state |
| B. Design system | page/ds tokens, components, patterns, views CSS; page/app/01-ui-*; the Gallery; per-view overrides |
| C. Domain | core/*.mjs: entities, rules, what is pure and what does IO, file sizes |
| D. Jobs and model | pwa/ (Worker, jobs, claude, bridge), the E.V. tool list, every place a job starts and where its result lands |
| E. Data | D1 schema, collections, migrations, backup and export, the claude.ai records still in use |
| F. Ops | tools/ (chart, ship, build, deploy, verify), workflows, scheduled tasks and their prompts |
| G. Tests | test/ and test/harness: what's covered, file sizes, flaky or quarantined checks, what runs where |
| H. Instructions | CLAUDE.md, every skill, spec rules and tenets, the handover: where they repeat or contradict each other or the code |

## The brief each agent gets

> You are a read-only probe agent for E.V. 5's design. Area: <A–H, its reads>. Repo: /Users/peachfritter/ev4 at
> <commit>. Map what is there; don't propose a redesign. Measure, don't estimate (line counts, counts of call sites,
> import edges). Write each finding as one JSON object (schema below) and return a JSON array, nothing else, with at
> most 25 findings, worst first. Cite path:line for every claim. If something can't be determined, say so in the
> finding rather than guessing.

## A finding

```json
{
  "id": "F-D07",
  "area": "D",
  "title": "Jobs start from about 20 files across three runtimes",
  "severity": "S1",
  "evidence": ["pwa/jobs.mjs:12", "page/app/20-study.js:784"],
  "measure": "20 files, 3 runtimes",
  "effect": "E.V. can't see job status; results land in three views",
  "v5": "edit",
  "v5_note": "one job runtime and Activity; keep the job kinds and their prompts"
}
```

- `id`: `F-` plus the area letter and a two-digit number (F-D07), so it never reads as a Chart id.
- `severity`, judged by what it does to v5's design:
  - **S1**: shapes the skeleton, or causes lost data or repeated breakage. The designer must answer it.
  - **S2**: causes drift or rework most weeks.
  - **S3**: friction worth fixing in v5.
  - **S4**: cosmetic or local.
- `v5`: `carry` (port as is), `edit` (port, changed), `drop`, or `unknown`.

## Synthesis (the designer)

1. Save each agent's array as `findings/<area>.json` (from the agent's result, not retyped).
2. Merge duplicates across areas, keeping both ids in `evidence`. Re-rank by severity, then by how many areas a
   finding touches.
3. Write `diagnosis.md`: the S1 and S2 findings in full sentences, then a one-line index of the rest by id.
4. Seed the ledger: one row per `carry`, `edit` or `drop`, citing the finding id.
5. Rebuild the Diagnosis board from `diagnosis.md`: severity groups, each item with its id so Matt can ask about it.
   It may become two boards (S1–S2, S3–S4) rather than shrinking text to fit.
6. Note in the handover anything an agent marked as undetermined; those are questions, not facts.

## Later questions

A design question that needs code ("does anything outside core write to sessions?") goes to one read-only agent
with the same brief, limited to that question. Its answer becomes a new finding with the next id, and the Diagnosis
is updated if the severity warrants it.
