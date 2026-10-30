# Proofs: commands and how to read them

Read this when you reach the proofs of a task. SKILL.md's D-408 table is the rule; this is the how.

## The page

- Run the one harness group you touched, at 1280: `node tools/build.mjs`, then `EV_ONLY=<group>` with that group's
  harness (`node test/harness/<name>.cjs synthetic <shots dir>`; `docs/trim/scan/harness.md` says which covers what).
- Open the screenshots it lists with Read and look at them. A pass count does not show a cramped row or a missing
  control.
- Type and spacing judged in a browser need the real font: the sandbox blocks Google Fonts, so route Inter locally with
  `.claude/skills/ev-ux-probe/fonts/inter-route.cjs`.

## pwa/

- `npm run smoke:pwa` GREEN.
- `npm run test:run-api` when the run API (pwa/runapi.js, pwa/worker.js routes) is touched.

## Proprietary (page/ds, page/app/01-ui-*, 89-gallery-*)

- The Gallery harness: `node test/harness/components.cjs synthetic <dir>` (tap size, contrast, row height, focus, light
  and dark; D-383).
- "Nothing moved": `node tools/pixdiff.cjs [base ref] [head ref] --out <dir>`. It shoots every view in light and dark;
  0 changed pixels beyond known flakes is the proof for an invisible move. A change meant to show must show only where
  intended: look at the red diff images.

## Model path

Unit tests prove the request shape and the handling of a reply; they prove nothing about the real call (D-366,
"Run it for real first"). The real staging run is the build manager's: say in the report what to try (which course,
which ask) and what a good result looks like.
