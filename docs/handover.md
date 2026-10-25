# Build manager handover

The build manager rewrites this file before a chat is cleared or ends (CLAUDE.md, Roles, D-317). A new build manager
reads it right after CLAUDE.md. It holds no personal data: the repository is public.

**Managing chat:** https://claude.ai/code/session_01CWeveciiiW2pUvFQtQJ3HK (still managing as of Oct 25, 12:40
Central)

## Where things stand

- The redesign release is live: v4.5.6 at 10798d8, shipped on Matt's word Oct 25 (ship live GREEN; staging GREEN at
  the same commit). Release card: https://claude.ai/artifact/GTNQqa8fSzZ4V7m96uQG8A.
- The v4.5.6 tag push from this container was refused; tags.yml makes the tag on origin from the deploy.

## Running

- Nothing.

## Next

1. Watch the first live runs on v4.5.6 (morning, evening) and anything Matt reports.
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
