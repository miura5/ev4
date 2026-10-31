# Build manager handover

Current state only, rewritten and pushed at every state change (ev-build-manager skill, The handover). No personal data:
the repository is public.

## Running

| Agent | Tasks | Worktree | Branch | Started |
| --- | --- | --- | --- | --- |
| builder | review blockers: B-638 card answer lost while E.V. replies (popSend/checkSend), B-606 checks.yml shell injection | /home/claude/ev4-wt/fix638 | fix638 | Oct 31, this chat |

## Waiting on Matt

How to do B-638's real staging run (token refused to agents). B-251 and B-307 (keep or drop) are raised only if he asks.

## Next

Matt's order (Oct 31), one builder at a time:
1. B-606 done (checks.yml, ~6 min full check; dispatch via REST with inputs[ref]).
2. B-638 on staging GREEN at eec200f (v4.5.24+31); review found 2 blockers (fix running, then re-ship staging once). E2E blocked: the staging app needs Matt's token and the permission system refused reading it; asked Matt how to run it. Notes-check polish (text-box card for every open-ended check, submit returns on its own, a reminder when he answers in chat).
3. D-416 simplify release (B-636): inventory with live usage, spikes, removal lanes, full check, staging, e2e, card.
4. Then bugs and the six workflow gaps B-614 to B-619 (blocked, paused by Matt; unblock on his go), then BACKLOG order. Follow-ups B-627 to B-635, B-637.

Session notes: `gh workflow run` fails here (GraphQL blocked); dispatch with `gh api -X POST repos/miura5/ev4/actions/workflows/<file>/dispatches -f ref=main -f "inputs[commit]=..."` plus the release inputs ship prints. A live deploy whose record entry was lost: `ship live --record-past` (B-641). Every ship live tags a new release, then needs one ship staging at the same commit before live goes GREEN. The live deploy waits for Matt's Approve on GitHub.

## Last release

Live v4.5.24 at 50767d3 (GREEN Oct 31, Matt's ship; record entry and tag backfilled by B-641): B-260, B-261, B-527, B-623, B-624, B-625, B-626, B-639. Staging v4.5.24+31 at eec200f (GREEN Oct 31; B-467, B-606, B-638, B-640, B-641; card not sent yet). Card: https://claude.ai/artifact/TTeNT57Ym7M7WfgKoAu1hv (its commit 5bf4e8d plus B-624 and B-639).
