# Build manager handover

Current state only, rewritten and pushed at every state change (ev-build-manager skill, The handover). No personal data:
the repository is public.

## Running

| Agent | Tasks | Worktree | Branch | Started |
| --- | --- | --- | --- | --- |
| spike (no commits) | B-624 502 on practice asks | /home/claude/ev4-wt/spike624 (if made) | none | Oct 31, ~10:40Z |

## Waiting on Matt

The release card for staging v4.5.22+56 at 5bf4e8d (Oct 31): https://claude.ai/artifact/TTeNT57Ym7M7WfgKoAu1hv.
"ship 5bf4e8d" takes it live. B-260, B-261, B-623, B-625, B-626, B-527 done; B-624 open (502 on the first practice ask).

## Next

0. First a spike on B-624's 502 (practice asks from chat; is streaming reaching the Worker; which hop times out), one builder. Then, on Matt's go (his usage resets Monday evening), the simplify release (D-416, B-636). Inventory probe with live usage counts, spikes on what breaks per feature, removal tasks (code removed; records kept, collections marked retired), lanes 2 to 4 by file ownership, full GitHub check, staging, e2e, card. Paused workflow gaps B-614 to B-619 wait behind it.
1. Staging GREEN at 87561b9. E2E: B-625, B-261, B-527 pass; B-260 not visible on a Saturday (core test). After the fix round: ship staging once more, re-check only the four failed items, then the card. Review backlog filed B-627 to B-635.
   D-414 recorded for B-260. Builder what-ifs to file: Off day vs a Study day word; an exam today but over reads
   upcoming till midnight; quizCardFor and in-chat quiz text lack 'again'; deriveExams lacks past-means-done;
   conversation.mjs Quizlet weekday list separate from classWeekdays; lint 'record the score' on past exams.
2. Until Monday evening (his usage reset): only his bug reports and tweaks, one builder at a time.
3. Monday evening, when he says to resume: the six workflow gaps in order, B-614 (vocabulary), B-615 (one write path),
   B-616 (behaviour kit), B-617 (jobs kit), B-618 (state-aware style diff), B-619 (add-a-feature skill). They are
   blocked, paused by Matt; unblock them with `log <id> --status open` when he resumes.
4. Then hands-off (D-410): bugs that break studying first (B-523, B-537, B-484, B-529, B-538, B-536, B-486), then the
   rest in BACKLOG order. Also queued: B-620 (tenet sweep, D-411), B-622 (UI review fixes), B-606 (parallel checks;
   pull it forward if a release drags), B-515's last step, B-468 (brief reads health through the Worker; live health
   read through the Worker on Oct 31 was fresh and clean).

## Last release

Live v4.5.22 at 92781b3 (GREEN Oct 31, Matt's ship); staging v4.5.22+56 at 5bf4e8d (GREEN Oct 31; card sent Oct 31). A shallow clone lacks tags and builds a wrong version: fetch --tags before ship staging. Card:
https://claude.ai/artifact/1BF1CgVSw8b6NN4aHj7ti4. B-515 stays open for the last ~180 `!important`s.
