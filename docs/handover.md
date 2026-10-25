# Build manager handover

The build manager rewrites this file before a chat is cleared or ends (CLAUDE.md, Roles, D-317). A new build manager
reads it right after CLAUDE.md. It holds no personal data: the repository is public.

**Managing chat:** https://claude.ai/code/session_01CWeveciiiW2pUvFQtQJ3HK (still managing as of Oct 25, 12:40
Central)

## Where things stand

- The redesign release (D-312, D-315, D-316): the rubric review of wave 4 (d299b24) scored 82/100. The one rubric
  wave (B-382 to B-386) is done on staging; the page is frozen at fc9133e. On the phone, quick-ask chips stay one row
  (Matt's rule), not the demo's two.
- The Foundation v4 doc is retired (D-318).

## Running

- At fc9133e: the final rubric click-through (output /home/claude/ui-review6, outside the repository) and a code review
  in two parts (page; core, data, tools and the PWA groundwork).
- Test agent (B-357): bringing the harnesses in line, then npm run format and the full npm run check.

## Next

1. Fix the reviews' gaps once and review once more; independent review of the test agent's removed or loosened checks.
2. Full npm run check GREEN and ship staging GREEN at one commit; release card to Matt; live waits on his word.
3. Next release: the PWA. B-316 waits on Matt turning on R2 in Cloudflare; B-315 needs a safe home for the staging
   Worker token in the cloud runs' settings (work it out before asking him); B-318 (ship flow) after this release.

## For the release card

- A stray remote branch `mgr-chart` was pushed by mistake; deleting it was refused (nothing is deleted). It can be
  ignored or removed by Matt.
- Matt's staging record shows the evening Mac run's last run failed; look into it before live.
