# Build manager handover

Current state only, rewritten and pushed at every state change (ev-build-manager skill, The handover). No personal data:
the repository is public.

## Running

| Agent | Tasks | Worktree | Branch | Started |
| --- | --- | --- | --- | --- |
| checks run 41254811107 | B-654 full check at 14854c6 | none (GitHub) | main | Nov 1 |

## Waiting on Matt

nothing. B-251 and B-307 (keep or drop) are raised only if he asks.

## Next

1. B-654 built at 3675ed6e (D-418: row/col flat-list mark; also fixes a B-653 bug where a picture was dropped on the next keystroke). Now: full check, then staging, a real run at 1280, one review, card. Was: B-654, pictures in notes part 2, the FULL columns version (Matt chose it Oct 31 over the cheaper text-wrap option): a two-column row block; drag a picture sideways onto a column grid; text types in the column beside it; headings, lists, On this page, copy and save work inside columns. Builds on B-653 (core/note-images.mjs, page/app/25-notes.js, notes schema img block). Estimate given to Matt: 1.5 to 2.5 h total, builder 45 to 90 min, likely one fix round. Then full check (watch it step by step, skill Checks), staging, a real run in a note at 1280, one review, card.
2. Bugs and the six workflow gaps B-614 to B-619 (blocked, paused by Matt; unblock on his go), then BACKLOG order. Follow-ups B-627 to B-635, B-637, B-642, B-643, B-650, B-652. B-649 needs the live token (unused-collection counts); low priority.

Session notes: `gh workflow run` fails here (GraphQL blocked); dispatch with `gh api -X POST repos/miura5/ev4/actions/workflows/<file>/dispatches -f ref=main -f "inputs[commit]=..."` plus the release inputs ship prints, with release as the full build name (v4.5.25+n) and release_at as the 40-character sha. A live deploy whose record entry was lost: `ship live --record-past` (B-641). Every ship live tags a new release, then needs one ship staging at the same commit before live goes GREEN. The live deploy waits for Matt's Approve on GitHub. The staging app is ev-staging.peppercheese1.workers.dev, signed in through the built-in browser.

## Last release

Live v4.5.27 at 21c700a (GREEN Oct 31, Matt's ship: B-653 pictures in notes part 1). Staging v4.5.27 at 21c700a. Card: https://claude.ai/artifact/Qd7dfkhJaU51kWCqMT3Rh1 (Oct 31).
