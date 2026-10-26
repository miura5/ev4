# Build manager handover

The build manager rewrites this file before a chat is cleared or ends (CLAUDE.md, Roles, D-317). A new build manager
reads it right after CLAUDE.md. It holds no personal data: the repository is public.

**Managing chat:** https://claude.ai/code/session_01CWeveciiiW2pUvFQtQJ3HK (still managing as of Oct 25, 7:55 pm
Central)

## Where things stand

- Live: v4.5.6 at 10798d8 (the redesign). Nothing else has gone live.
- Staging: 0010b8a carries B-397 (OUTCOME UNKNOWN path), B-399 (D-324: the graded-work and patient-identifier checks
  removed, Matt's decision) and B-317 (staging Mac tasks on E.V. Backups/staging, D-322).
  - The staging page, system documents and every staging prompt are updated.
  - The two staging Mac tasks were re-created with Matt at the Mac: evening-mac trig_01LRaXp8yBp16n61E7sYZQoQ and
    restore-drill trig_016MfX6dcGkX1pe834pZN9kJ. The four older staging Mac tasks are disabled and listed retired.
  - Both runs are proven: runs/evening-mac-20261026-003343406 and runs/restore-drill-20261026-004037655 (890 documents,
    counts and SHA-256 match).
  - NOT GREEN yet: the pwa-staging workflow's check step failed (run 40249907424) after real staging pipeline writes and
    the UTC date roll. An agent is fixing tools/pwa-staging.mjs, pwa/seed.mjs and the workflow (B-389). Then run ship
    staging until GREEN and mark B-317, B-397 and B-399 done.
- Notes (B-396): Matt approved the design after playing it.
  - Canvas: https://claude.ai/artifact/26TPNoqZBmPkEN5SmtJF9k (AppNotes board). Independent playtest: 89/100.
  - Decisions: D-325 (scope), D-326 (conflicts become a second note), D-327 (tenet: the Notes canvas is the demo,
    superseding D-315), D-328 (Matt's OK for note text in D1, backups, the mirror and Haiku).
  - Build tasks: B-400 to B-409, all under the PWA milestone. B-401 waits on B-398 and B-399.

## Running (agents)

- B-389 check fix (pwa-staging check) with a full workflow re-run.
- B-400: Notes demo snapshot and crawl.
- B-398: canonical JSON in the Worker.

## Next

1. Get staging GREEN at the check fix's commit; mark B-317, B-397 and B-399 done.
2. Notes build in dependency order: B-401 → B-402/B-405 → B-403/B-404/B-406 → B-407/B-408 → B-409. Each task with data,
   pipeline or deploy changes gets its own fresh review.
3. The PWA cutover: B-319 (live copy, on Matt's OK), B-320 (at his Mac, with Matt present), the live safeguards. Notes
   reaches live only with or after the cutover (D-325).
4. B-391 cleanup.

## Waiting on Matt

- Nothing tonight. Later: OK for the live copy (B-319), the cutover at his Mac (B-320), and each live release on his
  word.

## For the release card

- B-399's second review found two small gaps; both were fixed in a later commit that was not reviewed again.
- A stray remote branch `mgr-chart` can be ignored or removed by Matt.
