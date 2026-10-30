# Carry dry run: what it takes to retire legacy-carry.css (B-515)

Read-only map at main 7b82ee7 (Oct 30). No app code changed. The goal (Matt's): page/ds/views/legacy-carry.css is gone,
`!important` is left only where the base layer needs it ([hidden], reduced motion), and the token lint
(test/token-lint.test.mjs) reads zero raw values in every ds file.

## For Matt, in plain words

When we moved E.V. onto Proprietary, its design system, the old stylesheet couldn't all be sorted in one go. What was
left went into one holding file, legacy-carry.css, rigged to win over everything else so nothing on screen moved. That
file still holds 492 style rules, and because it wins, the newer files shout over it with about 1,900 `!important`
flags. Until it's gone, Proprietary isn't really in charge of how E.V. looks.

I loaded E.V. with its made-up practice record, at phone and laptop widths, light and dark, larger text and read-only.
I opened every tab and section and clicked every distinct control, two clicks deep on Today, Study and the E.V. window.
I also ran the 12 existing page test scripts, which do the long journeys: study sessions, skills runs, the quiz runner,
plan drafts and approvals, Notes and the link popup. For each old rule I checked two things: does it ever apply, and if
I switch it off, does anything on screen change?

What I found, in round numbers:

- **About 1 in 7 old rules can just be deleted.** 45 change nothing because Proprietary already does the same thing,
  and 25 can never apply: the thing they style no longer exists in E.V.'s code.
- **About 4 in 5 belong to a screen or a part that already has its own Proprietary file.** That's 405 rules: the E.V.
  window, Study, Today, Notes and Record take most of them. Each one moves into its file and swaps its raw sizes and
  colours for Proprietary's named values.
- **17 need something Proprietary doesn't have yet.** That's a small table (the matrix quiz question), the little week
  chart E.V. can show in the chat, and two shared animations (the rise-in and the typing dots).
- **Almost all the `!important` flags go away on their own once the holding file is gone.** Only 21 rules still fight
  something else. Each needs a small fix as it's stripped, not a redesign.

Nothing here changes what you see. Each step is checked by comparing screenshots before and after, plus the test
scripts. The risky bits are listed below: hiding the message box in read-only mode, the reduced-motion setting, and a
few screens the crawl couldn't reach on its own (48 rules, such as numeric quiz answers and the "new version" bar).

The work splits into four builder lanes. The first one goes alone and lays the groundwork, then three run side by side,
each in its own files: the E.V. window and frame, Study and Today, then Notes and Record, with the final cleanup last.
My rough estimate is half a day of builder time in total.

## How this was measured

- The carry was rebuilt with a marker on each rule (`--crn:N`, harmless custom properties) so every built rule could be
  traced to its source line. The page was the normal staging build over the synthetic record (test/harness/stub.js).
- **Crawl** (a scratch crawler, not in the repo): every tab and segment, then every distinct visible control clicked
  (deduplicated by tag, class and section). Two deep at 390 and 1280 light, one deep in dark (390, 1280), larger text
  (390, 1280), read-only (390, 1280, `data-readonly` and the banner as 04-model.js:39-45 sets them), an empty Notes list,
  no objectives or plans (390, 1280), a bare record (390, 1280), and 735.
- **Harnesses**, each run with the same probe injected into every page they open: run (sessions, quiz runner, plans:
  draft, approved, own, flashcard modes), prep, notes (empty list, link popup, history), captions, shell (larger text,
  motion setting), frame, greet, core, components, smoke, rows and look. panel produced no data. Harness pass or fail
  doesn't matter here: the probe slows them.
- **Per state, per matched rule:** (1) the computed value of every property it declares, on up to 12 matched elements
  (pseudo-elements included), with the whole carry switched off, and (2) with only that rule switched off.
  - **(a)** means neither changed anything in any state.
  - Changed only with the whole carry off means another carry rule gives the same value. That's 42 rules, counted under
    (b) with the note "redundant in carry".
  - Rules whose selector needs `:hover`, `:focus` or `:active` are matched without the pseudo-class but can't be proved
    by computed style (24). They're kept and move as (b).
- **`!important` opponents:** with the carry off, every `!important` in page/ds (except base, tokens and gallery) was made
  normal at once, and the declarations whose computed value then changed on their elements are listed.
- **Raw values:** the token lint's own rule (test/token-lint.test.mjs `RAW` over tools/token-audit.mjs), counted in
  uses.
- The scratch tools are in the build manager's scratchpad under cdr/ (mark.mjs, instr.js, imp.js, wide.cjs,
  classify.mjs). They aren't in the repo.

## 1. Summary

### Per class

| class | rules | what to do |
|---|---|---|
| (a) duplicate | 45 | Delete. Proprietary already gives the same computed result in every state reached. |
| (b) owned | 405 | Move into the named file, raw values to tokens, without `!important`. Includes 48 that the crawl never reached, 42 redundant in carry and 24 hover/focus-only. |
| (c) needs new Proprietary | 17 | Add the block first (section 2), then move. |
| (d) dead | 25 | Delete. The reason and the code citation are in the appendix. |
| **total** | **492** | 488 style rules and 4 @keyframes, in 893 source lines |

(a), by source line: 27, 32, 38, 88, 118, 119, 136, 157, 160, 161, 168, 169, 190, 192, 193, 195, 226, 233, 245, 249,
250, 253, 256, 260, 262, 313, 318, 319, 429, 473, 556, 618, 619, 645, 668, 678, 692, 758, 779, 781, 809, 823, 844, 888,
893.

(d), by source line: 35, 36, 43-47 (.stats/.stat), 50-53 (table.tbl), 58, 121, 132 (@keyframes fade), 142, 204
(@keyframes ev-side-in), 264, 327, 358, 361-363, 367, 881.

### Per destination file ((b) and (c))

| goes to | (b) owned | (c) new | of which not reached | of which redundant in carry | of which hover/focus only |
|---|---|---|---|---|---|
| views/ev.css | 151 | 0 | 18 | 15 | 8 |
| views/notes.css | 49 | 0 | 3 | 2 | 1 |
| views/study.css | 46 | 0 | 5 | 0 | 6 |
| views/record.css | 43 | 0 | 2 | 18 | 0 |
| patterns/runner.css | 38 | 0 | 5 | 1 | 2 |
| views/today.css | 23 | 0 | 2 | 2 | 5 |
| patterns/shell.css | 12 | 0 | 0 | 2 | 0 |
| components/05-line.css | 12 | 0 | 0 | 0 | 0 |
| NEW components/17-table.css | 0 | 10 | 1 | 0 | 0 |
| components/06-fold.css | 9 | 0 | 0 | 1 | 1 |
| components/12-field.css | 8 | 0 | 5 | 1 | 0 |
| base.css | 6 | 0 | 0 | 0 | 1 |
| components/14-meter.css | 6 | 0 | 2 | 0 | 0 |
| NEW components/18-chart.css | 0 | 5 | 5 | 0 | 0 |
| NEW tokens.css motion keyframes | 0 | 2 | 0 | 0 | 0 |
| components/07-card.css | 1 | 0 | 0 | 0 | 0 |
| components/09-toast.css | 1 | 0 | 0 | 0 | 0 |

The destination is set by a selector rule (classify.mjs `DEST`): the panel id, then the view's class family, then the
kit class. A lane may move a rule to a better owner inside its own files.

## 2. New tokens and blocks Proprietary needs

**Blocks (c):**

1. **Table** (new components/17-table.css): the matrix question, `table.mx` and its `.scroll` wrapper (carry 49, 90-97;
   05-question-runner.js:322-347). 10 rules. Header, cell, first and last column, right and wrong row tint, and the
   radio cell. The dead `table.tbl` (kit `table()`, never called) isn't carried over.
2. **Chart** (new components/18-chart.css, or a Meter `kind: 'bars'`): E.V.'s in-chat week chart, `.chart svg`,
   `.bar`, `.base`, `text`, `.pct` (carry 114-115; 67-ev-cards.js:660, asked for with "show my progress",
   70-ev-quick-asks.js:109). 5 rules, none reached by the crawl, so seed a chart card to prove it.
3. **Motion keyframes** in tokens.css (or base.css): `@keyframes rise` (carry 134; used by components/09-toast.css:4
   and `.rise` on new thread lines, 68-ev-thread.js:48) and `@keyframes pulse` (carry 135; the typing dots `.dots`,
   68-ev-thread.js:69, 90-render.js:690). **09-toast already depends on the carry's `rise`:** dropping the carry without
   this loses the toast's entrance.

**Tokens** (raw values in the (b) and (c) rules, by uses; every one is a lint hit once moved):

| family | raw values in the carry rules that move | proposed tokens |
|---|---|---|
| radius | 12px x14, 6px x8, 14px x6, 8px x5, 18px x4, 999px x3, 16px x3, 4px x2, 3px x2, 22px x2, 2px, 50%, 15px, 5px | Existing `--r-lg` 12, `--r-sm` 6, `--r-md` 8, `--r-xl` 16, `--r-xs` 4, `--r-pill`, `--r-round`. New: `--r-2xl` 18 (sheets, side panes), `--r-card` 22 (the right panel's card; settles the card-radius decision), `--r-hair` 2-3 (bars). Snap 14 and 15 to 16, and 5 to 4 (a look change: pixdiff it). |
| duration | .28s x10, .2s x3, .4s x3, .25s x2, .3s, .35s, 1.1s, .18s/.36s (stagger), .16s | `--dur-4` 240 or a new `--dur-pane` 280 (the E window's avatar, hero and side-pane moves, 10 uses), `--dur-fold-fade` 200, `--dur-5` 420 (for .4), `--dur-pop-in` 160. New: `--dur-pulse` 1.1s with `--stagger-dot` .18s for the typing dots. Every use goes through tokens.css's reduced-motion collapse. |
| colour | rgba(0,0,0,.6) x2, .18, .10, .05, .14 | New shadow and scrim tokens: `--scrim` (.5 to .6, also components/10-sheet.css x2 and record.css), `--shadow-1` (.05/.10), `--shadow-2` (.14/.18). Generate them in theme.js beside the colours, so dark gets its own. |
| font size | 16px x2 | New `--fs-input` 16px, the phone input size that stops iOS zooming in (carry 850). Not a scale step. |

**Outside the carry (the token lint's zero goal):** 381 raw uses remain in 25 other ds files (section 5). Most are
half-pixel font sizes (12.5, 13.5, 11.5, 14.5, 16.5) that the scale (`--fs-1` 12 to `--fs-5` 18) doesn't hold, and
radii of 7, 9 and 10. Getting to zero needs one decision: snap each to the nearest step (a small look change, proved per
file with pixdiff at its tolerance) or add `--fs-1h`-style half steps. Recommendation: snap. The token audit's budgets
(7 sizes, 7 radii) can't be met otherwise.

## 3. Risky rules

1. **Read-only hides the composer and New** (carry 723, `[data-readonly] #composer,[data-readonly] #new-wrap`):
   behaviour, not look. The crawl shows `#new-wrap` turns visible without it. Move it to patterns/shell.css and keep
   test/pwa-live.test.mjs's pin pointing at the new file. Smoke doesn't cover read-only.
2. **Reduced motion for the captions reveal and the side pane** (205 in `@media (prefers-reduced-motion)`, and
   457-458 under `:root[data-motion="reduce"]`): never matched, because under reduced motion the word reveal never runs
   (60-ev-conversation.js:73), so `.reveal .w` only exists without it. Move both selectors together to base.css, where
   `animation:none` wins. Prove it with shell.cjs's motion check and one run with the setting on.
3. **Notes hidden under 1024** (779, 781): classed (a) because the JS keeps the tab and panel `[hidden]` under 1024,
   but this is the only guard if that JS changes. Delete only together with a notes.cjs check at 735.
4. **#seg-study and the study bar's own hiding** (612, 614): `display:none` that a Segmented `display:flex` would
   otherwise beat. Move with the rule order kept: shell first, then study.
5. **Global element rules** (887-890: `a, button, input ... {touch-action}`, `cursor:pointer`, `a[href] *`): they
   apply to every control. Move them to base.css, where they lose to every component. Check that the components still
   set their own cursor.
6. **Rules the crawl never reached** (48, marked "NOT REACHED" in the appendix): numeric and matrix answers
   (`.num-*`, `table.mx` partly), the update bar (`.update`, 03-connect.js:97), the chat panel's error and list lines
   (`.chatp .mev.err`, `.mev ul`), notes' "Not saved" mark and empty-heading placeholder, the drop-to-attach highlight
   (`#p-ev.drop`, 71-ev-library.js:255), `.links`, `.pend`, `.chart`. Move them as written (tokenised). Each lane
   seeds the one state that shows its own rules before deleting the carry copy.
7. **24 hover/focus-only rules:** pixdiff never sees hover. Keep them, move them, and check by hand with a pointer at
   1280.
8. **42 "redundant in carry" rules** (mostly record.css's double `#record-sessions` / `#p-record > .panel` blocks,
   657-710, and the captions duplicates 151-162 and 311-313): each copy alone changes nothing, but both together do.
   Fold the pair into one rule in the owner file. Don't delete both.
9. **The `!important` opponents** (section 4): strip per file, never by one regex over page/ds.

## 4. `!important` in page/ds, and what still fights once the carry is gone

There are 1,894 `!important` declarations. 504 rules carrying them matched in the crawl. With the carry off and all of
them made normal at once, **only 21 rules change anything they match**. The rest have no opponent left and can be
stripped file by file. The base layer's 5 (base.css: [hidden] and reduced motion) stay.

| file | !important | rules matched in crawl | rules with a real opponent (decls) | example |
|---|---|---|---|---|
| base.css | 5 | 0 | 0 (0) |  |
| components/01-button.css | 6 | 0 | 0 (0) |  |
| components/03-chip.css | 2 | 0 | 0 (0) |  |
| components/05-line.css | 22 | 4 | 1 (30) | @(max-width: 599px) :where([data-ui="line"], .check) > input.tick :: input.tick width: 20px -> 16px  |
| components/06-fold.css | 4 | 1 | 1 (4) | @(max-width: 599px) [data-ui="fold"] > .fold-line :: button.fold-line.check-fold display: flex -> none  |
| components/07-card.css | 2 | 0 | 0 (0) |  |
| components/09-toast.css | 12 | 2 | 2 (15) | @(min-width: 1024px) .toast :: div#toast.toast transform: none -> matrix(1, 0, 0, 1, 0, 0.0509312)  |
| patterns/cards.css | 236 | 57 | 0 (0) |  |
| patterns/plan-card.css | 111 | 33 | 1 (1) | .pl-t input.tick :: input.tick margin-top: -12px -> 2px  |
| patterns/runner.css | 137 | 50 | 10 (108) | #study-side .qz-side .set-q :: button.set-q display: flex -> block  |
| patterns/sessions.css | 184 | 36 | 1 (2) | @(max-width: 1023px) body.skill-on .toast :: div#toast.toast top: 52px -> 58px  |
| patterns/shell.css | 900 | 228 | 4 (98) | .sbar :: div#sbar.sbar font-weight: 500 -> 400  |
| patterns/triage.css | 24 | 8 | 0 (0) |  |
| views/legacy-carry.css | 8 | 0 | 0 (0) |  |
| views/progress.css | 41 | 13 | 0 (0) |  |
| views/study.css | 49 | 24 | 0 (0) |  |
| views/system.css | 27 | 9 | 0 (0) |  |
| views/today.css | 124 | 39 | 1 (32) | .wchip :: button.wchip background-color: rgb(255, 255, 255) -> rgb(239, 239, 240)  |

**The 21 rules with a real opponent** (declaration and what happens on its element when it's made normal, with the
carry off):

| rule | what changes |
|---|---|
| patterns/shell.css .sbar | div#sbar.sbar font-weight: 500 -> 400 |
| patterns/shell.css .new-dlg form | form.fc-body.fc-imp row-gap: 0px -> 12px |
| patterns/shell.css @(min-width: 600px) .wrap::-webkit-scrollbar-thumb | div.wrap::-webkit-scrollbar-thumb background-color: rgb(222, 222, 225) -> rgba(0, 0, 0, 0) |
| views/today.css .wchip | button.wchip background-color: rgb(255, 255, 255) -> rgb(239, 239, 240) |
| patterns/runner.css #study-side .qz-side .set-q | button.set-q display: flex -> block |
| patterns/runner.css .set-q .sq-d | i.dot.sq-d.now background-color: rgb(124, 92, 219) -> rgb(95, 95, 102) |
| patterns/runner.css .set-q .sq-d.now | i.dot.sq-d.now background-color: rgb(124, 92, 219) -> rgb(95, 95, 102) |
| patterns/runner.css @(max-width: 599px) .ov-grid | div#ov-grid.ov-grid grid-template-columns: 1fr -> repeat(2, minmax(0px, 1fr)) |
| components/05-line.css @(max-width: 599px) :where([data-ui="line"], .check) > input.tick | input.tick width: 20px -> 16px |
| patterns/runner.css @(max-width: 599px) .ov-up .up | button.up min-height: 48px -> 0px |
| patterns/runner.css @(max-width: 599px) .ov-sets .st | button.st grid-template-columns: minmax(0px, 1fr) auto -> minmax(0px, 1fr) 96px 88px 88px |
| patterns/runner.css @(max-width: 599px) .ov-sets .sn | span.sn align-items: stretch -> baseline |
| patterns/runner.css @(max-width: 599px) .ov-sets .ss, .ov-sets .sd | span.ss.fin.x-red text-align: right -> left |
| patterns/runner.css @(max-width: 1199px) #study-side:not([hidden]) | aside#study-side.study-side display: flex -> none |
| patterns/plan-card.css .pl-t input.tick | input.tick margin-top: -12px -> 2px |
| components/09-toast.css @(max-width: 599px) .toast, body.on-ev .toast | div#toast.toast top: 52px -> 58px |
| components/06-fold.css @(max-width: 599px) [data-ui="fold"] > .fold-line | button.fold-line.check-fold display: flex -> none |
| patterns/sessions.css @(max-width: 1023px) body.skill-on .toast | div#toast.toast top: 52px -> 58px |
| components/09-toast.css @(min-width: 1024px) .toast | div#toast.toast transform: none -> matrix(1, 0, 0, 1, 0, 0.0509312) |
| patterns/shell.css .new-head | h2#ds-sheet-2.new-head.grow line-height: 20.3px -> normal |
| patterns/runner.css @(hover: hover) #study-side .qz-side .set-q:hover | button.set-q background-color: rgb(36, 36, 40) -> rgba(0, 0, 0, 0) |

How to read these:

- **Specificity inside the same layer** accounts for most of them (runner's `.ov-*` phone rules, `.set-q`, `.sq-d`,
  `.wchip`, `.sbar`, `.new-head`, `.new-dlg form`). A stronger normal rule in the same or a later layer wins once the
  `!important` is gone. Fix each by raising the selector or deleting the losing rule.
- **Component against view** (05-line's `input.tick` 20px at phone, 06-fold's fold-line at phone, 09-toast's phone
  `top`, sessions' `body.skill-on .toast`): strip the component and the view in the same commit.
- `09-toast @(min-width:1024px) .toast` transform is the toast's entrance animation mid-flight. It's a timing artefact,
  not an opponent.
- **Not verified (no crawl reached it):** `patterns/triage.css .wk-list .pick-menu{left:0!important}` against
  20-study.js's inline left (B-499), and the inline widths and heights on `.qz-bar`, `#rv-bar`, `.fc-bar i` and
  `.pc-bar>i`, which cleanup-map section 3.1 names. Stripping these turns the JS value back on. Open the triage pick
  menu at 390 before and after.

## 5. Raw values left per ds file (token lint, uses)

Outside the carry: 17 colours, 224 font sizes, 114 radii and 26 durations (381 uses). The carry itself holds 6, 2, 54
and 24, and those move with their rules (section 2).

| file | colours | font sizes | radii | durations | values |
|---|---|---|---|---|---|
| base.css | 0 | 3 | 1 | 0 | 13.5px x2, 16px, 12px |
| components/01-button.css | 0 | 3 | 3 | 0 | 14px, 13px, 12.5px, 999px, 8px, 16px |
| components/03-chip.css | 0 | 1 | 1 | 0 | 11.5px, 999px |
| components/04-segmented.css | 0 | 2 | 4 | 0 | 14px, 12px, 999px x2, 8px, 6px |
| components/05-line.css | 0 | 1 | 1 | 0 | 12.5px, 16px |
| components/06-fold.css | 0 | 0 | 0 | 2 | 0s x2 |
| components/07-card.css | 0 | 1 | 1 | 0 | 13.5px, 12px |
| components/10-sheet.css | 2 | 0 | 0 | 0 | rgba(0,0,0,.5) x2 |
| components/11-popover.css | 0 | 0 | 1 | 0 | 10px |
| components/12-field.css | 0 | 1 | 1 | 0 | 12.5px, 5px |
| components/13-choice.css | 0 | 1 | 1 | 2 | 12.5px, 7px, .2s x2 |
| components/14-meter.css | 0 | 0 | 2 | 0 | 2px, 18px |
| components/16-message.css | 0 | 1 | 0 | 0 | 12.5px |
| patterns/cards.css | 0 | 20 | 4 | 0 | 12px x4, 15px x3, 13px x3, 12.5px x3, 13.5px x2, 11px, 16.5px, 14px, 11.5px, 20px, 8px, 14px, 999px, 12px |
| patterns/plan-card.css | 0 | 19 | 3 | 0 | 12.5px x12, 13.5px x4, 16px x2, 15px, 3px x2, 10px |
| patterns/runner.css | 0 | 10 | 6 | 0 | 12.5px x7, 13.5px, 11px, 11.5px, 9px x2, 4px x2, 14px, 3px |
| patterns/sessions.css | 0 | 3 | 2 | 3 | 16px, 15px, 17px, 12px, 999px, .25s, .16s, .28s |
| patterns/shell.css | 3 | 38 | 28 | 4 | rgba(0,0,0,.14) x2, rgba(0,0,0,.5), 13px x10, 12px x8, 14px x5, 12.5px x4, 16px x3, 13.5px x3, 11.5px x2, 11px, 17px, 14.5px, 7px x6, 8px x5, 50% x4, 10px x4, … |
| patterns/triage.css | 0 | 3 | 1 | 0 | 12.5px, 13.5px, 11.5px, 4px |
| views/legacy-carry.css | 6 | 2 | 54 | 24 | rgba(0,0,0,.6) x2, rgba(0,0,0,.18), rgba(0,0,0,.10), rgba(0,0,0,.05), rgba(0,0,0,.14), 16px x2, 12px x14, 6px x8, 14px x6, 8px x5, 18px x4, 999px x3, 16px x3, … |
| views/ev.css | 9 | 23 | 13 | 14 | #000 x8, rgba(0,0,0,.18), 14px x6, 12px x4, 12.5px x3, 13px x2, 16px x2, 14.5px x2, 16.5px, 18px, 15px, 13.5px, 20px x3, 14px x2, 15px x2, 22px x2, 6px, 999px,… |
| views/notes.css | 0 | 16 | 4 | 0 | 13.5px x4, 12.5px x3, 12px x3, 13px x2, 14px x2, 15.5px, 11.5px, 9px x2, 12px, 5px |
| views/progress.css | 0 | 7 | 3 | 0 | 12.5px x4, 13.5px x2, 11.5px, 3px x2, 5px |
| views/record.css | 3 | 5 | 2 | 0 | rgba(0,0,0,.16), rgba(0,0,0,.22), rgba(0,0,0,.5), 13.5px x3, 11.5px, 15px, 10px, 12px |
| views/study.css | 0 | 25 | 9 | 1 | 12.5px x5, 12px x5, 16px x4, 15px x3, 13px x2, 17px x2, 11.5px x2, 14px, 11px, 6px x2, 5px x2, 10px x2, 12px, 4px, 2px, .2s |
| views/today.css | 0 | 41 | 23 | 0 | 13px x12, 12px x10, 12.5px x10, 15px x2, 14px x2, 11.5px x2, 18px, 13.5px, 14.5px, 4px x6, 6px x4, 8px x4, 12px x3, 10px x2, 7px, 50%, 3px, 5px |

## 6. Lane plan for the cleanup builders

Every lane works the same way: move a rule (tokenised, no `!important`), delete its carry copy, then strip the
`!important` in the files the lane owns. Proof per commit: `node tools/build.mjs && npm test && npm run smoke`, `node
tools/pixdiff.cjs <lane start>` (0 changed pixels at --tol 8, apart from intended token snaps, which the lane lists),
plus the lane's harnesses. Before deleting the carry copy of a "NOT REACHED" rule, seed its state once and look.
Lanes never reorder carry rules; the cascade inside the carry is its order.

**One shared file, made unshared first.** The carry is the one file every lane would touch. Lane 1 ends by splitting
what's left of it into three lane-owned carry files, each built through tools/carry.mjs exactly as now and kept in
source order: views/carry-ev.css, views/carry-study.css and views/carry-notes.css (build.mjs `CARRY` becomes a list).
Lane 1 proves the split with pixdiff and the harnesses (any rules from two lanes that fight over one element show up
there; keep those in the earlier file's order). After that, no two lanes edit the same file.

| order | lane | owns (no other lane edits these) | carry rules | `!important` to strip | proof |
|---|---|---|---|---|---|
| 1 (first, alone) | **Foundation and kit** | tokens.css, base.css, components/* (01-16, new 17-table, 18-chart), page/theme.js (scrim and shadow tokens), tools/build.mjs, tools/carry.mjs, test/token-lint.test.mjs | deletes the 45 (a) and 25 (d); moves base 6, components 47 (Line 12, Fold 9, Meter 6, Field 8, Card 1, Toast 1, Table 10) and Chart 5; keyframes rise and pulse; then the three-way split | components 38 (only 05-line, 06-fold and 09-toast have opponents) | pixdiff, components, look, shell (larger text, motion), the toast entrance |
| 2 (after 1, in parallel with 3) | **E window and frame** | views/ev.css, patterns/shell.css, patterns/sessions.css, views/system.css, views/carry-ev.css, test/pwa-live.test.mjs | ev 151 and shell 12 (163, of which 18 not reached, 8 hover-only) | shell 900, sessions 184, system 27 (opponents: `.sbar`, `.new-head`, `.new-dlg form`, the scrollbar thumb, `body.skill-on .toast`) | pixdiff, captions, greet, frame, core, run (sessions, skills), the read-only check (risk 1), reduced motion (risk 2) |
| 3 (after 1, in parallel with 2) | **Study and Today** | views/study.css, patterns/runner.css, patterns/plan-card.css, patterns/triage.css, patterns/cards.css, views/today.css, views/progress.css, views/carry-study.css | study 46, runner 38, today 23 (107, of which 12 not reached) | runner 137, plan-card 111, triage 24, cards 236, today 124, study 49, progress 41 (opponents: runner's 10, `.pl-t input.tick`, `.wchip`, plus the triage pick menu) | pixdiff, prep, run (quiz runner, numeric and matrix questions, plans draft, approved and own, flashcards), rows, views |
| 4 (last) | **Notes, Record and the end** | views/notes.css, views/record.css, views/carry-notes.css; at the end, after 2 and 3 have merged: tools/build.mjs, tools/carry.mjs, test/token-lint.test.mjs (handed over from lane 1) | notes 49, record 42 (91; fold record's 18 redundant pairs) | none left in notes or record | pixdiff, notes (empty list, link popup, versions at 735 for risk 3), the record filters; then remove the carry files and tools/carry.mjs, drop `CARRY` from build.mjs and `EXEMPT`, and set every `LEFT` to zero |

The token-lint zero for files outside the carry (section 5) goes to whichever lane owns the file, in the same commits.
Lane 1 decides the snap-or-half-step question (section 2) before lanes 2 and 3 start, so they all tokenise the same
way. Rough size: lane 1 about 2 h, lanes 2 and 3 about 2 to 3 h each in parallel, lane 4 about 1.5 h.

## Appendix: every carry rule

Line is the source line in page/ds/views/legacy-carry.css at 7b82ee7. "Matched" counts distinct states (width band,
scheme, view, body classes and the crawl step) and lists the bands and views. "Evidence" for (b) is the first change
seen with the rule off. "raw" lists the values the token lint will flag once the rule moves.

| line | selector | class | goes to | matched | evidence |
|---|---|---|---|---|---|
| 10 | `.sr` | b | base.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on h1#page-title.sr, div#ev-say.sr | changes h1#page-title.sr position: absolute -> static |
| 12 | `.top-av` | b | patterns/shell.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on span#top-av.top-av | changes span#top-av.top-av display: grid -> inline raw: .28s |
| 13 | `body.on-ev.opening .top-av,body.on-ev.in-session .top-av,body.on-ev.core-big .top-av` | b | patterns/shell.css | 414 states; phone/wide/mid; ev on span#top-av.top-av | redundant with another carry rule (no change alone, changes with the whole carry gone): fold into the rule that wins when moving |
| 17 | `.panel .card` | b | components/07-card.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on div#ev-dates.card.ev-dates.rest, div#today-list.card | changes div#ev-dates.card.ev-dates.rest scroll-margin-top: 56px -> 0px |
| 20 | `.ptitle` | b | patterns/shell.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on h2.ptitle | changes h2.ptitle font-size: 18px -> 13.5px |
| 22 | `.panel` | b | patterns/shell.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on section#p-ev.panel, section#p-today.panel | changes section#p-ev.panel flex-direction: column -> row |
| 24 | `.big` | b | components/05-line.css | 3526 states; phone/wide/mid; ev, today, study, progress, record, notes, system on p.big.sys-lead, div.big.set-score | changes p.big.sys-lead font-weight: 600 -> 400 |
| 25 | `.list` | b | components/05-line.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on ul.list, ul.list.ti-list | changes ul.list list-style-type: none -> disc |
| 26 | `.row .grow` | b | components/05-line.css | 22 states; phone/wide; ev, study, today on div.grow | changes div.grow flex-grow: 1 -> 0 |
| 27 | `.row .title` | a | - | 15 states; phone/wide; ev, study, today on div.title | same computed result without it |
| 28 | `.row.done .title` | b | components/05-line.css | 12 states; phone/wide; ev, today on div.title | changes div.title text-decoration-color: rgba(28, 28, 31, 0.2) -> rgba(28, 28, 31, 0.18) |
| 29 | `.meta` | b | components/05-line.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on span.meta, span.meta.ov-count | changes span#more-status.meta.grow font-size: 13px -> 16px |
| 31 | `.week-item` | b | components/05-line.css | 3130 states; phone/wide/mid; ev, today, study, progress, record, notes, system on li.row.week-item | changes li.row.week-item align-items: center -> flex-start |
| 32 | `.wk-line` | a | - | 3130 states; phone/wide/mid; ev, today, study, progress, record, notes, system on button.wk-line | same computed result without it |
| 33 | `.wk-line:focus-visible,.fold-line:focus-visible` | b | components/06-fold.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on button.wk-line, button.fold-line.pm-more | state pseudo-class (hover/focus): not provable by computed style raw: 6px |
| 34 | `.ti-t,.wk-t` | b | components/05-line.css | 3130 states; phone/wide/mid; ev, today, study, progress, record, notes, system on span.wk-t, span.ti-t | changes span.wk-t flex-grow: 1 -> 0 |
| 35 | `.wk-k` | d | - | never matched | .wk-k is made by no page source (grep page/app, index.src.html) |
| 36 | `.wk-k.urgent` | d | - | never matched | .wk-k is made by no page source (grep page/app, index.src.html) |
| 37 | `.week-item .when` | b | components/05-line.css | 3130 states; phone/wide/mid; ev, today, study, progress, record, notes, system on span.when | changes span.when padding-top: 0px -> 2px |
| 38 | `.fold-line` | a | - | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on button.fold-line.pm-more, button.fold-line.pm-earlier | same computed result without it |
| 40 | `.fold-card` | b | components/06-fold.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on div#jobs-card.card.fold-card, div#cap-card.card.fold-ca… | redundant with another carry rule (no change alone, changes with the whole carry gone): fold into the rule that wins when moving |
| 40 | `.fold-card .fold-line` | b | components/06-fold.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on button#jobs-card-line.fold-line, button#cap-card-line.f… | changes button#jobs-card-line.fold-line color: rgb(236, 236, 239) -> rgb(163, 163, 171) |
| 41 | `.fold-line::after` | b | components/06-fold.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on button.fold-line.pm-more, button.fold-line.pm-earlier | changes button.fold-line.pm-more::after content: " ›" -> none |
| 41 | `.fold-line[aria-expanded=true]::after` | b | components/06-fold.css | 3529 states; phone/wide/mid; ev, today, study, progress, record, notes, system on button#pr-fold.fold-line.pr-fold, button.fold-line.sk-p… | changes button#pr-fold.fold-line.pr-fold::after content: " ⌄" -> " ›" |
| 42 | `.when` | b | components/05-line.css | 3133 states; phone/wide/mid; ev, today, study, progress, record, notes, system on span.when | changes span.when font-weight: 500 -> 400 |
| 43 | `.stats` | d | - | never matched | .stat/.stats are made by no page source; the kit stat is DS.meter kind stat (01-kit.js:34, 01-ui-14-meter.js:14) |
| 44 | `.stat` | d | - | never matched | .stat/.stats are made by no page source; the kit stat is DS.meter kind stat (01-kit.js:34, 01-ui-14-meter.js:14) raw: 18px |
| 45 | `.stat b` | d | - | never matched | .stat/.stats are made by no page source; the kit stat is DS.meter kind stat (01-kit.js:34, 01-ui-14-meter.js:14) |
| 46 | `.stat span` | d | - | never matched | .stat/.stats are made by no page source; the kit stat is DS.meter kind stat (01-kit.js:34, 01-ui-14-meter.js:14) |
| 47 | `@(max-width:420px) .stats` | d | - | never matched | .stat/.stats are made by no page source; the kit stat is DS.meter kind stat (01-kit.js:34, 01-ui-14-meter.js:14) |
| 47 | `@(max-width:420px) .stats .stat:last-child` | d | - | never matched | .stat/.stats are made by no page source; the kit stat is DS.meter kind stat (01-kit.js:34, 01-ui-14-meter.js:14) |
| 48 | `.empty` | b | components/05-line.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on button.pc-bar.empty, p.empty | changes button.pc-bar.empty color: rgb(146, 146, 154) -> rgb(236, 236, 239) |
| 49 | `.scroll` | c | NEW components/17-table.css | 1 states; phone; study on div.scroll |  |
| 50 | `table.tbl` | d | - | never matched | table.tbl is made only by kit table() (01-kit.js:35-36), which nothing calls |
| 51 | `table.tbl th` | d | - | never matched | table.tbl is made only by kit table() (01-kit.js:35-36), which nothing calls |
| 52 | `table.tbl td` | d | - | never matched | table.tbl is made only by kit table() (01-kit.js:35-36), which nothing calls |
| 53 | `table.tbl .num` | d | - | never matched | table.tbl is made only by kit table() (01-kit.js:35-36), which nothing calls |
| 54 | `.meter` | b | components/14-meter.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) raw: 4px |
| 54 | `.meter i` | b | components/14-meter.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) raw: 4px |
| 55 | `.progress` | b | components/14-meter.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on div.progress.qz-bar, div.progress | changes div.progress height: 4px -> 0px raw: 2px |
| 55 | `.progress i` | b | components/14-meter.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on i#rv-bar, i#pr-bar | changes i#rv-bar display: block -> inline raw: .2s |
| 57 | `button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,textarea:fo…` | b | base.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on button#tab-ev.tab, button#tab-today.tab | state pseudo-class (hover/focus): not provable by computed style |
| 58 | `.fields` | d | - | never matched | .fields is made by no page source |
| 59 | `.actions` | b | components/05-line.css | 27 states; phone/wide/mid; ev, study, today on div.actions, div.actions.sum-acts | changes div.actions display: flex -> block |
| 60 | `.actions .grow` | b | components/05-line.css | 6 states; phone/mid/wide; ev on span.grow.meta | changes span.grow.meta flex-grow: 1 -> 0 |
| 62 | `.actions .q-back` | b | patterns/runner.css | 3 states; phone/wide; ev, study on button.btn.ghost.sm.q-back | changes button.btn.ghost.sm.q-back margin-right: 118.828px -> 0px |
| 64 | `.stem` | b | patterns/runner.css | 3070 states; phone/wide/mid; ev, today, study, progress, record, notes, system on p.stem.q-stem, p.stem | changes p.stem.q-stem white-space-collapse: preserve -> collapse |
| 67 | `.q-tags` | b | patterns/runner.css | 13 states; phone/wide/mid; ev, today, study on p.meta.q-tags | changes p.meta.q-tags margin-bottom: 4px -> 13px |
| 68 | `.more-line` | b | patterns/runner.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on div#more-card.card.more-line | changes div#more-card.card.more-line flex-direction: row -> column |
| 69 | `#more-btn` | b | patterns/runner.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on button#more-btn.btn.primary | changes button#more-btn.btn.primary flex-shrink: 0 -> 1 |
| 70 | `.opts` | b | patterns/runner.css | 3070 states; phone/wide/mid; ev, today, study, progress, record, notes, system on fieldset.opts | changes fieldset.opts display: flex -> block |
| 71 | `.opt` | b | patterns/runner.css | 3070 states; phone/wide/mid; ev, today, study, progress, record, notes, system on label.opt, label.opt.locked.wrong | changes label.opt display: flex -> block raw: 14px .2s |
| 72 | `.opt:hover` | b | patterns/runner.css | 3066 states; phone/wide/mid; ev, today, study, progress, record, notes, system on label.opt, label.opt.locked.wrong | state pseudo-class (hover/focus): not provable by computed style |
| 73 | `.opt input` | b | patterns/runner.css | 3070 states; phone/wide/mid; ev, today, study, progress, record, notes, system on input | changes input flex-shrink: 0 -> 1 |
| 74 | `.opt.right` | b | patterns/runner.css | 18 states; phone/wide/mid; ev, today, study on label.opt.locked.right | changes label.opt.locked.right border-top-color: rgb(76, 194, 126) -> rgb(236, 236, 239) |
| 74 | `.opt.wrong` | b | patterns/runner.css | 14 states; phone/wide/mid; ev, today, study on label.opt.locked.wrong | changes label.opt.locked.wrong border-top-color: rgb(236, 106, 98) -> rgb(236, 236, 239) |
| 76 | `.num-row` | b | patterns/runner.css | 2 states; phone; study on div.num-row, div.num-row.right | changes div.num-row display: flex -> block |
| 77 | `.num-in` | b | patterns/runner.css | 2 states; phone; study on input.num-in | changes input.num-in flex-grow: 0 -> 1 raw: 12px |
| 78 | `.num-row.right .num-in` | b | patterns/runner.css | 1 states; phone; study on input.num-in | changes input.num-in border-top-color: rgb(76, 194, 126) -> rgba(236, 236, 239, 0.14) |
| 78 | `.num-row.wrong .num-in` | b | patterns/runner.css | 1 states; phone; study on input.num-in | changes input.num-in border-top-color: rgb(236, 106, 98) -> rgba(236, 236, 239, 0.14) |
| 79 | `.num-unit` | b | patterns/runner.css | 2 states; phone; study on span.num-unit | changes span.num-unit font-size: 15px -> 16px |
| 80 | `.num-answer` | b | patterns/runner.css | 1 states; phone; study on p.num-answer | changes p.num-answer font-weight: 600 -> 400 |
| 82 | `.open-in` | b | patterns/runner.css | 2 states; phone/wide; ev on textarea.open-in | changes textarea.open-in display: block -> inline-block raw: 12px |
| 83 | `.open-given` | b | patterns/runner.css | 2 states; phone/wide; ev on p.open-given | changes p.open-given margin-top: 0px -> 16px |
| 84 | `.open-points` | b | patterns/runner.css | 2 states; phone/wide; ev on ul.open-points | changes ul.open-points list-style-type: none -> disc |
| 85 | `.open-points li.hit` | b | patterns/runner.css | 2 states; phone/wide; ev on li.hit | changes li.hit color: rgb(76, 194, 126) -> rgb(236, 236, 239) |
| 85 | `.open-points li.miss` | b | patterns/runner.css | 1 states; phone; ev on li.miss | changes li.miss color: rgb(236, 106, 98) -> rgb(236, 236, 239) |
| 86 | `.open-added` | b | patterns/runner.css | 1 states; phone; ev on p.open-added | changes p.open-added margin-top: 0px -> 16px |
| 87 | `.num-steps` | b | patterns/runner.css | 1 states; phone; study on ol.num-steps | changes ol.num-steps padding-left: 20.8px -> 40px |
| 88 | `.opt.locked` | a | - | 18 states; phone/wide/mid; ev, today, study on label.opt.locked.wrong, label.opt.locked | same computed result without it |
| 89 | `.why` | b | patterns/runner.css | 18 states; phone/wide/mid; ev, notes, today, study on span.why, span.why.why-rest | changes span.why display: block -> inline |
| 90 | `table.mx` | c | NEW components/17-table.css | 1 states; phone; study on table.mx |  |
| 91 | `table.mx th` | c | NEW components/17-table.css | 1 states; phone; study on th |  |
| 92 | `table.mx th:first-child` | c | NEW components/17-table.css | 1 states; phone; study on th |  |
| 93 | `table.mx td` | c | NEW components/17-table.css | 1 states; phone; study on td |  |
| 94 | `table.mx td:first-child` | c | NEW components/17-table.css | 1 states; phone; study on td |  raw: 12px |
| 95 | `table.mx td:last-child` | c | NEW components/17-table.css | 1 states; phone; study on td |  raw: 12px |
| 96 | `table.mx tr.right td` | c | NEW components/17-table.css | 1 states; phone; study on td |  |
| 96 | `table.mx tr.wrong td` | c | NEW components/17-table.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) |
| 97 | `table.mx input` | c | NEW components/17-table.css | 1 states; phone; study on input |  |
| 98 | `.verdict` | b | patterns/runner.css | 20 states; phone/wide/mid; ev, today, study on p.verdict.no, p.verdict.q-expl.no | changes p.verdict.no font-weight: 600 -> 400 |
| 98 | `.verdict.ok` | b | patterns/runner.css | 8 states; wide/phone; ev, study, today on p.verdict.ok, p.verdict.q-expl.ok | changes p.verdict.ok color: rgb(76, 194, 126) -> rgb(236, 236, 239) |
| 98 | `.verdict.no` | b | patterns/runner.css | 15 states; phone/wide/mid; ev, today, study on p.verdict.no, p.verdict.q-expl.no | changes p.verdict.no color: rgb(236, 106, 98) -> rgb(236, 236, 239) |
| 99 | `.toast` | b | components/09-toast.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on div#toast.toast, div.toast | changes div#toast.toast position: fixed -> static raw: rgba(0,0,0,.6) 999px .35s |
| 100 | `body.on-ev .toast` | b | patterns/shell.css | 540 states; phone/wide/mid; ev on div#toast.toast, div.toast | changes div#toast.toast bottom: 150px -> 18px |
| 104 | `.hero` | b | views/ev.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on div#hero.hero | redundant with another carry rule (no change alone, changes with the whole carry gone): fold into the rule that wins when moving raw: .28s |
| 105 | `body.opening .hero,body.core-big .hero` | b | views/ev.css | 560 states; phone/wide/mid; ev, today, study, progress, record, notes, system on div#hero.hero | redundant with another carry rule (no change alone, changes with the whole carry gone): fold into the rule that wins when moving |
| 106 | `.dots` | b | views/ev.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) |
| 106 | `.dots i` | b | views/ev.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) raw: 50% 1.1s |
| 107 | `.dots i:nth-child(2)` | b | views/ev.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) raw: .18s |
| 107 | `.dots i:nth-child(3)` | b | views/ev.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) raw: .36s |
| 109 | `.ev-card` | b | views/ev.css | 25 states; phone/wide/mid; ev, notes, today, study on div.card.ev-card, div.card.ev-card.check.done | redundant with another carry rule (no change alone, changes with the whole carry gone): fold into the rule that wins when moving |
| 110 | `.ev-card .big` | b | views/ev.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) |
| 112 | `.links` | b | views/ev.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) |
| 113 | `.links a` | b | views/ev.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) |
| 114 | `.chart svg` | c | NEW components/18-chart.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) |
| 115 | `.chart .bar` | c | NEW components/18-chart.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) |
| 115 | `.chart .base` | c | NEW components/18-chart.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) |
| 115 | `.chart text` | c | NEW components/18-chart.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) |
| 115 | `.chart .pct` | c | NEW components/18-chart.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) |
| 116 | `.qchip.go svg` | b | views/ev.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) |
| 117 | `.compose-row textarea` | b | views/ev.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on textarea#ev-input | changes textarea#ev-input outline-style: none -> solid |
| 118 | `.compose-row button` | a | - | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on button#ev-send.primary, button#ev-send.primary.on | same computed result without it raw: 50% |
| 119 | `.compose-row button svg` | a | - | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on svg | same computed result without it |
| 120 | `#p-ev.drop .compose-row` | b | views/ev.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) |
| 121 | `.fine` | d | - | never matched | .fine is made by no page source |
| 124 | `.ev-card.check` | b | views/ev.css | 12 states; phone/mid/wide; ev, notes, today, study on div.card.ev-card.check.done, div.card.ev-card.check.live | redundant with another carry rule (no change alone, changes with the whole carry gone): fold into the rule that wins when moving |
| 125 | `.ev-card.check.done` | b | views/ev.css | 11 states; phone/mid/wide; ev, notes, today, study on div.card.ev-card.check.done | changes div.card.ev-card.check.done background-color: rgba(236, 236, 239, 0.04) -> rgba(0, 0, 0, … |
| 126 | `.ev-card textarea` | b | views/ev.css | 2 states; phone/wide; ev on textarea.open-in | changes textarea.open-in min-height: 72px -> 88px |
| 127 | `.pend` | b | views/ev.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) raw: 16px |
| 132 | `@keyframes fade` | d | - | never matched | no animation names it (grep page/ds, page/app) |
| 133 | `.rise` | b | base.css | 3513 states; phone/wide/mid; ev, today, study, progress, record, notes, system on div.msg.ev.greet.rise, div.msg.matt.rise.last | changes div.msg.ev.greet.rise animation-duration: 0.3s -> 0s raw: .3s |
| 134 | `@keyframes rise` | c | NEW tokens.css motion keyframes | never matched |  |
| 135 | `@keyframes pulse` | c | NEW tokens.css motion keyframes | never matched |  |
| 136 | `.update` | b | views/ev.css | 11 states; phone/wide; ev, today, study on div#ev-update.update | changes div#ev-update.update position: fixed -> static raw: rgba(0,0,0,.6) 999px |
| 136 | `.update[hidden]` | a | - | 11 states; phone/wide; ev, today, study on div#ev-update.update | same computed result without it |
| 136 | `.update span` | b | views/ev.css | 11 states; phone/wide; ev, today, study on span | changes span text-wrap-mode: nowrap -> wrap |
| 136 | `.update button` | b | views/ev.css | 11 states; phone/wide; ev, today, study on button.btn.primary | changes button.btn.primary padding-top: 6px -> 0px |
| 141 | `a.btn-link` | b | views/ev.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) raw: 999px |
| 142 | `.share-acts` | d | - | never matched | .share-acts is made by no page source |
| 143 | `.share-bar` | b | views/ev.css | 2214 states; wide/phone/mid; study, today, ev, notes, progress, record, system on div#pr-share.share-bar | changes div#pr-share.share-bar align-items: center -> normal raw: 16px |
| 144 | `.share-bar .grow` | b | views/ev.css | 1030 states; phone/wide/mid; study, ev, today, notes, progress, record, system on span.meta.grow | changes span.meta.grow flex-grow: 1 -> 0 |
| 150 | `body.captions.on-ev` | b | views/ev.css | 540 states; phone/wide/mid; ev on body.captions.on-ev.ev-booting.ev-rest-on, body.caption… | changes body.captions.on-ev.ev-booting.ev-rest-on padding-bottom: 0px -> 88px |
| 151 | `body.captions.on-ev .top-av` | b | views/ev.css | 540 states; phone/wide/mid; ev on span#top-av.top-av | redundant with another carry rule (no change alone, changes with the whole carry gone): fold into the rule that wins when moving |
| 152 | `body.captions #p-ev` | b | views/ev.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on section#p-ev.panel, section#p-ev.panel.enter | changes section#p-ev.panel display: grid -> flex |
| 154 | `body.captions #p-ev>*` | b | views/ev.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on div#hero.hero, div#thread.thread | redundant with another carry rule (no change alone, changes with the whole carry gone): fold into the rule that wins when moving |
| 156 | `@(max-height:559px) body.captions #p-ev` | b | views/ev.css | 14 states; phone; ev, today, study, progress, record, system on section#p-ev.panel | changes section#p-ev.panel min-height: 0px -> 420px |
| 157 | `body.captions #p-ev>.hero` | a | - | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on div#hero.hero | same computed result without it |
| 159 | `body.captions #p-ev>.sbar` | b | views/ev.css | 45 states; wide/phone/mid; ev on div#sbar.sbar | changes div#sbar.sbar grid-row-start: 2 -> auto |
| 160 | `body.captions #p-ev>.thread` | a | - | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on div#thread.thread | same computed result without it |
| 161 | `body.captions #p-ev>.composer` | a | - | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on div#composer.composer | same computed result without it |
| 162 | `body.captions #p-ev>#ev-side` | b | views/ev.css | 3549 states; phone/wide/mid; ev, today, study, progress, record, notes, system on aside#ev-side | redundant with another carry rule (no change alone, changes with the whole carry gone): fold into the rule that wins when moving |
| 164 | `body.captions #p-ev>#ev-side:empty` | b | views/ev.css | 419 states; phone/mid/wide; ev, today, study, notes, progress, record, system on aside#ev-side | changes aside#ev-side display: none -> flex |
| 165 | `body.captions .hero,body.captions.opening .hero,body.captions.core-big .hero` | b | views/ev.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on div#hero.hero | changes div#hero.hero max-height: none -> 0px raw: .28s |
| 166 | `body.captions .hero>.ev-av` | b | views/ev.css | 3549 states; phone/wide/mid; ev, today, study, progress, record, notes, system on span.ev-av | changes span.ev-av transition-property: opacity -> transform |
| 168 | `body.captions .cap-pull svg.r` | a | - | 3526 states; phone/wide/mid; ev, today, study, progress, record, notes, system on svg.r | same computed result without it |
| 169 | `body.captions .cap-pull .arrow svg` | a | - | 3526 states; phone/wide/mid; ev, today, study, progress, record, notes, system on svg | same computed result without it |
| 176 | `.chev` | b | components/06-fold.css | 2862 states; phone/wide/mid; ev, today, study, progress, record, notes, system on svg.chev | changes svg.chev flex-shrink: 0 -> 1 raw: .25s |
| 178 | `.sread` | b | views/ev.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on p#sread.sread | changes p#sread.sread align-items: baseline -> normal raw: 12px |
| 182 | `body.captions .w` | b | views/ev.css | 2952 states; phone/wide/mid; ev, study, today, progress, record, system, notes on span.w, span.w.on | changes span.w display: inline-block -> inline |
| 183 | `body.captions .reveal .w` | b | views/ev.css | 32 states; phone/wide/mid; ev, study, today on span.w.on, span.w | changes span.w opacity: 0 -> 1 |
| 184 | `body.captions .reveal .w.on` | b | views/ev.css | 32 states; phone/wide/mid; ev, study, today on span.w.on | changes span.w.on transition-property: opacity, filter, transform -> all raw: .4s |
| 188 | `body.captions button.cap-now` | b | views/ev.css | 3549 states; phone/wide/mid; ev, today, study, progress, record, notes, system on button#ev-now.btn.ghost.sm.cap-now | changes button#ev-now.btn.ghost.sm.cap-now font-size: 12px -> 12.5px raw: rgba(0,0,0,.18) 15px |
| 189 | `body.captions .cap-now:hover` | b | views/ev.css | 3545 states; phone/wide/mid; ev, today, study, progress, record, notes, system on button#ev-now.btn.ghost.sm.cap-now | state pseudo-class (hover/focus): not provable by computed style |
| 190 | `body.captions .cap-now svg` | a | - | 3549 states; phone/wide/mid; ev, today, study, progress, record, notes, system on svg | same computed result without it |
| 191 | `@(max-width:599px) body.captions button.cap-now` | b | views/ev.css | 1302 states; phone; ev, today, study, record, progress, system on button#ev-now.btn.ghost.sm.cap-now | changes button#ev-now.btn.ghost.sm.cap-now height: 44px -> 30px raw: 22px |
| 192 | `body.captions .cap-now[hidden]` | a | - | 3536 states; phone/wide/mid; ev, today, study, progress, record, notes, system on button#ev-now.btn.ghost.sm.cap-now | same computed result without it |
| 193 | `body:not(.on-ev) .cap-now` | a | - | 3031 states; wide/phone/mid; today, study, progress, record, notes, system on button#ev-now.btn.ghost.sm.cap-now | same computed result without it |
| 195 | `@(min-width:1024px) body.captions .hero` | a | - | 2084 states; wide; ev, today, study, progress, record, notes, system on div#hero.hero | same computed result without it |
| 204 | `@keyframes ev-side-in` | d | - | never matched | no animation names it (grep page/ds, page/app) |
| 205 | `@(prefers-reduced-motion:reduce) body.captions .reveal .w` | b | views/ev.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) |
| 205 | `@(prefers-reduced-motion:reduce) body.captions.side-on #p-ev>#ev-side` | b | views/ev.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) |
| 209 | `.surf` | b | views/ev.css | 25 states; phone/wide/mid; ev, study, today on section#ev-surf.surf, section#ev-surf.surf.folded | changes section#ev-surf.surf display: flex -> block raw: 18px |
| 210 | `.sf-top,.sf-rows` | b | views/ev.css | 25 states; phone/wide/mid; ev, study, today on div.sf-top, div.sf-rows | changes div.sf-top display: flex -> block |
| 211 | `.sf-head,.sf-row` | b | views/ev.css | 25 states; phone/wide/mid; ev, study, today on button.sf-head, button.sf-row | changes button.sf-head appearance: none -> auto |
| 212 | `.sf-row` | b | views/ev.css | 5 states; phone/wide/mid; ev on button.sf-row | changes button.sf-row min-height: 40px -> 44px |
| 213 | `.sf-head:hover,.sf-head:active,.sf-head:focus,.sf-row:hover,.sf-row:active,.sf-row:focus` | b | views/ev.css | 25 states; phone/wide/mid; ev, study, today on button.sf-head, button.sf-row | state pseudo-class (hover/focus): not provable by computed style |
| 214 | `.sf-head:focus-visible,.sf-row:focus-visible` | b | views/ev.css | 25 states; phone/wide/mid; ev, study, today on button.sf-head, button.sf-row | state pseudo-class (hover/focus): not provable by computed style |
| 215 | `.sf-t` | b | views/ev.css | 25 states; phone/wide/mid; ev, study, today on span.sf-t | changes span.sf-t flex-grow: 1 -> 0 |
| 216 | `.sf-head .chev` | b | views/ev.css | 25 states; phone/wide/mid; ev, study, today on svg.chev | changes svg.chev transform: matrix(-1, 0, 0, -1, 0, 0) -> none |
| 217 | `.surf.folded .sf-head .chev,.sf-row .chev` | b | views/ev.css | 9 states; phone/wide/mid; ev on svg.chev | changes svg.chev transform: none -> matrix(1, 0, 0, 1, 0, 0) |
| 218 | `.sf-body:empty` | b | views/ev.css | 6 states; phone/wide/mid; ev on div.sf-body | changes div.sf-body display: none -> block |
| 219 | `.sf-body` | b | views/ev.css | 25 states; phone/wide/mid; ev, study, today on div.sf-body | changes div.sf-body padding-top: 6px -> 0px |
| 220 | `.surf .ev-card` | b | views/ev.css | 19 states; phone/wide/mid; ev, study, today on div.card.ev-card, div.card.ev-card.check.done | changes div.card.ev-card border-top-left-radius: 0px -> 22px |
| 221 | `.surf .ev-card>.card-head:first-child>h2,.surf .ev-card.check>.check-head` | b | views/ev.css | 14 states; phone/wide/mid; ev, study, today on h2 | changes h2 display: none -> block |
| 222 | `.surf .ev-card>.card-head:first-child:not(:has(> :not(h2)))` | b | views/ev.css | 1 states; phone; ev on div.card-head | redundant with another carry rule (no change alone, changes with the whole carry gone): fold into the rule that wins when moving |
| 223 | `.surf .passage` | b | views/ev.css | 3 states; phone/mid/wide; ev on p.passage | changes p.passage margin-top: 2px -> 16px |
| 225 | `@(max-width:1199px) body.captions #p-ev>#ev-side` | b | views/ev.css | 1483 states; phone/wide/mid; ev, today, study, record, progress, system on aside#ev-side | changes aside#ev-side justify-self: center -> auto |
| 226 | `@(max-width:1199px) body.captions #p-ev>.composer` | a | - | 1498 states; phone/wide/mid; ev, today, study, record, progress, system on div#composer.composer | same computed result without it |
| 227 | `@(max-width:1199px) body.captions #ev-surf` | b | views/ev.css | 20 states; phone/wide/mid; ev, study, today on section#ev-surf.surf, section#ev-surf.surf.folded | changes section#ev-surf.surf overflow-y: auto -> visible raw: 18px 14px |
| 228 | `@(max-width:1199px) body.captions #ev-surf.folded` | b | views/ev.css | 4 states; phone/mid/wide; ev on section#ev-surf.surf.folded | changes section#ev-surf.surf.folded max-height: none -> 328.24px |
| 230 | `@(min-width:1200px) body.captions #ev-side` | b | views/ev.css | 2073 states; wide; ev, today, study, progress, record, notes, system on aside#ev-side | changes aside#ev-side flex-direction: column -> row |
| 233 | `body.captions #p-ev,body.captions.skill-on #p-ev` | a | - | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on section#p-ev.panel, section#p-ev.panel.enter | same computed result without it |
| 236 | `.prep-row .chev` | b | views/study.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) raw: .25s |
| 239 | `@(max-width:1023px) .ptitle` | b | patterns/shell.css | 1487 states; phone/mid; ev, today, study, record, progress, system on h2.ptitle | redundant with another carry rule (no change alone, changes with the whole carry gone): fold into the rule that wins when moving |
| 244 | `.ws-item` | b | views/study.css | 4 states; phone/wide/mid; ev on li.row.ws-item | changes li.row.ws-item flex-direction: column -> row |
| 245 | `.ws-line` | a | - | 4 states; phone/wide/mid; ev on button.ws-line | same computed result without it |
| 246 | `.ws-line:focus-visible` | b | views/study.css | 4 states; phone/wide/mid; ev on button.ws-line | state pseudo-class (hover/focus): not provable by computed style raw: 6px |
| 247 | `.ws-t` | b | views/study.css | 4 states; phone/wide/mid; ev on span.ws-t | changes span.ws-t flex-grow: 1 -> 0 |
| 248 | `.ws-n` | b | views/study.css | 4 states; phone/wide/mid; ev on span.ws-n | changes span.ws-n flex-shrink: 0 -> 1 |
| 249 | `.ws-more` | b | views/study.css | 4 states; phone/wide/mid; ev on div.ws-more | changes div.ws-more display: none -> block |
| 249 | `.ws-item.open .ws-more` | b | views/study.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) |
| 249 | `.ws-more .meta` | b | views/study.css | 4 states; phone/wide/mid; ev on p.meta | changes p.meta margin-top: 0px -> 2px |
| 249 | `.ws-more .actions` | a | - | 4 states; phone/wide/mid; ev on div.actions | same computed result without it |
| 250 | `button.tlink` | a | - | 9 states; phone/wide; ev, today, study on button.tlink.open-add, button.tlink | same computed result without it |
| 250 | `button.tlink:focus-visible` | b | views/study.css | 9 states; phone/wide; ev, today, study on button.tlink.open-add, button.tlink | state pseudo-class (hover/focus): not provable by computed style raw: 6px |
| 253 | `.set-count` | a | - | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on button#rv-count.fold-line.set-count.flat, button#pr-qco… | same computed result without it |
| 254 | `.fold-line.flat` | b | components/06-fold.css | 3070 states; phone/wide/mid; ev, today, study, progress, record, notes, system on button#rv-count.fold-line.set-count.flat, button#pr-qco… | changes button#rv-count.fold-line.set-count.flat pointer-events: none -> auto |
| 254 | `.fold-line.flat::after` | b | components/06-fold.css | 3070 states; phone/wide/mid; ev, today, study, progress, record, notes, system on button#rv-count.fold-line.set-count.flat, button#pr-qco… | changes button#rv-count.fold-line.set-count.flat::after content: "" -> " ›" |
| 255 | `.set-q:focus-visible,.sum-line:focus-visible` | b | patterns/runner.css | 209 states; phone/mid/wide; study on button.set-q, button.sum-line | state pseudo-class (hover/focus): not provable by computed style raw: 6px |
| 256 | `.sq-s.ok` | a | - | 5 states; phone/wide; study on span.sq-s.ok | same computed result without it |
| 257 | `.q-beside` | b | patterns/runner.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) |
| 258 | `.q-main` | b | patterns/runner.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) |
| 258 | `.q-set` | b | patterns/runner.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) |
| 259 | `.verdict` | b | patterns/runner.css | 20 states; phone/wide/mid; ev, today, study on p.verdict.no, p.verdict.q-expl.no | redundant with another carry rule (no change alone, changes with the whole carry gone): fold into the rule that wins when moving |
| 260 | `.why[hidden]` | a | - | 9 states; phone/wide; ev, today, study on span.why.why-rest | same computed result without it |
| 261 | `.why-fold` | b | patterns/runner.css | 9 states; phone/wide; ev, today, study on button.fold-line.why-fold | changes button.fold-line.why-fold align-self: flex-start -> auto |
| 262 | `.sum-h` | a | - | 5 states; wide/phone; study on p.meta.sum-h | same computed result without it |
| 263 | `.sum-more` | b | patterns/runner.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) |
| 263 | `.sum-more p` | b | patterns/runner.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) |
| 264 | `#more-card:not(.card)` | d | - | never matched | index.src.html:112 gives #more-card class card, so :not(.card) never matches |
| 281 | `.ptitle` | b | patterns/shell.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on h2.ptitle | changes h2.ptitle display: none -> block |
| 283 | `.side .top-av` | b | patterns/shell.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on span#top-av.top-av | changes span#top-av.top-av height: 24px -> 36px |
| 284 | `body.on-ev.opening .side .top-av,body.on-ev.in-session .side .top-av,body.on-ev.core-big …` | b | views/ev.css | 540 states; phone/wide/mid; ev on span#top-av.top-av | changes span#top-av.top-av opacity: 1 -> 0 |
| 291 | `@(max-width:599px) body.captions #ev-surf` | b | views/ev.css | 13 states; phone; ev, study, today on section#ev-surf.surf, section#ev-surf.surf.folded | changes section#ev-surf.surf max-height: 328.24px -> 388.24px |
| 311 | `body.captions .hero,body.captions.opening .hero,body.captions.core-big .hero` | b | views/ev.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on div#hero.hero | changes div#hero.hero align-items: flex-start -> center |
| 312 | `body.captions.her-folded .hero` | b | views/ev.css | 12 states; phone; ev, today, study, progress, record, system on div#hero.hero | changes div#hero.hero padding-top: 0px -> 14px |
| 313 | `body.captions .hero>.ev-av` | a | - | 3549 states; phone/wide/mid; ev, today, study, progress, record, notes, system on span.ev-av | same computed result without it |
| 314 | `.mh-her` | b | views/ev.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on button#mh-her.mh-her | changes button#mh-her.mh-her display: none -> block raw: 6px |
| 315 | `.mh-her:hover` | b | views/ev.css | 3567 states; phone/wide/mid; ev, today, study, progress, record, notes, system on button#mh-her.mh-her | state pseudo-class (hover/focus): not provable by computed style |
| 316 | `body.on-ev.her-folded .mh-her` | b | views/ev.css | 6 states; phone; ev on button#mh-her.mh-her | changes button#mh-her.mh-her display: grid -> none |
| 318 | `.compose-row #ev-send` | a | - | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on button#ev-send.primary, button#ev-send.primary.on | same computed result without it |
| 319 | `.compose-row #ev-send.on` | a | - | 917 states; phone/wide/mid; ev, study, today, record, notes, progress, system on button#ev-send.primary.on | same computed result without it |
| 327 | `.side .ev-av .under` | d | - | never matched | no element has class under (60-ev-conversation.js:419 "under" is data, not a class) |
| 339 | `@(min-width:1200px) body.captions.on-ev.side-on` | b | views/ev.css | 8 states; wide; ev on body.captions.on-ev.ev-rest-on.surface-open, body.capti… | redundant with another carry rule (no change alone, changes with the whole carry gone): fold into the rule that wins when moving |
| 340 | `@(min-width:1200px) body.captions.side-on #p-ev>#ev-side` | b | views/ev.css | 9 states; wide; ev, study on aside#ev-side | redundant with another carry rule (no change alone, changes with the whole carry gone): fold into the rule that wins when moving raw: 12px |
| 341 | `@(min-width:1200px) body.captions:not(.on-ev) #ev-side` | b | views/ev.css | 1812 states; wide; today, study, progress, record, notes, system on aside#ev-side | redundant with another carry rule (no change alone, changes with the whole carry gone): fold into the rule that wins when moving |
| 345 | `.opt input:checked~kbd.opt-n` | b | patterns/runner.css | 22 states; phone/wide/mid; ev, today, study on kbd.opt-n | changes kbd.opt-n box-shadow: rgb(163, 163, 171) 0px 0px 0px 1px inset -> none |
| 346 | `@(hover:none) .opt kbd.opt-n` | b | patterns/runner.css | 7 states; phone; ev, record, today, study, progress on kbd.opt-n | changes kbd.opt-n display: none -> block |
| 353 | `:where(#p-today,#p-study,#p-progress,#p-record,#p-system) .card` | b | views/record.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on div#today-list.card, div#today-week.card | changes div#today-list.card background-color: rgba(0, 0, 0, 0) -> rgba(236, 236, 239, 0.04) |
| 354 | `:where(#p-today,#p-study,#p-progress,#p-record,#p-system) .card>h2,:where(#p-today,#p-stu…` | b | views/record.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on h2, div.card-head | changes div.card-head font-weight: 500 -> 400 |
| 355 | `:where(#p-today,#p-study,#p-progress,#p-record,#p-system) .card>h2,:where(#p-today,#p-stu…` | b | views/record.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on h2, div.card-head | changes h2 align-items: center -> normal |
| 356 | `:where(#p-today,#p-study,#p-progress,#p-record,#p-system) .card>.card-head .meta` | b | views/record.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on span#pr-count.meta, span.meta | changes span#pr-count.meta font-size: 12px -> 13px |
| 357 | `:where(#p-today,#p-study,#p-progress,#p-record,#p-system) .row` | b | views/record.css | 3526 states; phone/wide/mid; ev, today, study, progress, record, notes, system on li.row.sys-item, li.row.set-item.current | changes li.row.sys-item min-height: 44px -> 0px |
| 358 | `:where(#p-today,#p-study,#p-progress,#p-record,#p-system) .row.week-item` | d | - | never matched | .wk-line/.week-item are made only by 70-ev-quick-asks.js:280-281, inside #ev-dates in #p-ev, never under these panels |
| 359 | `:where(#p-today,#p-study,#p-progress,#p-record,#p-system) .row .meta` | b | views/record.css | 3526 states; phone/wide/mid; ev, today, study, progress, record, notes, system on p.meta | changes p.meta font-size: 12px -> 13px |
| 360 | `:where(#p-today,#p-study,#p-progress,#p-record,#p-system) .when` | b | views/record.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) |
| 361 | `:where(#p-today,#p-study,#p-progress,#p-record,#p-system) .wk-line` | d | - | never matched | .wk-line/.week-item are made only by 70-ev-quick-asks.js:280-281, inside #ev-dates in #p-ev, never under these panels |
| 362 | `:where(#p-today,#p-study,#p-progress,#p-record,#p-system) .wk-k` | d | - | never matched | .wk-k is made by no page source (grep page/app, index.src.html) |
| 363 | `:where(#p-today,#p-study,#p-progress,#p-record,#p-system) .wk-k.urgent` | d | - | never matched | .wk-k is made by no page source (grep page/app, index.src.html) |
| 365 | `@(min-width:600px) :where(#p-today,#p-study,#p-progress,#p-record,#p-system) .row,:where(…` | b | views/record.css | 2232 states; wide/mid; ev, today, study, progress, record, notes, system on li.row.sys-item, li.row.set-item.current | changes li.row.sys-item min-height: 32px -> 44px |
| 366 | `@(min-width:600px) :where(#p-today,#p-study,#p-progress,#p-record,#p-system) .row` | b | views/record.css | 2232 states; wide/mid; ev, today, study, progress, record, notes, system on li.row.sys-item, li.row.set-item.current | changes li.row.sum-item padding-top: 4px -> 6px |
| 367 | `@(min-width:600px) :where(#p-today,#p-study,#p-progress,#p-record,#p-system) .row.week-it…` | d | - | never matched | .wk-line/.week-item are made only by 70-ev-quick-asks.js:280-281, inside #ev-dates in #p-ev, never under these panels |
| 368 | `@(min-width:600px) :where(#p-today,#p-study,#p-progress,#p-record,#p-system) input[type=t…` | b | views/record.css | 1 states; wide; study on input | changes input min-height: 32px -> 44px raw: 8px |
| 369 | `@(min-width:600px) :where(#p-today,#p-study,#p-progress,#p-record,#p-system) form button` | b | views/record.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) raw: 8px |
| 374 | `@(min-width:1200px) section.panel > .cols > .col-side .card,section.panel > .panel > .col…` | b | patterns/shell.css | 2081 states; wide; ev, today, study, progress, record, notes, system on div#weekly.card, div#jobs-card.card.fold-card | changes div#weekly.card background-color: rgb(27, 27, 30) -> rgba(0, 0, 0, 0) raw: 12px |
| 375 | `@(min-width:1200px) section.panel > .cols > .col-side .card>h2,section.panel > .panel > .…` | b | patterns/shell.css | 2081 states; wide; ev, today, study, progress, record, notes, system on h2 | changes h2 min-height: 36px -> 28px |
| 378 | `button.tlink` | b | views/study.css | 9 states; phone/wide; ev, today, study on button.tlink.open-add, button.tlink | changes button.tlink.open-add text-decoration-line: underline -> none |
| 379 | `button.tlink:hover` | b | views/study.css | 9 states; phone/wide; ev, today, study on button.tlink.open-add, button.tlink | state pseudo-class (hover/focus): not provable by computed style |
| 386 | `#ev-dates` | b | views/ev.css | 3130 states; phone/wide/mid; ev, today, study, progress, record, notes, system on div#ev-dates.card.ev-dates.rest | changes div#ev-dates.card.ev-dates.rest display: none -> flex |
| 387 | `@(max-width:1199px) body.captions:not(.side-on) #p-ev>#ev-side` | b | views/ev.css | 1463 states; phone/mid/wide; ev, today, study, record, progress, system on aside#ev-side | changes aside#ev-side display: none -> block |
| 389 | `@(min-width:1200px) body:has(#p-study:not([hidden]) > #study-side:not([hidden]))` | b | views/study.css | 581 states; wide; study on body.captions.opening.ev-rest-on.has-line, body.caption… | changes body.captions.opening.ev-rest-on.has-line --pane-r: calc(320px + 8px) -> 8px |
| 391 | `@(min-width:1200px) body.captions.on-ev.ev-rest-on` | b | views/ev.css | 226 states; wide; ev on body.captions.on-ev.ev-booting.ev-rest-on, body.caption… | changes body.captions.on-ev.ev-booting.ev-rest-on --pane-r: calc(320px + 8px) -> 8px |
| 392 | `@(min-width:1200px) body.captions.ev-rest-on #p-ev>#ev-side` | b | views/ev.css | 1822 states; wide; ev, today, study, progress, record, notes, system on aside#ev-side | changes aside#ev-side position: fixed -> static raw: 12px |
| 393 | `@(min-width:1200px) body.captions:not(.side-on) #ev-dates` | b | views/ev.css | 1813 states; wide; ev, today, study, progress, record, notes, system on div#ev-dates.card.ev-dates.rest | changes div#ev-dates.card.ev-dates.rest display: flex -> none |
| 395 | `@(min-width:1200px) #study-side .card,#ev-dates,body.captions #ev-side>.surf,body.caption…` | b | views/ev.css | 1822 states; wide; ev, today, study, progress, record, notes, system on div#ev-dates.card.ev-dates.rest, section#ev-surf.surf | changes div#ev-dates.card.ev-dates.rest border-top-left-radius: 12px -> 22px raw: 12px |
| 396 | `@(min-width:1200px) #study-side .card,#ev-dates` | b | views/ev.css | 1822 states; wide; ev, today, study, progress, record, notes, system on div#ev-dates.card.ev-dates.rest | changes div#ev-dates.card.ev-dates.rest row-gap: 0px -> 10px |
| 397 | `@(min-width:1200px) #study-side .card>h2,#ev-dates>h2` | b | views/ev.css | 1822 states; wide; ev, today, study, progress, record, notes, system on h2 | changes h2 display: flex -> block |
| 401 | `.surf .ev-card>.card-head:first-child>:is(.meta,.chip)` | b | views/ev.css | 14 states; phone/wide/mid; ev, study, today on span.meta, span.chip.info | changes span.meta display: none -> inline |
| 402 | `.surf .ev-card>.card-head:first-child:not(:has(> :not(h2,.meta,.chip)))` | b | views/ev.css | 14 states; phone/wide/mid; ev, study, today on div.card-head | changes div.card-head display: none -> flex |
| 410 | `body.captions #p-ev` | b | views/ev.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on section#p-ev.panel, section#p-ev.panel.enter | changes section#p-ev.panel grid-template-rows: 318.062px 0px 0px 299.938px 0px 82px -> 356px 0px … |
| 411 | `body.captions #p-ev>.hero` | b | views/ev.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on div#hero.hero | changes div#hero.hero margin-top: 226px -> 0px |
| 414 | `body.captions.opening #p-ev>.hero` | b | views/ev.css | 560 states; phone/wide/mid; ev, today, study, progress, record, notes, system on div#hero.hero | changes div#hero.hero height: 0px -> 14px |
| 415 | `@(min-width:1024px) body.captions #p-ev>.hero` | b | views/ev.css | 2084 states; wide; ev, today, study, progress, record, notes, system on div#hero.hero | changes div#hero.hero height: 0px -> 36px |
| 416 | `body.captions #p-ev>.thread` | b | views/ev.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on div#thread.thread | changes div#thread.thread grid-row-start: 4 -> 3 |
| 417 | `body.captions #p-ev>.composer` | b | views/ev.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on div#composer.composer | changes div#composer.composer grid-row-start: 5 -> 4 |
| 418 | `body.captions #p-ev>#ev-side` | b | views/ev.css | 3549 states; phone/wide/mid; ev, today, study, progress, record, notes, system on aside#ev-side | changes aside#ev-side grid-row-start: 6 -> 5 |
| 420 | `@(max-width:1199px) body.captions #p-ev>#ev-side` | b | views/ev.css | 1483 states; phone/wide/mid; ev, today, study, record, progress, system on aside#ev-side | changes aside#ev-side grid-row-start: 5 -> 6 |
| 421 | `@(max-width:1199px) body.captions #p-ev>.composer` | b | views/ev.css | 1498 states; phone/wide/mid; ev, today, study, record, progress, system on div#composer.composer | changes div#composer.composer grid-row-start: 6 -> 5 |
| 428 | `.compose-row textarea` | b | views/ev.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on textarea#ev-input | changes textarea#ev-input min-height: 0px -> 44px |
| 429 | `.compose-row textarea::placeholder` | a | - | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on textarea#ev-input | same computed result without it |
| 430 | `.compose-row textarea:placeholder-shown` | b | views/ev.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) |
| 431 | `.compose-row #ev-send,.compose-row #ev-send.on` | b | views/ev.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on button#ev-send.primary, button#ev-send.primary.on | changes button#ev-send.primary color: rgb(26, 13, 5) -> rgb(163, 163, 171) raw: 16px |
| 432 | `.compose-row #ev-send:hover` | b | views/ev.css | 3567 states; phone/wide/mid; ev, today, study, progress, record, notes, system on button#ev-send.primary, button#ev-send.primary.on | state pseudo-class (hover/focus): not provable by computed style |
| 440 | `@(max-width:599px) .compose-row #ev-send,.compose-row #ev-send.on` | b | views/ev.css | 1312 states; phone; ev, today, study, record, progress, system on button#ev-send.primary, button#ev-send.primary.on | changes button#ev-send.primary width: 44px -> 32px raw: 22px |
| 444 | `@(min-width:1200px) body.captions #ev-side>#ev-dates` | b | views/ev.css | 1822 states; wide; ev, today, study, progress, record, notes, system on div#ev-dates.card.ev-dates.rest | changes div#ev-dates.card.ev-dates.rest background-color: rgba(0, 0, 0, 0) -> rgb(27, 27, 30) |
| 445 | `@(min-width:1200px) #ev-dates>h2` | b | views/ev.css | 1822 states; wide; ev, today, study, progress, record, notes, system on h2 | changes h2 min-height: 0px -> 36px |
| 446 | `@(min-width:1200px) #ev-dates .list` | b | views/ev.css | 1822 states; wide; ev, today, study, progress, record, notes, system on ul.list | redundant with another carry rule (no change alone, changes with the whole carry gone): fold into the rule that wins when moving |
| 447 | `@(min-width:1200px) #ev-dates .week-item` | b | views/ev.css | 1822 states; wide; ev, today, study, progress, record, notes, system on li.row.week-item | changes li.row.week-item padding-top: 0px -> 4px |
| 448 | `@(min-width:1200px) #ev-dates .wk-line` | b | views/ev.css | 1822 states; wide; ev, today, study, progress, record, notes, system on button.wk-line | changes button.wk-line align-items: center -> baseline raw: 8px |
| 449 | `@(min-width:1200px) #ev-dates .wk-line:hover` | b | views/ev.css | 1822 states; wide; ev, today, study, progress, record, notes, system on button.wk-line | state pseudo-class (hover/focus): not provable by computed style |
| 450 | `@(min-width:1200px) #ev-dates .wk-line::before` | b | views/ev.css | 1822 states; wide; ev, today, study, progress, record, notes, system on button.wk-line | changes button.wk-line::before content: "" -> none raw: 3px |
| 451 | `@(min-width:1200px) #ev-dates .wk-t` | b | views/ev.css | 1822 states; wide; ev, today, study, progress, record, notes, system on span.wk-t | redundant with another carry rule (no change alone, changes with the whole carry gone): fold into the rule that wins when moving |
| 452 | `@(min-width:1200px) #ev-dates .when` | b | views/ev.css | 1822 states; wide; ev, today, study, progress, record, notes, system on span.when | changes span.when order: 2 -> 0 |
| 457 | `:root[data-motion="reduce"] body.captions .reveal .w` | b | views/ev.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) |
| 458 | `:root[data-motion="reduce"] body.captions.side-on #p-ev>#ev-side` | b | views/ev.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) |
| 461 | `.chev,.prep-row .chev` | b | views/study.css | 2862 states; phone/wide/mid; ev, today, study, progress, record, notes, system on svg.chev | changes svg.chev transition-duration: 0.16s -> 0.25s raw: .16s |
| 462 | `.prep.open .chev,[aria-expanded="true"] .chev,[aria-expanded="true"]>.chev` | b | components/06-fold.css | 1578 states; phone/wide/mid; ev, today, study, notes, progress, record, system on svg.chev | changes svg.chev transition-duration: 0.28s -> 0.16s raw: .28s |
| 463 | `body.captions.her-folded .hero` | b | views/ev.css | 12 states; phone; ev, today, study, progress, record, system on div#hero.hero | changes div#hero.hero transition-duration: 0.18s -> 0.28s |
| 473 | `.title .row-badge` | a | - | 14 states; phone/wide; ev, today on span.badge.row-badge.x-blue, span.badge.row-badge.x-gre… | same computed result without it |
| 479 | `.toolbar` | b | components/12-field.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on div#today-bar.toolbar.today-bar, div#sbar-study.toolbar… | changes div#today-bar.toolbar.today-bar display: flex -> block |
| 480 | `.toolbar .sp` | b | components/12-field.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on span.sp | changes span.sp flex-grow: 1 -> 0 |
| 482 | `.pbar` | b | components/14-meter.css | 3526 states; phone/wide/mid; ev, today, study, progress, record, notes, system on div.pbar.tb-bar, div.pbar.ov-bar | changes div.pbar.tb-bar display: flex -> block raw: 3px |
| 483 | `.pbar>i` | b | components/14-meter.css | 3526 states; phone/wide/mid; ev, today, study, progress, record, notes, system on i.tb-neutral.tb-fill, i.x-green | changes i.tb-neutral.tb-fill height: 100% -> auto |
| 485 | `.field` | b | components/12-field.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) raw: 14px |
| 486 | `.field:focus-within` | b | components/12-field.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) |
| 487 | `.field :is(input,textarea)` | b | components/12-field.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) |
| 488 | `.field ::placeholder` | b | components/12-field.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) |
| 490 | `@(max-width:599px) .toolbar` | b | components/12-field.css | 1312 states; phone; ev, today, study, record, progress, system on div#today-bar.toolbar.today-bar, div#sbar-study.toolbar… | redundant with another carry rule (no change alone, changes with the whole carry gone): fold into the rule that wins when moving |
| 491 | `@(max-width:599px) .field` | b | components/12-field.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) |
| 527 | `.wchip:hover` | b | views/today.css | 2904 states; phone/mid/wide; today, ev, study, notes, progress, record, system on button.wchip.wk-list, button.wchip | state pseudo-class (hover/focus): not provable by computed style |
| 528 | `.wchip:focus-visible` | b | views/today.css | 2904 states; phone/mid/wide; today, ev, study, notes, progress, record, system on button.wchip.wk-list, button.wchip | state pseudo-class (hover/focus): not provable by computed style |
| 529 | `.wchip[aria-pressed="true"]` | b | views/today.css | 669 states; phone/mid/wide; today, ev, study, notes, progress, record, system on button.wchip, button.wchip.off | redundant with another carry rule (no change alone, changes with the whole carry gone): fold into the rule that wins when moving |
| 530 | `.wchip.exam .wc-t` | b | views/today.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) |
| 531 | `.wchip .wc-s.urgent` | b | views/today.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) |
| 532 | `.wchip.off .wc-t` | b | views/today.css | 71 states; phone/mid/wide; today, ev, study, system, progress, record on span.wc-t | changes span.wc-t color: rgb(102, 102, 108) -> rgb(28, 28, 31) |
| 533 | `.wchip.wk-load.done .wc-t` | b | views/today.css | 6 states; phone/mid/wide; today on span.wc-t | changes span.wc-t color: rgb(95, 95, 102) -> rgb(28, 28, 31) |
| 536 | `button.wk-h:hover b` | b | views/today.css | 2906 states; phone/mid/wide; today, ev, study, notes, progress, record, system on b | state pseudo-class (hover/focus): not provable by computed style |
| 537 | `button.wk-h:focus-visible` | b | views/today.css | 2906 states; phone/mid/wide; today, ev, study, notes, progress, record, system on button.wk-h | state pseudo-class (hover/focus): not provable by computed style |
| 538 | `button.wk-h[aria-pressed="true"]>span:first-child` | b | views/today.css | 1645 states; phone/mid/wide; today, progress, ev, study, notes, record, system on span | changes span color: rgb(28, 28, 31) -> rgb(95, 95, 102) |
| 539 | `.wchip.wk-task .wc-t` | b | views/today.css | 358 states; phone/mid/wide; today, ev, study, notes, progress, record, system on span.wc-t | changes span.wc-t color: rgb(95, 95, 102) -> rgb(28, 28, 31) |
| 548 | `.col-side>.tk-away,.col-main>.tk-away` | b | views/today.css | 138 states; wide/phone/mid; today, study, notes on div#today-list.card.tk-away, div#today-week.card.tk-away | changes div#today-list.card.tk-away display: none -> flex |
| 555 | `#p-today` | b | views/today.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on section#p-today.panel, section#p-today.panel.enter.tk-o… | changes section#p-today.panel row-gap: 0px -> 14px |
| 556 | `#p-today>.cols` | a | - | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on div.cols | same computed result without it |
| 557 | `#today-list>.empty` | b | views/today.css | 441 states; wide/phone/mid; ev, today, study, notes, progress, record, system on p.empty | changes p.empty padding-top: 14px -> 0px |
| 563 | `@(min-width:1200px) body.has-line #today-week .wk-days` | b | views/today.css | 894 states; wide; today, study, notes on div.wk-days | redundant with another carry rule (no change alone, changes with the whole carry gone): fold into the rule that wins when moving |
| 578 | `#ev-dates .wk-line .when` | b | views/ev.css | 3130 states; phone/wide/mid; ev, today, study, progress, record, notes, system on span.when | changes span.when text-align: right -> start |
| 583 | `button.btn.mh-back` | b | views/today.css | 3549 states; phone/wide/mid; ev, today, study, progress, record, notes, system on button.btn.ghost.icon.sm | changes button.btn.ghost.icon.sm display: none -> flex |
| 584 | `body[data-view="today"].task-open .mh button.btn.mh-back` | b | views/today.css | 71 states; wide/phone/mid; today on button.btn.ghost.icon.sm | changes button.btn.ghost.icon.sm display: grid -> none raw: 6px |
| 585 | `body[data-view="today"].task-open .mh button.btn.mh-back:hover` | b | views/today.css | 71 states; wide/phone/mid; today on button.btn.ghost.icon.sm | state pseudo-class (hover/focus): not provable by computed style |
| 586 | `.mh .mh-back svg` | b | views/today.css | 3549 states; phone/wide/mid; ev, today, study, progress, record, notes, system on svg | changes svg stroke-width: 1.8px -> 1.7px |
| 588 | `body[data-view="today"].task-open` | b | views/today.css | 71 states; wide/phone/mid; today on body.captions.opening.ev-rest-on.task-open, body.captio… | changes body.captions.opening.ev-rest-on.task-open --panel-top: calc(8px + 48px + 0px) -> calc(8p… |
| 591 | `@(max-width:599px) body[data-view="today"].task-open .mh button.btn.mh-back` | b | views/today.css | 16 states; phone; today on button.btn.ghost.icon.sm | changes button.btn.ghost.icon.sm height: 44px -> 28px |
| 592 | `@(max-width:599px) .mh .mh-back svg` | b | views/today.css | 1302 states; phone; ev, today, study, record, progress, system on svg | changes svg width: 18px -> 16px |
| 611 | `#p-study .sbar-study` | b | views/study.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on div#sbar-study.toolbar.sbar-study | changes div#sbar-study.toolbar.sbar-study min-height: 0px -> 48px |
| 612 | `#p-study .sbar-study:not(:has(> :not([hidden],.sp,#seg-study)))` | b | views/study.css | 1124 states; phone/mid/wide; study, today, ev, notes, progress, record, system on div#sbar-study.toolbar.sbar-study | changes div#sbar-study.toolbar.sbar-study display: none -> flex |
| 614 | `#seg-study` | b | views/study.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on div#seg-study.seg | changes div#seg-study.seg display: none -> flex |
| 615 | `#p-study .sbar-study .seg` | b | views/study.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on div#seg-study.seg, div#study-course.seg.course-seg | changes div#seg-study.seg align-self: center -> flex-start |
| 616 | `#study-course .code` | b | views/study.css | 3526 states; phone/wide/mid; ev, today, study, progress, record, notes, system on span.code | changes span.code display: none -> block |
| 617 | `#study-objectives` | b | views/study.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on div#study-objectives.panel, div#study-objectives.panel.… | changes div#study-objectives.panel row-gap: 12px -> 14px |
| 618 | `#study-objectives[hidden]` | a | - | 1978 states; phone/mid/wide; study, today, progress, record, system, ev, notes on div#study-objectives.panel, div#study-objectives.panel.… | same computed result without it |
| 619 | `.ov-card` | a | - | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on div#ov-card.ui-card.ov-card.pm-ex, div#ov-card.ui-card.… | same computed result without it |
| 620 | `.ov-card[hidden]` | b | views/study.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) |
| 621 | `.ov .obj` | b | views/study.css | 1594 states; phone/wide/mid; ev, today, study, notes, progress, record, system on div.obj, div.obj.on | changes div.obj display: flex -> block |
| 622 | `.ov:last-child .obj` | b | views/study.css | 1594 states; phone/wide/mid; ev, today, study, notes, progress, record, system on div.obj, div.obj.on | changes div.obj border-bottom-width: 0px -> 1px |
| 623 | `.obj .nm` | b | views/study.css | 1594 states; phone/wide/mid; ev, today, study, notes, progress, record, system on button.nm.ov-nm | changes button.nm.ov-nm flex-grow: 1 -> 0 |
| 624 | `.obj .nm:hover` | b | views/study.css | 1594 states; phone/wide/mid; ev, today, study, notes, progress, record, system on button.nm.ov-nm | state pseudo-class (hover/focus): not provable by computed style |
| 625 | `.obj.on .nm` | b | views/study.css | 1189 states; wide/phone; ev, today, study, notes, progress, record, system on button.nm.ov-nm | changes button.nm.ov-nm font-weight: 600 -> 400 |
| 626 | `.obj .ow` | b | views/study.css | 1594 states; phone/wide/mid; ev, today, study, notes, progress, record, system on span.ow | changes span.ow font-size: 12px -> 13px |
| 627 | `.obj .oq` | b | views/study.css | 1594 states; phone/wide/mid; ev, today, study, notes, progress, record, system on button.btn.ghost.sm.oq | changes button.btn.ghost.sm.oq visibility: hidden -> visible |
| 628 | `.obj:hover .oq,.obj:focus-within .oq` | b | views/study.css | 1594 states; phone/wide/mid; ev, today, study, notes, progress, record, system on button.btn.ghost.sm.oq | state pseudo-class (hover/focus): not provable by computed style |
| 629 | `.ov-detail .od-name` | b | views/study.css | 423 states; wide/phone; study, ev, today, progress, record, system on div.od-name | changes div.od-name font-weight: 600 -> 400 |
| 630 | `.ov-detail .od-row` | b | views/study.css | 705 states; phone/wide; study, today, ev, progress, record, system on div.od-row | changes div.od-row display: flex -> block |
| 631 | `.ov-detail .od-ws .st` | b | views/study.css | 469 states; phone/wide; study, today, ev, record, progress, system on span.st | changes span.st font-size: 12px -> 13px |
| 632 | `.ov-detail .od-q` | b | views/study.css | 660 states; phone/wide; study, today, ev, progress, record, system on button.btn.neutral.od-q | changes button.btn.neutral.od-q align-self: flex-start -> auto |
| 633 | `.ov > .ov-detail` | b | views/study.css | 282 states; phone; study, today, ev, record, progress, system on div.ov-detail | changes div.ov-detail padding-top: 14px -> 0px |
| 634 | `.ov:last-child > .ov-detail` | b | views/study.css | 268 states; phone; study, ev, record, today, progress, system on div.ov-detail | changes div.ov-detail border-bottom-width: 0px -> 1px |
| 635 | `.ov.open:has(> .ov-detail) .obj` | b | views/study.css | 282 states; phone; study, today, ev, record, progress, system on div.obj.on | changes div.obj.on border-bottom-width: 0px -> 1px |
| 636 | `.ov-grid:empty` | b | views/study.css | 45 states; wide/phone/mid; ev on div#ov-grid.ov-grid | changes div#ov-grid.ov-grid display: none -> grid |
| 637 | `.ov-grid > :only-child` | b | views/study.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) |
| 638 | `.ov-grid > .ov-up[hidden] ~ .ov-quiz` | b | views/study.css | 396 states; wide/phone; ev, today, study, notes, progress, record, system on section#ov-quiz.ui-card.ov-quiz | changes section#ov-quiz.ui-card.ov-quiz grid-column-start: 1 -> auto |
| 639 | `.ov-card .ov-none` | b | views/study.css | 514 states; phone/wide; ev, study, today, notes, progress, record, system on p.empty.ov-none | changes p.empty.ov-none margin-top: 4px -> 0px |
| 641 | `.ov-card .ov-none-row` | b | views/study.css | 240 states; wide; ev, today, study, notes, progress, record, system on div.ov-none-row | changes div.ov-none-row display: flex -> block |
| 642 | `.ov-card .ov-none-row .ov-none` | b | views/study.css | 240 states; wide; ev, today, study, notes, progress, record, system on p.empty.ov-none | changes p.empty.ov-none flex-grow: 1 -> 0 |
| 643 | `.ov-detail .od-add` | b | views/study.css | 156 states; phone; ev, today, study, progress, record, system on button.btn.neutral.sm.od-add | changes button.btn.neutral.sm.od-add align-self: flex-start -> auto |
| 645 | `.ov-sets[hidden]` | a | - | 457 states; phone/wide/mid; study, ev, progress, system, today, record, notes on section#ov-sets.ui-card.ov-sets | same computed result without it |
| 646 | `.ov-sets .st:hover` | b | views/study.css | 3126 states; phone/wide/mid; ev, today, study, progress, record, notes, system on button.st | state pseudo-class (hover/focus): not provable by computed style |
| 647 | `.ov-sets span.sm,.ov-sets .sd` | b | views/study.css | 3130 states; phone/wide/mid; ev, today, study, progress, record, notes, system on span.sm, span.sd | changes span.sm font-size: 12px -> 13px |
| 648 | `.ov-sets .fold-line` | b | views/study.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) |
| 649 | `.pl-t .pl-set` | b | views/study.css | 1543 states; phone/wide/mid; study, today, ev, notes, progress, record, system on button.btn.ghost.sm.pl-set | changes button.btn.ghost.sm.pl-set flex-shrink: 0 -> 1 |
| 657 | `#record-sessions .rec-bar` | b | views/record.css | 3549 states; phone/wide/mid; ev, today, study, progress, record, notes, system on div.toolbar.rec-bar | redundant with another carry rule (no change alone, changes with the whole carry gone): fold into the rule that wins when moving |
| 658 | `#record-sessions .rec-bar > .seg` | b | views/record.css | 3549 states; phone/wide/mid; ev, today, study, progress, record, notes, system on div#rec-types.seg | redundant with another carry rule (no change alone, changes with the whole carry gone): fold into the rule that wins when moving |
| 659 | `#rec-types button .n` | b | views/record.css | 3526 states; phone/wide/mid; ev, today, study, progress, record, notes, system on span.n | redundant with another carry rule (no change alone, changes with the whole carry gone): fold into the rule that wins when moving |
| 660 | `.rec-pop .lbl` | b | views/record.css | 1292 states; wide/phone; record, system, ev, today, study, notes, progress on span.lbl | changes span.lbl font-weight: 500 -> 400 |
| 661 | `.rec-pop .seg` | b | views/record.css | 1292 states; wide/phone; record, system, ev, today, study, notes, progress on div.seg | redundant with another carry rule (no change alone, changes with the whole carry gone): fold into the rule that wins when moving |
| 662 | `.rec-pop .seg button` | b | views/record.css | 1292 states; wide/phone; record, system, ev, today, study, notes, progress on button | redundant with another carry rule (no change alone, changes with the whole carry gone): fold into the rule that wins when moving |
| 663 | `.rec-ck input` | b | views/record.css | 1292 states; wide/phone; record, system, ev, today, study, notes, progress on input#rec-workouts | changes input#rec-workouts width: 16px -> auto |
| 664 | `.rec-list` | b | views/record.css | 3549 states; phone/wide/mid; ev, today, study, progress, record, notes, system on div#rec-list.card.rec-list | redundant with another carry rule (no change alone, changes with the whole carry gone): fold into the rule that wins when moving |
| 665 | `.rec-detail .meta` | b | views/record.css | 2209 states; phone/wide/mid; ev, today, study, progress, record, notes, system on p.meta | changes p.meta margin-top: 0px -> 2px |
| 666 | `.rec-detail select.idea-kind` | b | views/record.css | 1035 states; wide/mid/phone; ev, today, study, progress, record, notes, system on select.idea-kind | changes select.idea-kind height: 28px -> auto raw: 8px |
| 668 | `@(max-width:599px) .rec-pop .seg button` | a | - | 510 states; phone; record, system, ev, today, study, progress on button | same computed result without it |
| 671 | `@(max-width:599px) .rec-detail select.idea-kind` | b | views/record.css | 2 states; phone; study, ev on select.idea-kind | changes select.idea-kind height: 44px -> 28px |
| 676 | `#record-sessions` | b | views/record.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on div#record-sessions.panel | redundant with another carry rule (no change alone, changes with the whole carry gone): fold into the rule that wins when moving |
| 677 | `#record-sessions .rec-bar` | b | views/record.css | 3549 states; phone/wide/mid; ev, today, study, progress, record, notes, system on div.toolbar.rec-bar | redundant with another carry rule (no change alone, changes with the whole carry gone): fold into the rule that wins when moving |
| 678 | `.rec-fbtn .ico` | a | - | 3549 states; phone/wide/mid; ev, today, study, progress, record, notes, system on svg.ico | same computed result without it |
| 679 | `.rec-pop .seg` | b | views/record.css | 1292 states; wide/phone; record, system, ev, today, study, notes, progress on div.seg | changes div.seg align-self: flex-start -> stretch |
| 680 | `.rec-pop .seg button` | b | views/record.css | 1292 states; wide/phone; record, system, ev, today, study, notes, progress on button | changes button flex-grow: 0 -> 1 |
| 681 | `#record-sessions .cols > .col-main` | b | views/record.css | 3549 states; phone/wide/mid; ev, today, study, progress, record, notes, system on div.col-main | redundant with another carry rule (no change alone, changes with the whole carry gone): fold into the rule that wins when moving |
| 682 | `#record-sessions .rec-list` | b | views/record.css | 3549 states; phone/wide/mid; ev, today, study, progress, record, notes, system on div#rec-list.card.rec-list | redundant with another carry rule (no change alone, changes with the whole carry gone): fold into the rule that wins when moving |
| 684 | `@(max-width:599px) #record-sessions .rec-bar` | b | views/record.css | 1302 states; phone; ev, today, study, record, progress, system on div.toolbar.rec-bar | redundant with another carry rule (no change alone, changes with the whole carry gone): fold into the rule that wins when moving |
| 687 | `@(max-width:599px) #record-sessions .rec-bar > .seg` | b | views/record.css | 1302 states; phone; ev, today, study, record, progress, system on div#rec-types.seg | redundant with another carry rule (no change alone, changes with the whole carry gone): fold into the rule that wins when moving |
| 692 | `body.has-line #today-week .wk-her` | a | - | 1363 states; phone/mid/wide; today, study, notes on p.wk-her | same computed result without it |
| 696 | `#p-record > .panel` | b | views/record.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on div#record-sessions.panel | redundant with another carry rule (no change alone, changes with the whole carry gone): fold into the rule that wins when moving |
| 697 | `#p-record > .panel .rec-bar` | b | views/record.css | 3549 states; phone/wide/mid; ev, today, study, progress, record, notes, system on div.toolbar.rec-bar | redundant with another carry rule (no change alone, changes with the whole carry gone): fold into the rule that wins when moving |
| 698 | `#p-record > .panel .rec-bar > .seg` | b | views/record.css | 3549 states; phone/wide/mid; ev, today, study, progress, record, notes, system on div#rec-types.seg | redundant with another carry rule (no change alone, changes with the whole carry gone): fold into the rule that wins when moving |
| 699 | `#p-record > .panel .seg button .n` | b | views/record.css | 3526 states; phone/wide/mid; ev, today, study, progress, record, notes, system on span.n | redundant with another carry rule (no change alone, changes with the whole carry gone): fold into the rule that wins when moving |
| 700 | `#p-record > .panel .cols > .col-main` | b | views/record.css | 3549 states; phone/wide/mid; ev, today, study, progress, record, notes, system on div.col-main | redundant with another carry rule (no change alone, changes with the whole carry gone): fold into the rule that wins when moving |
| 701 | `#p-record .rec-list > .empty` | b | views/record.css | 293 states; wide/phone; ev, today, study, notes, progress, record, system on p.empty | changes p.empty padding-top: 14px -> 0px |
| 703 | `@(max-width:599px) #p-record > .panel .rec-bar` | b | views/record.css | 1302 states; phone; ev, today, study, record, progress, system on div.toolbar.rec-bar | changes div.toolbar.rec-bar padding-top: 10px -> 12px |
| 706 | `@(max-width:599px) #p-record > .panel .rec-bar > .seg` | b | views/record.css | 1302 states; phone; ev, today, study, record, progress, system on div#rec-types.seg | redundant with another carry rule (no change alone, changes with the whole carry gone): fold into the rule that wins when moving |
| 707 | `@(max-width:599px) #p-record > .panel .rec-bar > .seg > button` | b | views/record.css | 1294 states; phone; ev, today, study, record, progress, system on button | changes button flex-grow: 0 -> 1 |
| 710 | `@(max-width:599px) #p-record .rec-list > .empty` | b | views/record.css | 134 states; phone; ev, today, study, progress, record, system on p.empty | changes p.empty padding-right: 16px -> 18px |
| 716 | `@(max-width:599px) body.captions:has(.mh>#sbar:not([hidden])) #p-ev` | b | views/ev.css | 250 states; phone; ev, today, study, progress, record on section#p-ev.panel, section#p-ev.panel.enter | changes section#p-ev.panel height: 647px -> 700px |
| 719 | `@(min-width:600px) and (max-width:1199px) body.captions.on-ev:has(.mh>#sbar:not([hidden])…` | b | views/ev.css | 13 states; mid; ev on section#p-ev.panel, section#p-ev.panel.enter | changes section#p-ev.panel height: 705px -> 746px |
| 722 | `.ro-banner` | b | patterns/shell.css | 437 states; wide/phone; ev, today, study, notes, progress, record, system on p.ro-banner | changes p.ro-banner position: sticky -> static |
| 723 | `[data-readonly] #composer,[data-readonly] #new-wrap` | b | patterns/shell.css | 437 states; wide/phone; ev, today, study, notes, progress, record, system on div#new-wrap.new-wrap, div#composer.composer | changes div#new-wrap.new-wrap display: none -> block |
| 730 | `.chatp` | b | views/ev.css | 3549 states; phone/wide/mid; ev, today, study, progress, record, notes, system on section#evchat.chatp, section#evchat.chatp.wide | redundant with another carry rule (no change alone, changes with the whole carry gone): fold into the rule that wins when moving |
| 732 | `@(min-width:1024px) #study-side:not([hidden]),body.captions.side-on #p-ev>#ev-side,body.c…` | b | views/ev.css | 1881 states; wide; ev, today, study, progress, record, notes, system on aside#ev-side, aside#study-side.study-side | changes aside#ev-side bottom: 38px -> 8px |
| 735 | `@(min-width:1024px) .chatp .ico` | b | views/ev.css | 2076 states; wide; ev, today, study, progress, record, notes, system on svg.ico | redundant with another carry rule (no change alone, changes with the whole carry gone): fold into the rule that wins when moving |
| 736 | `@(min-width:1024px) .chatp:not([hidden])` | b | views/ev.css | 227 states; wide; today, study, progress, record, notes, ev, system on section#evchat.chatp, section#evchat.chatp.wide | changes section#evchat.chatp display: flex -> none |
| 737 | `@(min-width:1024px) .chatp` | b | views/ev.css | 2076 states; wide; ev, today, study, progress, record, notes, system on section#evchat.chatp, section#evchat.chatp.wide | changes section#evchat.chatp position: fixed -> static raw: rgba(0,0,0,.10) rgba(0,0,0,.05) 14px |
| 738 | `@(min-width:1024px) .chatp.wide` | b | views/ev.css | 12 states; wide; notes, study, ev, record on section#evchat.chatp.wide | changes section#evchat.chatp.wide width: 640px -> 400px |
| 740 | `@(min-width:1024px) body.on-ev .chatp` | b | views/ev.css | 264 states; wide; ev on section#evchat.chatp, section#evchat.chatp.wide | changes section#evchat.chatp bottom: 122px -> 42px |
| 741 | `@(min-width:1024px) .chatp .cph` | b | views/ev.css | 2076 states; wide; ev, today, study, progress, record, notes, system on div.cph | changes div.cph display: flex -> block |
| 742 | `@(min-width:1024px) .chatp .cph .tt` | b | views/ev.css | 2076 states; wide; ev, today, study, progress, record, notes, system on div.tt | changes div.tt flex-grow: 1 -> 0 |
| 743 | `@(min-width:1024px) .chatp .cph .tt b` | b | views/ev.css | 2076 states; wide; ev, today, study, progress, record, notes, system on b | changes b font-size: 14px -> 13px |
| 744 | `@(min-width:1024px) .chatp .cph .tt span` | b | views/ev.css | 2076 states; wide; ev, today, study, progress, record, notes, system on span | changes span font-size: 12px -> 13px |
| 745 | `@(min-width:1024px) .chatp .msgs` | b | views/ev.css | 2076 states; wide; ev, today, study, progress, record, notes, system on div.msgs | changes div.msgs flex-grow: 1 -> 0 |
| 746 | `@(min-width:1024px) .chatp .mev` | b | views/ev.css | 426 states; wide; today, study, progress, record, notes, ev, system on div.mev | changes div.mev overflow-wrap: anywhere -> normal |
| 747 | `@(min-width:1024px) .chatp .mev p` | b | views/ev.css | 426 states; wide; today, study, progress, record, notes, ev, system on p | changes p margin-top: 0px -> 13px |
| 747 | `@(min-width:1024px) .chatp .mev p:last-child` | b | views/ev.css | 426 states; wide; today, study, progress, record, notes, ev, system on p | changes p margin-bottom: 0px -> 6px |
| 748 | `@(min-width:1024px) .chatp .mev ul` | b | views/ev.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) |
| 749 | `@(min-width:1024px) .chatp .mev.err` | b | views/ev.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) |
| 750 | `@(min-width:1024px) .chatp .mev .mch` | b | views/ev.css | 71 states; wide; notes, study, ev, today, record on div.mch | changes div.mch display: flex -> block |
| 751 | `@(min-width:1024px) .chatp .myou` | b | views/ev.css | 293 states; wide; today, study, progress, record, notes, ev, system on div.myou | changes div.myou align-self: flex-end -> auto |
| 752 | `@(min-width:1024px) .chatp .myou b` | b | views/ev.css | 293 states; wide; today, study, progress, record, notes, ev, system on b | changes b display: block -> inline |
| 753 | `@(min-width:1024px) .chatp .pchips` | b | views/ev.css | 2076 states; wide; ev, today, study, progress, record, notes, system on div.pchips | changes div.pchips display: flex -> block |
| 754 | `@(min-width:1024px) .chatp .pchips .qchip` | b | views/ev.css | 1486 states; wide; today, study, progress, record, notes, ev, system on button.qchip | changes button.qchip max-width: 100% -> none |
| 755 | `@(min-width:1024px) .chatp .cin2` | b | views/ev.css | 2076 states; wide; ev, today, study, progress, record, notes, system on form.cin2 | changes form.cin2 margin-right: 8px -> 0px raw: 12px |
| 756 | `@(min-width:1024px) .chatp .cin2:focus-within` | b | views/ev.css | 2076 states; wide; ev, today, study, progress, record, notes, system on form.cin2 | state pseudo-class (hover/focus): not provable by computed style |
| 757 | `@(min-width:1024px) .chatp .cin2 textarea` | b | views/ev.css | 2076 states; wide; ev, today, study, progress, record, notes, system on textarea#evc-input | changes textarea#evc-input border-top-width: 0px -> 1px raw: 12px |
| 758 | `@(min-width:1024px) .chatp .cin2 textarea::placeholder` | a | - | 2076 states; wide; ev, today, study, progress, record, notes, system on textarea#evc-input | same computed result without it |
| 759 | `@(min-width:1024px) .chatp .cin2 .crow` | b | views/ev.css | 2076 states; wide; ev, today, study, progress, record, notes, system on div.crow | changes div.crow display: flex -> block |
| 760 | `@(min-width:1024px) .chatp .cin2 .crow .sp` | b | views/ev.css | 2076 states; wide; ev, today, study, progress, record, notes, system on span.sp | changes span.sp flex-grow: 1 -> 0 |
| 761 | `@(min-width:1024px) .chatp .cin2 .ctx` | b | views/ev.css | 2076 states; wide; ev, today, study, progress, record, notes, system on span.ctx | changes span.ctx display: flex -> block |
| 762 | `@(min-width:1024px) .chatp .cin2 .ctx .ico` | b | views/ev.css | 1577 states; wide; today, study, progress, record, notes, ev, system on svg.ico | changes svg.ico width: 13px -> 16px |
| 763 | `@(min-width:1024px) .chatp .cin2 .send` | b | views/ev.css | 2076 states; wide; ev, today, study, progress, record, notes, system on button.send | changes button.send width: 28px -> auto raw: 14px |
| 764 | `@(min-width:1024px) .chatp .cin2 .send .ico` | b | views/ev.css | 1577 states; wide; today, study, progress, record, notes, ev, system on svg.ico | changes svg.ico width: 14px -> 16px |
| 765 | `@(min-width:1024px) .chatp .hlist` | b | views/ev.css | 2076 states; wide; ev, today, study, progress, record, notes, system on div.hlist | changes div.hlist flex-grow: 1 -> 0 |
| 766 | `@(min-width:1024px) .chatp .hlist .mhd` | b | views/ev.css | 1716 states; wide; today, study, progress, record, notes, ev, system on div.mhd | changes div.mhd font-weight: 500 -> 400 |
| 767 | `@(min-width:1024px) .chatp .hlist .mi` | b | views/ev.css | 1691 states; wide; today, study, progress, record, notes, ev, system on button.mi.pki | changes button.mi.pki appearance: none -> auto raw: 6px |
| 768 | `@(min-width:1024px) .chatp .hlist .mi:hover` | b | views/ev.css | 1691 states; wide; today, study, progress, record, notes, ev, system on button.mi.pki | state pseudo-class (hover/focus): not provable by computed style |
| 769 | `@(min-width:1024px) .chatp .hlist .pt` | b | views/ev.css | 1691 states; wide; today, study, progress, record, notes, ev, system on span.pt | changes span.pt flex-grow: 1 -> 0 |
| 770 | `@(min-width:1024px) .chatp .hlist .pn` | b | views/ev.css | 1691 states; wide; today, study, progress, record, notes, ev, system on span.pn | changes span.pn text-wrap-mode: nowrap -> wrap |
| 771 | `@(min-width:1024px) .chatp .hlist .pm` | b | views/ev.css | 1691 states; wide; today, study, progress, record, notes, ev, system on span.pm | changes span.pm font-size: 12px -> 13px |
| 772 | `@(min-width:1024px) .chatp .hlist .hnone` | b | views/ev.css | 25 states; wide; ev, today, study, notes, progress, record on div.mini.hnone | changes div.mini.hnone padding-top: 6px -> 0px |
| 776 | `@(min-width:1200px) body.has-line #today-week .wk-days` | b | views/today.css | 894 states; wide; today, study, notes on div.wk-days | changes div.wk-days min-height: 664px -> 694px |
| 779 | `#tab-notes[hidden],#p-notes[hidden]` | a | - | 3344 states; phone/wide/mid; ev, today, study, progress, record, system on button#tab-notes.tab, section#p-notes.panel | same computed result without it |
| 781 | `@(max-width:1023px) #tab-notes,#p-notes` | a | - | 1473 states; phone/mid; ev, today, study, record, progress, system on button#tab-notes.tab, section#p-notes.panel | same computed result without it |
| 783 | `#p-notes .ico` | b | views/notes.css | 3549 states; phone/wide/mid; ev, today, study, progress, record, notes, system on svg.ico, svg.ico.sicon | redundant with another carry rule (no change alone, changes with the whole carry gone): fold into the rule that wins when moving |
| 787 | `#p-notes > .n-list` | b | views/notes.css | 3549 states; phone/wide/mid; ev, today, study, progress, record, notes, system on div#notes-list.panel.n-list | changes div#notes-list.panel.n-list margin-top: -18px -> 0px |
| 788 | `#p-notes .n-list .col-main` | b | views/notes.css | 3549 states; phone/wide/mid; ev, today, study, progress, record, notes, system on div.col-main | changes div.col-main row-gap: 0px -> normal |
| 789 | `#p-notes .n-filters` | b | views/notes.css | 3549 states; phone/wide/mid; ev, today, study, progress, record, notes, system on div#notes-filters.seg.n-filters | changes div#notes-filters.seg.n-filters align-self: center -> stretch |
| 790 | `#p-notes .n-row .n-unsaved` | b | views/notes.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) |
| 791 | `#p-notes .nempty span` | b | views/notes.css | 551 states; wide/phone; ev, notes, today, study, progress, record, system on span | changes span max-width: 360px -> none |
| 792 | `#p-notes .nempty .ico` | b | views/notes.css | 551 states; wide/phone; ev, notes, today, study, progress, record, system on svg.ico | changes svg.ico width: 28px -> 16px |
| 793 | `#p-notes .nempty b` | b | views/notes.css | 551 states; wide/phone; ev, notes, today, study, progress, record, system on b | changes b color: rgb(28, 28, 31) -> rgb(95, 95, 102) |
| 794 | `#p-notes .nempty .btn` | b | views/notes.css | 1 states; wide; notes on button.btn.neutral.sm | changes button.btn.neutral.sm margin-top: 6px -> 0px |
| 795 | `#p-notes .n-pvt` | b | views/notes.css | 2978 states; phone/wide/mid; ev, today, study, progress, record, notes, system on h2.n-pvt | changes h2.n-pvt font-size: 18px -> 13.5px |
| 796 | `#p-notes .n-acts .btn` | b | views/notes.css | 2978 states; phone/wide/mid; ev, today, study, progress, record, notes, system on button#notes-pv-open.btn.neutral.wide, button#notes-pv-… | changes button#notes-pv-open.btn.neutral.wide width: 100% -> auto |
| 798 | `@(max-width:1199px) #p-notes .n-pv` | b | views/notes.css | 1483 states; phone/wide/mid; ev, today, study, record, progress, system on div#notes-preview.col-side.n-pv | changes div#notes-preview.col-side.n-pv flex-direction: column -> row |
| 800 | `#p-notes .n-fbar` | b | views/notes.css | 3549 states; phone/wide/mid; ev, today, study, progress, record, notes, system on div.n-fbar | changes div.n-fbar position: sticky -> static |
| 803 | `#p-notes .n-fbar` | b | views/notes.css | 3549 states; phone/wide/mid; ev, today, study, progress, record, notes, system on div.n-fbar | changes div.n-fbar padding-right: 28px -> 12px |
| 805 | `#p-notes .n-fbar button.btn.on` | b | views/notes.css | 1481 states; wide; notes, today, study, progress, record, ev, system on button.btn.ghost.icon.sm, button.btn.popover-i.mi.on | changes button.btn.ghost.icon.sm box-shadow: rgb(236, 236, 238) 0px 0px 0px 1px inset -> none |
| 806 | `#p-notes .n-stb` | b | views/notes.css | 3549 states; phone/wide/mid; ev, today, study, progress, record, notes, system on button.btn.ghost.sm.n-stb | changes button.btn.ghost.sm.n-stb width: 164px -> auto |
| 808 | `.n-ask` | b | views/notes.css | 3549 states; phone/wide/mid; ev, today, study, progress, record, notes, system on button#note-ask.btn.neutral.sm.n-ask | changes button#note-ask.btn.neutral.sm.n-ask position: fixed -> static raw: rgba(0,0,0,.14) |
| 809 | `.n-ask[hidden]` | a | - | 3549 states; phone/wide/mid; ev, today, study, progress, record, notes, system on button#note-ask.btn.neutral.sm.n-ask | same computed result without it |
| 810 | `#p-notes .popover .mi` | b | views/notes.css | 3549 states; phone/wide/mid; ev, today, study, progress, record, notes, system on button.btn.popover-i.mi, button.btn.popover-i.mi.on | changes button.btn.popover-i.mi display: flex -> inline-flex raw: 6px |
| 811 | `#p-notes .popover .mi:hover,#p-notes .popover .mi:focus-visible,#p-notes .popover .mi.on` | b | views/notes.css | 3549 states; phone/wide/mid; ev, today, study, progress, record, notes, system on button.btn.popover-i.mi, button.btn.popover-i.mi.on | state pseudo-class (hover/focus): not provable by computed style |
| 812 | `#p-notes .popover .mi.on` | b | views/notes.css | 1481 states; wide; notes, today, study, progress, record, ev, system on button.btn.popover-i.mi.on | changes button.btn.popover-i.mi.on font-weight: 500 -> 400 |
| 813 | `#p-notes .n-lkp .in` | b | views/notes.css | 3549 states; phone/wide/mid; ev, today, study, progress, record, notes, system on input#n-lkin.in | changes input#n-lkin.in height: 38px -> auto raw: 8px |
| 814 | `#p-notes .n-doc` | b | views/notes.css | 3549 states; phone/wide/mid; ev, today, study, progress, record, notes, system on article.n-doc | changes article.n-doc position: relative -> static |
| 815 | `#p-notes .n-meta .btn` | b | views/notes.css | 3549 states; phone/wide/mid; ev, today, study, progress, record, notes, system on button.btn.ghost.sm.n-course | changes button.btn.ghost.sm.n-course row-gap: 5px -> 7px |
| 816 | `#p-notes .n-meta .ico` | b | views/notes.css | 1481 states; wide; notes, today, study, progress, record, ev, system on svg.ico | changes svg.ico width: 14px -> 16px |
| 819 | `#note-body.empty:not(.untitled)::before` | b | views/notes.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) |
| 820 | `#note-body h1.nb` | b | views/notes.css | 1481 states; wide; notes, today, study, progress, record, ev, system on h1.nb | changes h1.nb margin-top: 0px -> 6px |
| 821 | `#note-body h2.nb` | b | views/notes.css | 17 states; wide; notes, today, study, progress, record, ev on h2.nb | changes h2.nb margin-top: 28px -> 6px |
| 822 | `#note-body h3.nb` | b | views/notes.css | never matched | NOT REACHED by the crawl; its classes exist in page code, so kept and moved as is (prove with a seeded state) |
| 823 | `#note-body p.nb` | a | - | 32 states; wide; notes, today, study, progress, record, ev on p.nb | same computed result without it |
| 824 | `#note-body .n-chk` | b | views/notes.css | 18 states; wide; notes, today, study, progress, record, ev on span.n-chk.done, span.n-chk | changes span.n-chk.done position: absolute -> static raw: 5px |
| 825 | `#note-body .n-chk.done` | b | views/notes.css | 17 states; wide; notes, today, study, progress, record, ev on span.n-chk.done | changes span.n-chk.done background-color: rgb(44, 154, 90) -> rgba(0, 0, 0, 0) |
| 826 | `#note-body .n-chk .ico` | b | views/notes.css | 18 states; wide; notes, today, study, progress, record, ev on svg.ico | changes svg.ico width: 11px -> 16px |
| 827 | `#note-body .n-chk.done .ico` | b | views/notes.css | 17 states; wide; notes, today, study, progress, record, ev on svg.ico | changes svg.ico opacity: 1 -> 0 |
| 828 | `#note-body u` | b | views/notes.css | 17 states; wide; notes, today, study, progress, record, ev on u | changes u text-underline-offset: 3px -> auto |
| 829 | `#note-body a` | b | views/notes.css | 17 states; wide; notes, today, study, progress, record, ev on a | changes a text-decoration-color: rgb(95, 95, 102) -> rgb(28, 28, 31) |
| 830 | `.mh .n-sync` | b | views/notes.css | 3549 states; phone/wide/mid; ev, today, study, progress, record, notes, system on span.n-sync, span.n-sync.bad | changes span.n-sync order: 9 -> 0 |
| 831 | `.mh .n-sync.bad` | b | views/notes.css | 3 states; wide; notes on span.n-sync.bad | changes span.n-sync.bad color: rgb(204, 75, 69) -> rgb(95, 95, 102) |
| 833 | `.mh .n-sync.warn .ico` | b | views/notes.css | 1 states; wide; notes on svg.ico | changes svg.ico color: rgb(168, 122, 12) -> rgb(95, 95, 102) |
| 834 | `#p-notes .n-pick .vh>.ico` | b | views/notes.css | 1 states; wide; notes on svg.ico | changes svg.ico margin-top: 2px -> 0px |
| 835 | `#p-notes .n-pick .vhw b` | b | views/notes.css | 1 states; wide; notes on b | changes b font-weight: 600 -> 700 |
| 836 | `#p-notes .n-pick .vhw span` | b | views/notes.css | 1 states; wide; notes on span | changes span color: rgb(95, 95, 102) -> rgb(28, 28, 31) |
| 837 | `#p-notes .n-pick .ver .btn` | b | views/notes.css | 1 states; wide; notes on button.btn.neutral.sm | changes button.btn.neutral.sm align-self: flex-start -> auto |
| 838 | `#p-notes .n-pick .vwho b` | b | views/notes.css | 1 states; wide; notes on b | changes b font-weight: 600 -> 700 |
| 839 | `#p-notes .n-pick .vwho .ico` | b | views/notes.css | 1 states; wide; notes on svg.ico.sicon | changes svg.ico.sicon width: 15px -> 16px |
| 841 | `.mh .n-read` | b | views/notes.css | 3549 states; phone/wide/mid; ev, today, study, progress, record, notes, system on button#notes-read.btn.ghost.sm.n-read | changes button#notes-read.btn.ghost.sm.n-read order: 9 -> 0 |
| 842 | `.mh .n-read .ico` | b | views/notes.css | 1481 states; wide; notes, today, study, progress, record, ev, system on svg.ico | changes svg.ico width: 14px -> 16px |
| 843 | `.mh .n-read[aria-pressed=false]` | b | views/notes.css | 3 states; wide; notes, record on button#notes-read.btn.ghost.sm.n-read | changes button#notes-read.btn.ghost.sm.n-read color: rgb(102, 102, 108) -> rgb(95, 95, 102) |
| 844 | `.mh .n-crumb[hidden],.mh .n-sync[hidden],.mh .n-back[hidden],.mh .n-read[hidden]` | a | - | 3420 states; phone/wide/mid; ev, today, study, progress, record, notes, system on button.btn.ghost.icon.sm, span.n-crumb | same computed result without it |
| 850 | `@(max-width:599px) input[type=text],input[type=date],input[type=number],input[type=search…` | b | views/record.css | 1312 states; phone; ev, today, study, record, progress, system on textarea#ev-input, select.fc-mode | changes textarea#ev-input font-size: 16px -> 14px raw: 16px |
| 853 | `@(max-width:599px) body.captions.kb #p-ev` | b | views/ev.css | 1 states; phone; ev on section#p-ev.panel | changes section#p-ev.panel min-height: 0px -> 420px |
| 863 | `@(max-width:599px) #p-record .rec-detail select.idea-kind` | b | views/record.css | 2 states; phone; study, ev on select.idea-kind | changes select.idea-kind font-size: 16px -> 12px raw: 16px |
| 867 | `.mh .n-read` | b | views/notes.css | 3549 states; phone/wide/mid; ev, today, study, progress, record, notes, system on button#notes-read.btn.ghost.sm.n-read | redundant with another carry rule (no change alone, changes with the whole carry gone): fold into the rule that wins when moving |
| 868 | `.mh .n-read[aria-pressed=true]` | b | views/notes.css | 1480 states; wide; notes, today, study, progress, record, ev, system on button#notes-read.btn.ghost.sm.n-read | changes button#notes-read.btn.ghost.sm.n-read box-shadow: rgb(222, 222, 225) 0px 0px 0px 1px inse… |
| 875 | `@(min-width:600px) body.captions.on-ev .wrap>#p-ev` | b | views/ev.css | 324 states; wide/mid; ev on section#p-ev.panel, section#p-ev.panel.enter | changes section#p-ev.panel width: 680px -> 994px |
| 876 | `@(min-width:600px) #p-notes .n-fbar` | b | views/notes.css | 2247 states; wide/mid; ev, today, study, progress, record, notes, system on div.n-fbar | changes div.n-fbar top: -18px -> 56px |
| 881 | `.top` | d | - | never matched | no element has class top (index.src.html:13 is aside.side#top; no el(.., "top")) |
| 882 | `.rec-li,#p-record .rec-day,.ti-folded>li,.ov-rows>*` | b | views/record.css | 3252 states; phone/wide/mid; ev, today, study, progress, record, notes, system on button.fold-line.pm-more, div.rec-day | changes button.fold-line.pm-more content-visibility: auto -> visible |
| 887 | `a,button,input,select,textarea,label,summary,[role="tab"],[role="button"],[role="menuitem…` | b | base.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on button#tab-ev.tab, button#tab-today.tab | changes button#tab-ev.tab touch-action: manipulation -> auto |
| 888 | `button,[role="tab"],[role="button"],[role="menuitem"],summary,.seg` | a | - | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on button#tab-ev.tab, button#tab-today.tab | same computed result without it |
| 889 | `button,[role="tab"],[role="button"],[role="menuitem"],summary,label,.seg` | b | base.css | 3571 states; phone/wide/mid; ev, today, study, progress, record, notes, system on button#tab-ev.tab, button#tab-today.tab | changes button#tab-ev.tab cursor: default -> pointer |
| 890 | `a[href],a[href] *` | b | base.css | 28 states; phone/mid/wide; ev, notes, today, study, progress, record on a.cite.w, a.cite.w.on | changes a cursor: pointer -> text |
| 893 | `body.ev-booting #p-ev` | a | - | 97 states; phone/wide/mid; ev on section#p-ev.panel | same computed result without it |
