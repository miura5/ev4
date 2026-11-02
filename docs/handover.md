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
6. Approve folder access for the new live evening-mac and restore-drill tasks in the desktop app if it asks.
7. Should the build manager list about 70 old build artifacts for him to delete?

## Next

Check first: the live evening-mac run at 8:20 pm Nov 1 and evening-cloud at 8:15 pm are the first scheduled runs on the new start-up (B-473); read their runs/ entries (or brief's health) and file a bug if either failed. If evening-mac was refused writes on the Mac, Matt must approve its folder in the desktop app.

Live v4.5.31 shipped (B-661, B-669). B-678 shipped live in v4.5.32. Next batch: Matt's other bugs
(B-583, B-584, B-590, B-587, B-266). The rest of B-665 (repo layout steps 4 to 7: chart archive, split tools/chart.mjs,
core layering, tests and page folders) goes one step per release, between bug fixes. B-668 (B-473 phase 2, the last ArtifactData uses) and B-667 (ship-live edge case) are triaged.

Tip: update_trigger and create_trigger echo the whole prompt twice; give cloud prompt updates to an agent (it verifies with tools/tool-result.mjs --transcript <its own transcript>). Mac tasks are created only from a chat linked to the Mac, with Matt present.

## Last release

Live v4.5.32 at 56c8acb (GREEN Nov 1, Matt's ship: B-678 no ring on checked answer letters; v4.5.31 before it carried B-669 and B-661). Staging v4.5.31+18 at 56c8acb (card Nov 1). Card: https://claude.ai/artifact/55THeTxgcMWpWwLj4BinhR (updated in place). All 14 pipeline tasks run the new start-up; live Mac task ids are in the spec on main, carried by the next release.
