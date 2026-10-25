# Build manager handover

The build manager rewrites this file before a chat is cleared or ends (CLAUDE.md, Roles, D-317). A new build manager
reads it right after CLAUDE.md. It holds no personal data: the repository is public.

**Managing chat:** https://claude.ai/code/session_01CWeveciiiW2pUvFQtQJ3HK (still managing as of Oct 25, 12:40
Central)

## Where things stand

- The redesign release (D-312, D-315, D-316): the rubric review of wave 4 (d299b24) scored 82/100, no factor below 4,
  no blockers: over the bar (D-317). Its card and pairs are in /home/claude/ui-review5 (outside the repository).
- One rubric wave (the first of at most two) is building the review's top fixes: B-382 Today, B-383 E.V., B-384
  Frame, B-385 Study, B-386 Progress, lanes fired 12:39 Central. On the phone, quick-ask chips stay one row (Matt's
  rule), not the demo's two.
- B-381 (data review fixes) is done at e5d8124.

## Running

- Lanes today, ev, frame, study and pr on B-382 to B-386.
- Test agent (B-357): the full check was RED at 17:12; it is fixing harnesses in /home/claude/ev4.

## Next

1. Watch the lanes every 4 minutes until B-382 to B-386 are done on staging.
2. Independent review of the test agent's work; code review of the whole sprint diff; a final rubric click-through;
   full npm run check GREEN; ship staging GREEN, all at one commit.
3. Release card to Matt; live waits on his word.
4. The Chart rows B-328 to B-331 still carry the old model (90-minute stale claims, one chat per milestone, Matt
   present): bring them in line with D-317.

## For the release card

- A stray remote branch `mgr-chart` was pushed by mistake; deleting it was refused (nothing is deleted). It can be
  ignored or removed by Matt.
- Matt's staging record shows the evening Mac run's last run failed; look into it before live.
