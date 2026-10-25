# Build manager handover

The build manager rewrites this file before a chat is cleared or ends (CLAUDE.md, Roles, D-317). A new build manager
reads it right after CLAUDE.md. It holds no personal data: the repository is public.

**Managing chat:** https://claude.ai/code/session_01CWeveciiiW2pUvFQtQJ3HK (still managing as of Oct 25, 12:40
Central)

## Where things stand

- The redesign release is ready on staging at 10798d8: rubric 92/100 at fc9133e (no blockers), every fix since then
  reviewed, npm test and the full npm run check GREEN at 10798d8 (dist/check-full.json in /home/claude/ev4), ship
  staging GREEN at 10798d8. The release card went to Matt: https://claude.ai/artifact/GTNQqa8fSzZ4V7m96uQG8A.
- Live waits on Matt's word. On it: ship live --matt-ok at 10798d8 exactly (R-02, R-04, R-06 hold there).

## Running

- Nothing.

## Next

1. On Matt's word, ship live at 10798d8.
2. B-391 (cleanup): its notes list every open item from the release reviews.
3. The PWA release: B-389 (Worker hardening), B-315 (runs read the staging token from the staging record; ask Matt
   for the token then), B-317 to B-320. Scheduled runs reach the staging Worker (Matt allowed its domain); they don't
   get environment variables.
4. Workflow finding: ship staging reads the newest transcript and its saved state goes stale when several sessions
   ship; every fixer worked around it with --transcript and --version. A tooling task.

## For the release card

- A stray remote branch `mgr-chart` was pushed by mistake; deleting it was refused (nothing is deleted). It can be
  ignored or removed by Matt.
- Matt's staging record shows the evening Mac run's last run failed; look into it before live.
