# B-515 lane D2c: drop the legacy stylesheet (the last cleanup step)

Load the `ev-builder` skill first. Then read docs/design/proprietary/dryrun-report.md, cleanup-map.md and the B-515 notes in the
Chart (`node tools/chart.mjs brief --task B-515`). They list what each lane left for you.

## Goal
page/styles.css (built into `@layer legacy`) no longer exists in the built page, and nothing Matt sees changes.

## Steps
1. **Move, don't guess.** Move every remaining legacy rule into Proprietary's files, in its original source order, with
   nothing deleted blind. Rules that never matched in the synthetic crawl stay too (lane B left 296; others left more),
   because Matt may reach those states.
   - Owned rules go to their view or pattern file.
   - Shared or uncertain rules go to `page/ds/views/legacy-carry.css`, the last file in the views layer, kept in source
     order. It is listed for consolidation to retire, and it counts against no budget.
   - Then delete only rules that a broader crawl shows are truly dead. That crawl covers more states: an active session,
     a skills run, read-only mode, larger text, the New dialog, an empty Notes list and the link popup.
2. **Duplicates kept on purpose** (D1a, D2a): #p-ev, .hero, #ev-send, the composer button and textarea, svg sizes,
   .cap-now, `[data-readonly] #composer,#new-wrap` (test/pwa-live.test.mjs pins it, so update that test to read
   its new file), the right panel's card look, and the E-window shell rules (.top-av, .mh-her, body.captions.*,
   #p-ev). Keep the later copy.
3. **Strip `!important`** from page/ds/** wherever its legacy opponent is gone. Keep the base-layer ones ([hidden], reduced
   motion). Watch for inline JS styles winning again (the triage pick menu, B-455).
4. **Drop the legacy layer:** take page/styles.css out of the build, along with the `legacy` layer name. Keep page/styles.css
   in the repo only if a test or tool still needs it; otherwise remove it (git keeps history, D-166).
5. **Token lint (D-380):** an npm test check that view CSS holds no raw colour, font size, radius or duration outside
   page/ds/tokens.css. legacy-carry.css is exempt until consolidation, and the test names that exemption.
6. **Keep old class names in the markup.** Harnesses still select by them (see lane T's list in the Chart). This step
   removes styles, not classes.

## Proof
- `node tools/pixdiff.cjs <your start commit>` shows 0 changed pixels beyond flakes.
- npm test and smoke pass.
- **Every** harness: run, prep, notes, shell, look, frame, captions, greet, core, panel, components, views. Re-run
  captions with attention to .cap-now stacking, Back to now and the #ev-send size.
- Two things seen during earlier runs to rule in or out: run.cjs "[notice 1280] … A run was missed" (B-573, a likely
  timing flake) and a crash in study plans. If either is a real bug, say so.
- `node tools/token-audit.mjs` before and after. Report the counts.

## Context
- The tokens branch (`tokens`, c32fe5f) waits to merge right after you. Don't merge it yourself.
- No time-gating (D-390). Ship fast (D-396). The machine is shared, so run harnesses one at a time.
