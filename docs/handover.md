# Build manager handover

Current state only, rewritten and pushed at every state change (ev-build-manager skill, The handover). No personal data:
the repository is public.

## Running

| Agent | Tasks | Worktree | Branch | Started |
| --- | --- | --- | --- | --- |
| nothing | | | | |

## Waiting on Matt

The D-416 simplify release card (Oct 31): staging v4.5.25+50 at a029f40, GREEN. Card: https://claude.ai/artifact/Ao1Q6oLTHC2hqXNZFDZurW. Live waits on "ship a029f40" or his Ship it tap. B-251 and B-307 (keep or drop) are raised only if he asks.

## Next

1. On Matt's ship: ship live a029f40 (references/ship.md, Live).
2. Then bugs and the six workflow gaps B-614 to B-619 (blocked, paused by Matt; unblock on his go), then BACKLOG order. Follow-ups B-627 to B-635, B-637, B-642, B-643, B-650, B-652. B-649 needs the live token (unused-collection counts); low priority.

Session notes: `gh workflow run` fails here (GraphQL blocked); dispatch with `gh api -X POST repos/miura5/ev4/actions/workflows/<file>/dispatches -f ref=main -f "inputs[commit]=..."` plus the release inputs ship prints, with release as the full build name (v4.5.25+n) and release_at as the 40-character sha. A live deploy whose record entry was lost: `ship live --record-past` (B-641). Every ship live tags a new release, then needs one ship staging at the same commit before live goes GREEN. The live deploy waits for Matt's Approve on GitHub. The staging app is ev-staging.peppercheese1.workers.dev, signed in through the built-in browser.

## Last release

Live v4.5.25 at 5273419 (GREEN Oct 31). Staging v4.5.25+50 at a029f40 (GREEN Oct 31, D-416 simplify). Card: https://claude.ai/artifact/Ao1Q6oLTHC2hqXNZFDZurW (Oct 31).
