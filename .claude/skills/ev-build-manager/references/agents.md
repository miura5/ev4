# Agents: briefs and the liveness watch

## A builder's message

- Load the `ev-builder` skill first.
- Task ids in build order; the track or lane and the files it owns; context the Chart does not hold (Matt's words,
  related running tasks, a staging run to reuse); the attribution lines.
- Builders never ship, deploy, write a record or change a scheduled task; guarded paths (`spec.boundaries.guarded`)
  come back to you as a written change.

## Design agent (big asks)

Give it Matt's words, the record, the demo and the relevant decisions. It returns options and a recommendation; you
choose and record each choice with `log decision`. Its hand-off lives under docs/design/ only when it is a doc the
`plan --from` command reads.

## Spike (D-409)

A throwaway worktree; no commits, pushes or Chart writes; no full suites, only the measuring tools it needs; about an
hour. It reports causes with counts, the fix per cause, what cannot be done and why, and a build estimate. A builder
then builds from that report.

## Code reviewer

One fresh agent (or 2 to 4 splitting the diff) per release with the review skill, over the whole release diff. Only
lost or wrong data, unexpected cost, security holes, crashes and controls Matt can't reach are blockers; everything
else is one line each for the backlog.

## UI reviewer

A fresh agent that hasn't seen the work clicks through the demo and the staging app like a person
(tools/fidelity/crawl.cjs), on the synthetic record, in desktop Chrome at 1280, only the screens the release changed,
for at most 20 minutes. It scores the rubric (`references/release-card.md`) at one pinned commit and lists the fixes
that lift the score most; you file those as tasks. The score is information for the card, never a gate.

## Liveness watch (D-358)

- While any agent works, check each transcript; one quiet for 10 minutes is checked: finished, or stopped and
  restarted from its saved work (its worktree).
- After Matt interrupts a turn (it stops background agents), check every agent first and restart what stopped.
- A status to Matt starts from whether each agent is running, never from its files alone.
