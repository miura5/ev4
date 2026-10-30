# Lane D dry run (B-515): what breaks if legacy drops now

Base origin/main 0131130 (pixdiff built ea5d7ccb9 after a fetch). Worktree only; nothing committed.

## Counts
- **Variant A (no page/styles.css):** pixdiff 34/34 shots changed; every page grows to its full scroll height
  (1280x800 -> 1280x5983 on ev). Computed-style diff (scratchpad/csdiff.cjs, 7 states x 390/1280): 355 element
  signatures change. Harnesses: captions 10 fail/10 pass, run 4/80, notes 22/173, prep 24/273, shell 38/53, look 17/207.
- **Variant B (legacy kept, every !important stripped from page/ds):** pixdiff 20/34 changed, all in Study (objectives,
  weak, review), Progress, System; ev, today, record, notes are 0. 121 signatures change; none in the E window or shell
  except one greet-bubble opacity (motion flake). So the moved !important rules that still lean on layer order are lane B/C
  territory (runner 80, plan-card 141, study 104, progress 62, record 50, notes 47, sessions 46, triage 35, cards 29),
  not lane D's. The components' 18 are all [data-state] Gallery forcings or line/fold/card ones and moved no pixel.

## Root causes (ranked by how bad they look)
1. **The whole shell is unstyled** (shell.cjs 38 fails: no tab bar, no sidebar, no details panel at any width; .wrap is
   static so the page scrolls as a document; composer off-screen at every size, look.cjs). Legacy: `.side/#top`, `.tabs`,
   `.tab`, `.mh`, `.mh-title`, `.new-wrap`, `.wrap`, `.cols/.col-main/.col-side`, `.sbar*`, the `@media` pane blocks at
   1513-1524 and 1812-1821 (`.wrap{position:fixed;top:calc(8px + var(--mh-h) + var(--line-h))...}`), `:root{--line-h:0px}`.
   Fix: new patterns/shell.css (layout, panes, tabs, header, status band); `--mh-h/--strip-h/--pane-l/-r/--status-h` into
   tokens.css; rename `--line-h` -> `--status-h` in 90-render.js:230/235 and the 6 legacy uses (1207, 1295, 1524, 1656,
   1690, 1821) in the same commit.
2. **SVG icons render at intrinsic size** (giant icons; 462 svg.ico + 224 bare svg + .sicon/.chev). Legacy:
   `.ico`, `button.btn svg` (854), `.tab svg`, etc. Fix: base.css `svg{width:1em;height:1em}`-style default plus an Icon
   rule in components (size by token), so no view needs its own.
3. **Form controls fall back to Arial and UA chrome** (look.cjs "Inter is the computed font" fails; 445 bare buttons).
   Legacy 99-112 `button,.btn{font:...;border-radius:999px;min-height:40px...}`, `button:hover`, `:disabled`,
   `:focus-visible`. Fix: base.css `button,input,select,textarea{font:inherit;color:inherit}` + focus ring + disabled;
   the pill look (40 px, 999px) goes to 01-button only where data-ui='button'; delete the global `button{}` styling.
4. **Kit components don't apply: markup has no data-ui.** `class="btn|seg|card|chip|ico"` appears 13/10/12/1/6 times in
   page source with 0 static data-ui (01-ui.js sets it at runtime only for what it builds). Components key on
   `[data-ui]`/`[data-tone]`, so `.btn.ghost.sm` (364), `.btn.neutral.sm` (310), `.btn.icon.sm` (168), `.seg.theme-seg`,
   `.card` lose padding/height/gap. Legacy 851-867 `button.btn*`, `.seg*`, `.card`, `.li*`. Fix: put data-ui/data-kind on
   every kit element in index.src.html and page/app (60-75, 90, 02) first, then delete the legacy kit rules.
5. **Tone colours vanish**: `.x-yellow/.x-violet/.x-blue` (legacy 851) set `--x`; components read `[data-tone]`. 280
   `i.dot.x-yellow`, 175 `.badge.x-violet`, `.sdot` lose fill. Fix: either map the classes to data-tone in markup or fold
   the `.x-*` line into 01-button's tone block (one line, token-only).
6. **E window collapses** (captions.cjs 10 fails): flower 358 px instead of 104 (`.fl.dial`, `.ev-av`, stage sizes);
   no thread scroll / Back to now (`#thread`, `.msg`, `.bubble`, `body.captions .msg.ev(.current) .bubble` 310-313,
   764-765, `body.opening .msg.greet` 190-191); his line not right-aligned (`.msg.me`); quick-ask row/pills (`.qchips`);
   run.cjs: running-job line height, tick-in-card keeps scroll (`.surf`, `.ckin`, `.energy button` 202, `.compose-row`
   217). Fix: views/ev.css (stage, thread, composer), patterns/thread.css (msg/bubble/captions states), cards.css and
   sessions.css for `.surf/.ckin/.st-row/.st/.sn/.stt` session rows. Note 2 copies of the captions sizes (310-311 vs
   764-765): keep only the later one.
7. **Tick and line rows** (prep.cjs 24 fails: tick 13 px not 16/18, ticked not green, Start shown on phone rows):
   legacy `input.tick`, `#today-list .li .nm` 964, `.hov` visibility. 05-line.css already has the !important replacements;
   they need the legacy `.tick` base (size, appearance, checked fill) moved into components/13-choice.css. Today is lane
   B's, but the tick is kit: own it in D.
8. **Side panels / record rows / notes** (notes.cjs 22 fails, `.rec-li`, `.prop`, `.n-row`, `.si`): mostly lane C's
   views; re-run after C lands before counting them as D's.
9. **New dialog**: not exercised by csdiff (selector missed); legacy 1073-1105 (V3-new+U1, 11 rules hit in crawl) still
   own it. Fold into components/10-sheet.css + 11-popover.css; check with frame.cjs.
10. **Larger text / read-only**: not separately shot; every size in legacy uses `calc(Npx * var(--ts))`, so they come
    along if folded with `--fs-*` tokens. The lint should flag any raw `px` font size left.

## Where legacy still lives (cleanup-map appendix, rules by area, crawl-hit / not)
single U1 115/72, single E1 48/45, single E2 15/92, single E3 12/43, shared kit+E1 20/53, shared 3+ areas 113/79,
base 38/5, dead 24. The "not hit" rules (mostly E2/E3 and shared) are candidates to delete outright after one grep.

## Screenshots worth a look
- scratchpad/pdA/head/ev-1280-light.png and today-1280-light.png (shell gone, giant icons); crops at
  scratchpad/crop-head-ev-1280-light.png vs crop-base-ev-1280-light.png.
- scratchpad/pdA/diff/ev-390-light.png (E window at phone).
- scratchpad/pdB/diff/study-review-390-light.png, progress-readiness-1280-dark.png (variant B: where !important still matters).
- Harness shots: scratchpad/hA/{captions,shell,prep,look}/.
- Raw data: scratchpad/csA.tsv, csB.tsv (signature, count, where, props), pdA.log, pdB.log, hA/*.log.

## Suggested order
- **D0 (do first, tiny, unblocks all):** base.css form-control font inherit, focus, disabled; svg default size;
  `.x-*` -> tone. Pixdiff 0 with legacy on (they lose to legacy), and they remove causes 2, 3, 5.
- **D1 (E window):** data-ui on 60-75 markup; views/ev.css + patterns/thread.css (stage, flower sizes, captions
  states de-duplicated), sessions.css/cards.css rows; captions.cjs, run.cjs, greet.cjs green with legacy's E rules
  deleted.
- **D2a (shell):** patterns/shell.css, tokens for pane geometry, `--line-h` -> `--status-h` (90-render.js + 6 legacy
  uses); shell.cjs, frame.cjs, look composer-in-view.
- **D2b (kit + New):** data-ui everywhere a kit class is; .tick into 13-choice; delete legacy 99-112, 851-867, kit
  lines; New into sheet/popover; prep.cjs, components.cjs.
- **D2c (drop + lint):** strip remaining !important (variant B shows only B/C views move, so after B and C land), drop
  legacy from build.mjs/LAYER_ORDER, add token-audit; re-run pixdiff and the six harnesses.
