---
name: rollback
description: Take E.V. live back to the previous v4 live build (B-60), on Matt's explicit OK; a dry run first shows exactly what going back undoes, what it keeps and every call it makes.
---

# Roll live back to the previous v4 build (B-60, D-145)

Use this from a build chat when live has to go back. Going back is the previous live build's content restored at
main's head (a restore commit), then the normal path: `ship staging`, then `ship live --matt-ok`. It is never a
redeploy of the old commit itself: scheduled runs clone `main` only 50 commits deep (B-110), so an old commit falls out
of their reach as main moves on, and deploying main's head again would undo the rollback.

Every step that changes live needs Matt's explicit OK in the chat; R-03 (no live deploy while a study session runs)
still applies, and no date gates it (D-178 dropped the exam-week freeze). Nothing is deleted: the restore commit removes files
from the tree only (they stay in history), and the record keeps everything it holds.

## Steps

1. **Dry run.** `node tools/chart.mjs rollback live` (add `--to <sha>` for an earlier live build). It writes nothing
   and deploys nothing. It prints:
   - the build live leaves and the build it goes back to, both from `chart/deploys.json` (by default, the live build
     before the current one, the one its deploy record names as its rollback);
   - what going back undoes: the page, `system/manifest`, `system/spec` and `system/environments` (so every scheduled
     run from then on runs the older code), and the tasks it reverts;
   - what it does not undo: documents the live record holds stay as written; an applied schema bump or migration
     stays applied and its legacy copies are kept (D-145);
   - the schemas it goes back across. When there is one, the check before live is to ship staging at the restore
     commit, fire the staging evening-cloud and watchdog (the staging record is seeded from live, so it holds the same
     shapes) and read their `runs/<id>` back ok;
   - the live tasks whose prompts differ. `ship live` prints `update_trigger` for each cloud one; a Mac-bound one
     changes only from a chat linked to the Mac, with Matt present;
   - the restore commit's files: what goes back to the older build and what leaves the tree. `chart/`, `BACKLOG.md`,
     `CLAUDE.md` and `.claude/skills/` are kept as they are; the tools and tests go back with the code they import;
   - proof the restore is right: the restored tree's build has the same content hash as the older build, and its own
     `npm test` passes there (`--no-test` skips that);
   - the printed deploy calls `ship live` will make: the system documents batch and the page publish, with
     capabilities whole.
   Read all of it. If it refuses, nothing was written: report why in the task's notes.
2. **Ask Matt.** Show him the dry run's summary: what goes back, what stays, any schema crossed. Go on only on his
   explicit OK in the chat.
3. **The restore commit.** `node tools/chart.mjs rollback live --matt-ok --apply` with the session's `--trailer` lines.
   The checkout must be clean. Then `npm test` and `git push origin main`.
4. **Staging.** `node tools/chart.mjs ship staging`, making every call and read it prints, until GREEN. If a schema was
   crossed, fire the staging evening-cloud and watchdog and read their runs back before going on.
5. **Live.** `node tools/chart.mjs ship live --matt-ok`, making every call and read it prints, until GREEN. It refuses
   what `chart/rules.json` forbids (R-02 staging green with the same content, R-03 no study session running, R-04
   Matt's OK, R-06 a full check green at the commit). It records the deploy; its rollback field names the build left.
6. **Record.** `node tools/chart.mjs log decision <next id> --title "Live went back to <sha>" --why "<what went wrong>"`;
   DECISIONS.md carries it. Bringing the newer work back later is `git revert <the restore commit>`, then the normal
   path, once whatever went wrong is fixed.
