# Proofs: commands and how to read them

Read this when you reach the proofs of a task. CLAUDE.md's Every session step 5 is the rule; this is the how.

## npm test

```
npm test > /tmp/<name>-test.log 2>&1; grep -E "^# (tests|pass|fail)" /tmp/<name>-test.log
```

- Run it in the exact tree you push, after the last rebase. It includes the Chart's lint.
- Read the total, not only `fail 0`. A count far below the last known total (about 1,000 or more on Oct 29) means the
  run was wrong, not that the change is fine: B-489's 959 came from a lost variable that ran an older tree.
- A skip names its reason (for example prettier missing before `npm ci`); CI does not skip, so fix the setup.

## The page

- Only the harness group your change touches (`EV_ONLY=<group>` where the harness has groups), alone: `node tools/build.mjs`, then
  `node test/harness/<name>.cjs synthetic <shots dir>` (run.cjs, prep.cjs, notes.cjs, views.cjs, shell.cjs, ...;
  `docs/trim/scan/harness.md` says which covers what).
- Open the screenshots the harness lists with Read and look at them. A pass count does not show a cramped row or a
  missing control.
- Type and spacing judged in a browser need the real font: the sandbox blocks Google Fonts, so route Inter locally with
  `.claude/skills/ev-ux-probe/fonts/inter-route.cjs`.
- UI polish tasks (B-539 to B-572, D-396): build through Proprietary toward the reference in `docs/design/ui-polish/`;
  a task is done when it looks right on staging at 1280; side-by-side matching and inaccuracy fixes come after release.

## pwa/

- `npm run smoke:pwa` GREEN.
- `npm run test:run-api` when the run API (pwa/runapi.js, pwa/worker.js routes) is touched.

## Proprietary (page/ds, page/app/01-ui-*, 89-gallery-*)

- The Gallery harness: `node test/harness/components.cjs synthetic <dir>` (tap size, contrast, row height, focus at 390
  and 1280, light and dark; D-383).
- "Nothing moved": `node tools/pixdiff.cjs [base ref] [head ref] --out <dir>`. It shoots every view at 390 and 1280 in
  light and dark; 0 changed pixels beyond known flakes is the proof for an invisible move. A change meant to show must
  show only where intended: look at the red diff images.

## Full suites (D-408)

Not on the shared machine. `npm test` and smoke run on GitHub on every push; the full harness suite runs on GitHub once
per batch, started by the build manager. Don't run `npm run check`, `--touched` or every harness locally, and never two
heavy runs at once. Report what you ran locally; a batch failure comes back to you with its step.

## Model path

Unit tests prove the request shape and the handling of a reply; they prove nothing about the real call (D-366,
"Run it for real first"). The real staging run is the build manager's: say in the report what to try (which course,
which ask) and what a good result looks like.
