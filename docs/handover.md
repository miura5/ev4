# Build manager handover

Current state only, rewritten and pushed at every state change (ev-build-manager skill, The handover). No personal data:
the repository is public.

## Running

| Agent | Tasks | Worktree | Branch | Started |
| --- | --- | --- | --- | --- |
| nothing | | | | |

## Waiting on Matt

Card for B-654 (two-column pictures in notes, plus a fix: typing could remove a picture from a note) at 3675ed6, v4.5.27+11 on staging: https://claude.ai/artifact/8VTjRYwhuP5jFvv3GspbtS (Nov 1). He tests; "ship 3675ed6" sends it live. B-251 and B-307 (keep or drop) are raised only if he asks.

## Next

1. On Matt's ship: ship live 3675ed6 (references/ship.md, Live), then mark B-654 done.
2. Board comments not read this session (inbox prints the Claude_Docs query); read them before the next release.
3. B-655 (checks.yml install timeout/retry), B-656 and B-657 (B-653/B-654 review follow-ups), then bugs and the six workflow gaps B-614 to B-619 (blocked, paused by Matt; unblock on his go), then BACKLOG order. Follow-ups B-627 to B-635, B-637, B-642, B-643, B-650, B-652. B-649 needs the live token; low priority.

Session notes: `gh workflow run` fails here (GraphQL blocked); dispatch with `gh api -X POST repos/miura5/ev4/actions/workflows/<file>/dispatches -f ref=main -f "inputs[commit]=..."` plus the release inputs ship prints, with release as the full build name (v4.5.25+n) and release_at as the 40-character sha. Save ship's full output to a file: re-running ship after it prints calls asks for the reads again. A live deploy whose record entry was lost: `ship live --record-past` (B-641). Every ship live tags a new release, then needs one ship staging at the same commit before live goes GREEN. The live deploy waits for Matt's Approve on GitHub. The staging app is ev-staging.peppercheese1.workers.dev, signed in through the built-in browser; staging has a test note "B-654 columns test".

## Last release

Live v4.5.27 at 21c700a (GREEN Oct 31, B-653). Staging v4.5.27+11 at 3675ed6 (GREEN Nov 1, B-654). Card: https://claude.ai/artifact/8VTjRYwhuP5jFvv3GspbtS (Nov 1).
