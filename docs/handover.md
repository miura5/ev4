# Build manager handover

The build manager rewrites this file before a chat is cleared or ends (CLAUDE.md, Roles, D-317). A new build manager
reads it right after CLAUDE.md. It holds no personal data: the repository is public.

**Managing chat:** https://claude.ai/code/session_01CWeveciiiW2pUvFQtQJ3HK (still managing as of Oct 27, afternoon
Central). One manager at a time.

## Update (Oct 27, late evening)

- Live is **v4.5.13 at 6bd6483** (B-432 keyboard, B-433 tab bar and Record), recorded GREEN. Matt has not yet reported
  how it behaves on his iPhone.
- **Batch at 02066e6 is GREEN on staging with a green nightly** (B-429, B-430, B-431, B-434, B-435; UI review 80/100,
  code reviews No gaps after one fix round). Card sent; **live waits on Matt's word for 02066e6**. ship live will re-tag
  it, so re-ship staging first; R-03 via D1 sessions.
- B-435 (D-349): Claude ceilings are a D1 setting: `PUT /api/claude/limits {hour, day}` on the Worker with the run-API
  client (core/runapi-client.mjs, scratchpad live|stg/system/worker.json). Matt chose 500k/hour, 1.5M/day and will raise
  his Console spend limit. Matt wants batched releases, not tiny ones.
- Next: B-436 (UI review fixes), B-421 (three of three green nightlies now: mark done), B-424 live drill check.

## Update (Oct 27, evening)

- Live is **v4.5.12 at 74499d4** (B-418, B-428), recorded GREEN.
- **Phone fix release at 6bd6483 is GREEN on staging with a green nightly** (B-432 keyboard, B-433 installed-app tab bar
  and Record overflow; UI review 94/100, its gaps fixed). The card went to Matt; **live waits on his word for 6bd6483**.
  ship live will re-tag it v4.5.13, so re-ship staging first (as at 74499d4). R-03: read D1 sessions via the Worker.
- After live: Matt tries on his iPhone (keyboard, tab bar on E.V., Record). The tab-bar fix rests on an iOS hypothesis
  (standalone viewport shortened by the status bar when the page cannot scroll).
- Open next: B-429, B-430, B-431, B-434 (release-keyed page files), B-421 (two of three green nightlies).

## Where things stood (Oct 27, earlier)

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
