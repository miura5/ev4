# Build manager handover

Current state only, rewritten and pushed at every state change (ev-build-manager skill, The handover). No personal data:
the repository is public.

## Running

| Agent | Tasks | Worktree | Branch | Started |
| --- | --- | --- | --- | --- |
| Builder: flashcards persona fix | B-651 | .claude/worktrees/agent-a91f7bf10b39949a5 | worktree-agent-a91f7bf10b39949a5 | Oct 31 |

## Waiting on Matt

nothing. B-251 and B-307 (keep or drop) are raised only if he asks.

## Next

Matt's order (Oct 31), one builder at a time:
1. D-416 simplify release: inventory done (B-636). B-644 to B-646 done on main (2628796c). B-647 done (79c12f03). Full check GREEN; staging GREEN v4.5.25+39 at 79c12f0. E2E: check-in OK; asking for flashcards still starts a general background job (B-651 building). Review: no blockers; backlog B-652. Then re-ship staging once, re-run the ask, card. B-648 closeout and full check, staging, e2e, card. B-649 needs the live token (counts); low priority.
2. Then bugs and the six workflow gaps B-614 to B-619 (blocked, paused by Matt; unblock on his go), then BACKLOG order. Follow-ups B-627 to B-635, B-637, B-642, B-643.

Session notes: `gh workflow run` fails here (GraphQL blocked); dispatch with `gh api -X POST repos/miura5/ev4/actions/workflows/<file>/dispatches -f ref=main -f "inputs[commit]=..."` plus the release inputs ship prints. A live deploy whose record entry was lost: `ship live --record-past` (B-641). Every ship live tags a new release, then needs one ship staging at the same commit before live goes GREEN. The live deploy waits for Matt's Approve on GitHub.

## Last release

Live v4.5.25 at 5273419 (GREEN Oct 31, Matt's ship): B-467, B-606, B-638, B-640, B-641. Staging v4.5.25 at 5273419. Card: https://claude.ai/artifact/7PjLR5W68KcuLBYUZyLfPN (Oct 31).
