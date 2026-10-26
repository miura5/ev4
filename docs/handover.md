# Build manager handover

The build manager rewrites this file before a chat is cleared or ends (CLAUDE.md, Roles, D-317). A new build manager
reads it right after CLAUDE.md. It holds no personal data: the repository is public.

**Managing chat:** https://claude.ai/code/session_01CWeveciiiW2pUvFQtQJ3HK (still managing as of Oct 25, 8:35 pm Central)

## Where things stand

- Live: v4.5.6 at 10798d8. Nothing else live.
- Staging GREEN at 4ed5d54 (Oct 26 01:30Z): B-317, B-389, B-397, B-398, B-399 done. Staging Mac tasks: evening-mac
  trig_01LRaXp8yBp16n61E7sYZQoQ, restore-drill trig_016MfX6dcGkX1pe834pZN9kJ (both proven with Matt present).
- Ship staging runs from a clean worktree, /home/claude/ev4-ship (branch shipwt, push with `git push origin HEAD:main`),
  because builders share /home/claude/ev4. Its dist/state holds the reads; save the page read with tools/tool-result.mjs
  (--html and --declaration) before re-running ship.
- Notes (B-396): Matt's go; canvas https://claude.ai/artifact/26TPNoqZBmPkEN5SmtJF9k (89/100). D-325 to D-329.
  Tasks B-400 (done) to B-409.

## Running (agents)

- B-320 prep: the live deploy workflow behind the GitHub "live" environment, the live registry, the read-only flag,
  the D-307 lint and docs/cutover.md. Nothing live; it reports what Matt must do.
- B-401: the notes record (schema, pipelines, mirror, backups) with staging cloud proofs; the Mac proof (evening-mac
  and restore-drill fired with Matt's Mac awake) is the build manager's.

## Next

1. B-401 → its review, the Mac proof, ship staging. Then B-402 (editor) and B-405 (L-frame strip) in parallel.
2. Cutover sitting with Matt (Monday evening estimate): B-319 live copy on his OK, B-320 at his Mac, release card.
3. B-391 cleanup (includes folding the three test D1 stand-ins).

## Waiting on Matt

- Nothing tonight. Later: OK for the live copy (B-319), the cutover at his Mac (B-320), and each live release on his
  word.

## For the release card

- B-399's second review found two small gaps; both were fixed in a later commit that was not reviewed again.
- A stray remote branch `mgr-chart` can be ignored or removed by Matt.
