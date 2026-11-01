# The release card

One card per release, when it is on staging, GREEN, and the end-to-end run worked:

1. **Version and commit** on staging, and that live waits on Matt's word ("ship <sha>" or his Ship it tap).
2. **What changed for him**, in plain words, by view.
3. **Side-by-side screenshots** of each changed view in desktop Chrome at 1280 (D-406; no phone shots, D-407).
4. **What was retired** (D-411), including any check retired or rewritten for a superseded rule.
5. **The end-to-end run**: what ran, how long, what it cost; and the release's usage: agents started, full-suite runs,
   staging deploys.
6. **Known differences and risks**, and the code review's verdict with its backlog lines.
7. **What to try** when he tests.

A release is ready for Matt's word when, at one commit on main, npm test and smoke are GREEN, ship staging is GREEN
and the end-to-end run worked. A red nightly is filed as a bug and never blocks a release Matt has tested.
