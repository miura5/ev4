# Build manager handover

Current state only, rewritten and pushed at every state change (ev-build-manager skill, The handover). No personal data:
the repository is public.

## Running

| Agent | Tasks | Worktree | Branch | Started |
| --- | --- | --- | --- | --- |
| nothing | | | | |

## Waiting on Matt

Seven questions, none blocking: restart the paused kits B-614 to B-619; his plan after Nov 23 (B-423); Console spend limit still $5 (B-310); a bigger model for Go deeper and its cost (B-323); save exam scores told in chat incl. dateless E1-E3 (B-266); a Mac sitting for B-473; whether to list ~70 old build artifacts for him to delete. B-251/B-307 only if he asks.

## Next

Clean slate Nov 1: 39 old scheduled tasks deleted (D-419), all branches but main deleted by Matt, studywatch/ and retired-system leftovers removed (B-659, B-662, B-663), backlog triaged (13 declined, 6 joined; 64 open/blocked left). Full check at 4ddcbd9 green except B-661.
1. B-661 (nightly red: B-412 long-note lookup check) first.
2. Matt's bugs: B-583, B-584, B-590, B-587, B-266.
3. Wrong/lost data, crashes, cost: B-628, B-486, B-652, B-536, B-642, B-457, B-656.
4. Probe and run bugs: B-523, B-484, B-528, B-451, B-537, B-643, B-529, B-530, B-436.
5. Cheap ops: B-268 (with B-460), B-655, B-492, B-468, B-603, B-635. Then B-515, B-516, B-415, B-649, B-535, B-69 flip, B-170 decide.

Session notes: `gh workflow run` fails here (GraphQL blocked); dispatch with `gh api -X POST repos/miura5/ev4/actions/workflows/<file>/dispatches -f ref=main -f "inputs[commit]=..."` plus the release inputs ship prints, with release as the full build name (v4.5.25+n) and release_at as the 40-character sha. Save ship's full output to a file: re-running ship after it prints calls asks for the reads again. A live deploy whose record entry was lost: `ship live --record-past` (B-641). Every ship live tags a new release, then needs one ship staging at the same commit before live goes GREEN. The live deploy waits for Matt's Approve on GitHub. The staging app is ev-staging.peppercheese1.workers.dev, signed in through the built-in browser; staging has a test note "B-654 columns test".

Session notes add: Nov 1, B-659 removed studywatch/ from the repo; B-660 deleted 39 old scheduled tasks under D-419 (one-time exception to B-11); 15 tasks remain, all in use.

## Last release

Live v4.5.29 at 0cc7c64 (GREEN Nov 1, Matt's ship: B-658). Staging v4.5.29 at 0cc7c64. Card: https://claude.ai/artifact/55THeTxgcMWpWwLj4BinhR (Nov 1).
