# Build manager handover

Current state only, rewritten and pushed at every state change (ev-build-manager skill, The handover). No personal data:
the repository is public.

## Running

| Agent | Tasks | Worktree | Branch | Started |
| --- | --- | --- | --- | --- |
| builder | B-260, then B-261, then B-527 (one builder, in turn; all claimed in progress) | /home/claude/ev4-wt/b260 | b260-batch | Oct 31, ~07:10Z |

## Waiting on Matt

nothing. B-251 and B-307 (keep or drop) are raised only if he asks.

## Next

1. When the builder reports: GitHub full suite (`gh workflow run nightly.yml`), ship staging, one end-to-end run (a
   staging morning read back for B-260 and B-261), one code review of the release diff, the click-through, the card.
   D-414 (class weekdays in spec.study.classWeekdays) recorded for B-260.
2. Until Monday evening (his usage reset): only his bug reports and tweaks, one builder at a time.
3. Monday evening, when he says to resume: the six workflow gaps in order, B-614 (vocabulary), B-615 (one write path),
   B-616 (behaviour kit), B-617 (jobs kit), B-618 (state-aware style diff), B-619 (add-a-feature skill). They are
   blocked, paused by Matt; unblock them with `log <id> --status open` when he resumes.
4. Then hands-off (D-410): bugs that break studying first (B-523, B-537, B-484, B-529, B-538, B-536, B-486), then the
   rest in BACKLOG order. Also queued: B-620 (tenet sweep, D-411), B-622 (UI review fixes), B-606 (parallel checks;
   pull it forward if a release drags), B-515's last step, B-468 (brief reads health through the Worker; live health
   read through the Worker on Oct 31 was fresh and clean).

## Last release

Live v4.5.22 at 92781b3 (GREEN Oct 31, Matt's ship); staging v4.5.22 at 92781b3. Card:
https://claude.ai/artifact/1BF1CgVSw8b6NN4aHj7ti4. B-515 stays open for the last ~180 `!important`s.
