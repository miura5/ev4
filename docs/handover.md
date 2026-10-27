# Build manager handover

The build manager rewrites this file before a chat is cleared or ends (CLAUDE.md, Roles, D-317). A new build manager
reads it right after CLAUDE.md. It holds no personal data: the repository is public.

**Managing chat:** https://claude.ai/code/session_01CWeveciiiW2pUvFQtQJ3HK (still managing as of Oct 27, afternoon
Central). One manager at a time.

## Where things stand (Oct 27)

- Live is v4.5.11 at 94c0035 (ev-live Worker and D1), recorded GREEN.
- **Release candidate v4.5.11+18 at 74499d4 is GREEN on staging** (B-418 read-along and the Worker's Claude ceilings;
  B-428 phone composer scroll lock). Full nightly green (run 40564393339). UI review 80/100, no blocker. Release code
  review: no blocking gaps. The release card went to Matt; **live waits on his word for 74499d4**.
- Phase 2 (D-347): at least two weeks of stability, fixes only, to about Nov 9; then the architecture review (B-415) per
  the doc Matt owns: https://claude.ai/artifact/WnTyVKBRYFdYxEyvhtvnLs.

## Next (after the live ship; staging must stay at 74499d4 until then)

- B-429: claude.js body-read throw keeps the read mark; four untested paths.
- B-430: read-along's limit toast repeats about every 11 minutes.
- B-431: the UI review's five look fixes (New button edge, Back to now pill, toggle off state, exam date wrap, 1 px).
- B-421: mark done after three green nightlies (two so far: ac87cd1 and 6bb4290).
- B-424 needs a live restore-drill firing after the next live ship.
- After a week live: read GET /api/claude/usage on live to see whether read-along and chat crowd the hourly ceiling.

## Waiting on Matt

- His OK for 74499d4 live.
- Try the swipe on his iPhone after live (B-428 was proven in Chromium emulation, not iOS).
- Re-create the staging restore-drill Mac task with him present (its prompt predates 8d3dc1b; D-342).

## Later

- B-414 window, B-415 review, B-416, B-417 course, B-422 trash, B-423 tier switch.
