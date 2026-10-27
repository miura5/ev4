# Build manager handover

The build manager rewrites this file before a chat is cleared or ends (CLAUDE.md, Roles, D-317). A new build manager
reads it right after CLAUDE.md. It holds no personal data: the repository is public.

**Managing chat:** https://claude.ai/code/session_01CWeveciiiW2pUvFQtQJ3HK (still managing as of Oct 26, late night
Central). A second chat tried to take the seat on Oct 26 evening; Matt was told to leave it idle. One manager at a time.

## Where things stand (Oct 26, ~11 pm Central)

- **Cutover done (B-319, B-320).** Live is v4.5.10 at b355507 on the ev-live Worker and D1. The copy moved 701
  documents in 30 collections, counts and hashes verified. The claude.ai live page is read-only. All five cloud tasks
  run against the Worker. Old evening-mac trig_01AxnPF3iPyo2BpCQtMdAKP8 is disabled. New Mac tasks: evening-mac
  trig_01Ma8woo5ieoWM1s5KHuRpip (20:20 daily) and restore-drill trig_018VSRmz8pdNzdVSxpH42PEG (20:55 on the 1st), both on
  E.V. Backups. Proofs: evening-mac backed up 703 documents; the restore drill passed (703 match). Matt added
  ev-live and ev-live-scratch to the allowed domains.
- **The live deploy at b355507 is not in the Chart.** verify-deploy live is GREEN since de1ffb3 (unset notifications =
  server default, push on), but de1ffb3 moved the build commit, so the record waits for the next release, which records
  itself through ship live.
- **Phase 2 has begun** (D-347: at least two weeks of stability, fixes only; then the architecture review, B-415, per the
  doc Matt owns: https://claude.ai/artifact/WnTyVKBRYFdYxEyvhtvnLs; docs/review-brief.md was removed from the repo).

## Overnight wave (Oct 26-27), all on main, reviewed twice

- B-419 Week view shows added tasks; E.V. adds a task once per day (near-repeat only from her tool, same numbers).
- B-424 restore drill falls back to the newest nightly export. B-426 deploy names a push difference.
- B-425 docs-only commits keep the build commit (and credit no task). B-420 one tested release-tag step.
- B-421 Notes Undo check on the page's own clock (done after three green nightlies on GitHub).
- Open on the release card: B-419's tool answer text has no test; B-425's docs exemption is keyed on a variable name.
- Next: check --touched, ship staging, mark done, nightly at the new build commit, release card to Matt, live on his OK
  (that ship records v4.5.10's cutover too). B-424 needs a live drill firing after live.

## Waiting on Matt

- His OK for the next small release (card to come).
- Re-create the staging restore-drill Mac task with him present (its prompt predates 8d3dc1b; D-342).

## Later

- B-418 read-along, B-422 trash (consolidation), B-423 tier switch (last sprint), B-417 course.
