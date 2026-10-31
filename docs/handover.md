# Build manager handover

Current state only, rewritten and pushed at every state change (ev-build-manager skill, The handover). No personal data:
the repository is public.

## Running

| Agent | Tasks | Worktree | Branch | Started |
| --- | --- | --- | --- | --- |
| builder | B-640 follow-up (npm test red: trace.test.mjs ship in a tagless fixture), then B-641 (record the missing v4.5.24 live entry; build mgr runs the printed command) | /home/claude/ev4-wt/b641 | b641 | Oct 31, this chat |

## Waiting on Matt

nothing. B-251 and B-307 (keep or drop) are raised only if he asks.

## Next

Matt's order (Oct 31), one builder at a time:
1. B-467 done (245ea9e, nightly 41192946490 green).
2. B-640 pushed (1ac9ecd) but broke npm test; fix running. B-641: deploys.json has no live entry for 50767d3 (pwa-live 41191526407 succeeded), so tags v4.5.23/24 never made. Fix before any ship live.
3. B-606 parallel checks (faster full suite).
4. B-638 notes-check polish (text-box card for every open-ended check, submit returns on its own, a reminder when he answers in chat).
5. D-416 simplify release (B-636): inventory with live usage, spikes, removal lanes, full check, staging, e2e, card.
6. Then bugs and the six workflow gaps B-614 to B-619 (blocked, paused by Matt; unblock on his go), then BACKLOG order. Follow-ups B-627 to B-635, B-637.

Session notes: `gh workflow run` fails here (GraphQL blocked); dispatch with `gh api -X POST repos/miura5/ev4/actions/workflows/<file>/dispatches -f ref=main -f "inputs[commit]=..."` plus the release inputs ship prints. Every ship live tags a new release, then needs one ship staging at the same commit before live goes GREEN. The live deploy waits for Matt's Approve on GitHub.

## Last release

Live 50767d3 (deployed Oct 31, Matt's ship; called v4.5.24, but its record entry and tag are missing, B-641): B-260, B-261, B-527, B-623, B-624, B-625, B-626, B-639. Staging v4.5.24
at 50767d3. Card: https://claude.ai/artifact/TTeNT57Ym7M7WfgKoAu1hv (its commit 5bf4e8d plus B-624 and B-639).
