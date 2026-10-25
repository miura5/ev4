# Build manager handover

The build manager rewrites this file before a chat is cleared or ends (CLAUDE.md, Roles, D-317). A new build manager
reads it right after CLAUDE.md. It holds no personal data: the repository is public.

**Managing chat:** https://claude.ai/code/session_01CWeveciiiW2pUvFQtQJ3HK (still managing as of Oct 25, 17:40
Central)

## Where things stand

- The redesign release (D-312, D-315, D-316): four fix waves are done and shipped to staging. The release bar changed
  to the rubric (D-317) after the wave-4 review found 13 small differences.
- Wave 5 (B-382 to B-386) was stopped by Matt before any code landed. Its tasks show in progress under dead claims;
  they are superseded by the fixes the rubric review names.
- B-381 (data review fixes: graded items, scores, idea ids) is done at e5d8124, staging GREEN.

## Running

- UI reviewer: scoring the rubric at d299b24 (wave 4) on three records; output in /home/claude/ui-review5 (outside the
  repository; holds a staging-data snapshot).
- Test agent (B-357): bringing npm test and the harnesses in line with the demo; the full check was RED at 17:12 and
  it is fixing the run harness. Its edits are in /home/claude/ev4.
- An agent is updating the build workflow map with D-317.
- No lanes are running.

## Next

1. Read the rubric card. Below the bar: file its top fixes as "Fidelity fix: <view>" tasks, retire B-382 to B-386 in
   their favour, fire the lanes (at most two fix waves). At or above: go to step 2.
2. Independent review of the test agent's work; code review of the whole sprint diff; full npm run check GREEN; ship
   staging GREEN, all at one commit.
3. Release card to Matt; live waits on his word.

## For the release card

- A stray remote branch `mgr-chart` was pushed by mistake; deleting it was refused (nothing is deleted). It can be
  ignored or removed by Matt.
- Matt's staging record shows the evening Mac run's last run failed; look into it before live.
