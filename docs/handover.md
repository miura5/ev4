# Build manager handover

Current state only. Rewritten and pushed at every state change. No personal data: the repository is public.

## Running

| Agent | Tasks | Worktree | Branch | Started |
| --- | --- | --- | --- | --- |
| nothing | | | | |

## Waiting on Matt

Seven questions, none blocking:
1. Restart the paused consolidation kits B-614 to B-619?
2. His plan after Nov 23: Max or Pro (B-423)?
3. Is the Console spend limit still $5 a month (B-310)?
4. A bigger model for Go deeper, and at what cost (B-323)?
5. Save exam scores told in chat, including the dateless E1 to E3 (B-266)?
6. B-473 live: deployed bbd6d09 (v4.5.29+55) with Matt's Approve Nov 1. Live Mac tasks re-created: evening-mac trig_014osVRsNqvH86QDf9YLRxi1, restore-drill trig_01GERMdUZV6KLrrZnVQ4zPdS (old trig_01Ma8woo..., trig_018VSRmz... disabled). Staging Mac: evening-mac trig_01Ptg5qxrigzWxUvbGBGqptu, restore-drill trig_01SxjJRr1w91NtwVbLguHupa. Live cloud prompts updated by an agent. Still to do: put the live ids in spec.tasks.live (next release), finish ship live so the deploy is recorded (or ship live --record-past), Matt approves the 2 live Mac tasks' folders in the desktop app if asked.
7. Should the build manager list about 70 old build artifacts for him to delete?

## Next

Take the batch from BACKLOG.md order. B-661 first: the nightly B-412 long-note lookup check is red. Then Matt's bugs
(B-583, B-584, B-590, B-587, B-266). The rest of B-665 (repo layout steps 4 to 7: chart archive, split tools/chart.mjs,
core layering, tests and page folders) goes one step per release, between bug fixes.

## Last release

Live v4.5.29 at 0cc7c64 (GREEN Nov 1, Matt's ship: B-658). Staging v4.5.29 at 0cc7c64. Card:
https://claude.ai/artifact/55THeTxgcMWpWwLj4BinhR (Nov 1). Main has moved on with repo cleanup only (B-659 to B-665;
no app change, but the spec and build changed), so the next release carries it.
