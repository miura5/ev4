# Build manager handover

Current state only, rewritten and pushed at every state change (ev-build-manager skill, The handover). No personal data:
the repository is public.

## Running

nothing

## Waiting on Matt

The cleanup release card (Oct 31): https://claude.ai/artifact/1BF1CgVSw8b6NN4aHj7ti4. Staging v4.5.21+184 at 92781b3 is
GREEN and the real jobs run passed. Live waits on his word ("ship 92781b3", or a bare "ship"). After live GREEN, mark
done the tasks that rode in it (the built-and-waiting list in BACKLOG: B-509 to B-513, B-546, B-548, B-549, B-552 to
B-561, B-576, B-578, B-582, B-585, B-593 to B-596, B-599 to B-602, B-604, B-607, B-609, B-611 to B-613, B-621, B-490).
B-515 stays open: its last step is the remaining ~180 `!important`s (merged from B-610). B-251 and B-307 also wait on him
(keep or drop), raised only if he asks.

## Next

1. Until Monday evening (his usage reset): only his bug reports and tweaks, one builder at a time; no backlog batches.
2. Monday evening, when he says to resume: the six workflow gaps in order, B-614 (vocabulary), B-615 (one write path),
   B-616 (behaviour kit), B-617 (jobs kit), B-618 (state-aware style diff), B-619 (add-a-feature skill). They are
   blocked, paused by Matt; unblock them with `log <id> --status open` when he resumes.
3. Then hands-off (D-410): bugs that break studying first (B-260, B-261, B-523, B-527, B-537, B-484, B-529, B-538,
   B-536, B-486), then the rest in BACKLOG order. Also queued: B-620 (tenet sweep, D-411), B-622 (UI review fixes),
   B-606 (parallel checks), B-515's last step.

## Last release

Live v4.5.21 at 7475963. Staging v4.5.21+184 at 92781b3 (GREEN Oct 31); card sent Oct 31.
