# Build manager handover

Current state only, rewritten and pushed at every state change (ev-build-manager skill, The handover). No personal data:
the repository is public.

## Running

| Agent | Tasks | Worktree | Branch | Started |
| --- | --- | --- | --- | --- |
| staging check (Playwright, scratchpad e2e3) | B-624 BIO 201 practice ask at 50767d3 | none (scratchpad) | none | Oct 31, ~12:10Z |

## Waiting on Matt

Staging GREEN at 50767d3 (v4.5.23+35): 5bf4e8d's card plus B-624 (one retry on API 5xx, course on make_practice) and B-639 (sets key). Matt agreed ("sounds good") to ship this next commit once the BIO 201 check passes: confirm with him "ship 50767d3" before ship live.

## Next

Matt's order (Oct 31):
1. Tests and workflow so changes get out: B-467 (red nightly, read the failing check), the shallow-clone tag trap (fetch --tags before ship), B-606 (parallel checks).
2. B-638 notes-check polish (text-box card for every open-ended check, submit returns on its own, chat-answer reminder).
3. D-416 simplify release (B-636): inventory with live usage, spikes, removal lanes, full check, staging, card.
4. Then the bugs and the six workflow gaps B-614 to B-619 (blocked, paused; unblock on his go), then BACKLOG order. Follow-ups B-627 to B-635, B-637 filed.

## Last release

Live v4.5.22 at 92781b3 (GREEN Oct 31, Matt's ship); staging v4.5.22+56 at 5bf4e8d (GREEN Oct 31; card sent Oct 31). A shallow clone lacks tags and builds a wrong version: fetch --tags before ship staging. Card:
https://claude.ai/artifact/1BF1CgVSw8b6NN4aHj7ti4. B-515 stays open for the last ~180 `!important`s.
