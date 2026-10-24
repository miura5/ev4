# Lessons (B-262)

The stories behind CLAUDE.md's "Rules from past failures", and the lessons whose rule now lives in the tools. Moved
out of CLAUDE.md's old "Gotchas carried from v3" on Oct 24, 2026; read this when one of them bites.

## Behind the rules in CLAUDE.md

- **Code from External.** The run safety review refuses code a run fetched or unpacked itself. So runs execute the
  checkout their session started in, moved to the tag `system/manifest` names, and a pipeline prompt never adds a repo,
  clones or unpacks.
- **Scheduled tasks inherit their creator.** A task gets the repository and Mac link of the chat that created it. On
  Oct 21 three new Mac tasks listed their folders and were refused every write until Matt approved their folder access
  in the Claude desktop app. A Mac task changed in the desktop app drifts from the spec (O-5), so deploy's
  create_trigger printout names every notification channel and the folders, and the old task is disabled, never
  deleted.
- **Browser limits.** `javascript_tool` stops at 45 s and the device bridge cuts results above ~250 KB, so long browser
  work starts, polls and collects through saved files.
- **The full check is long.** On Oct 22 a builder's `timeout 900` foreground `npm run check` died at 10 minutes. The
  check stops at its first red step, which is why one harness can be retried alone.
- **Spec form.** Spec diffs and hashes churned on formatting until B-57's PostToolUse hook rewrote spec files at
  indent 1 with no trailing newline.

## Carried by the tools now

- **Artifact capabilities.** A partial `capabilities` on an Artifact publish wipes the rest; `deploy` prints it whole.
- **ArtifactData.** Every write to an existing document carries `if_version`; batches are atomic, 50 writes / 1 MiB.
  The page's `update` merges nested maps; Edits documents are replaced whole. The core write paths do this.
- **Playwright's fake clock** races its real-time sync: the harnesses use `setSystemTime` plus condition waits, not
  `clock.fastForward`.
- **The runs' shallow clone.** Scheduled runs clone `main` 50 commits deep and check out the deployed commit (B-110).
  When record commits push it out of that clone, the gate stays on the clone's head and goes on only if every file the
  manifest hashes is the same there (D-170, B-132, `tools/gate.mjs`); verify-deploy notes the distance and never reds
  on it.
- **Reading test results.** `node --test test/*.test.mjs > /tmp/t.log 2>&1; grep -E "^# (pass|fail)" /tmp/t.log`;
  never pipe node through grep inside `&&`, which hides node's exit code.
