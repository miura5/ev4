# B-515 cleanup map: page/styles.css, page/ds/**, flower

Read-only map at main d482520 (Oct 29). Nothing in the repository was changed. Tools used (scratchpad, not repo):
`stat.cjs` (parses page/styles.css into 1570 rules and finds every class and id each needs in page/app/*.js,
page/index.src.html, page/theme.js), `cov.cjs` (boots the built staging page over the synthetic record like smoke.cjs,
at 390x844, 390x450, 735x830, 1280x860, 1920x1080, every tab and segment, up to 25 opens per view, and records which legacy
selectors ever match), `merge.cjs` -> `map.json`, and Appendix A below (one row per rule).

## 0. Counts

| kind | rules | what it means |
|---|---|---|
| dead | 74 (+5 selector lists with a dead half) | a class or id they need appears in no page source: delete, pixdiff must be 0 |
| base (element / :root only) | 43 | html, body, *, a, h1/h2, button/input/textarea/select, ::selection, [hidden], reduced motion, :root vars |
| single area | 991 | U1 187, V1 Today 270, V2 Study 106, E1 93, E2 107, E3 57, V3 Notes 93, V3 Record 63, P Progress 9, kit 6 |
| shared (rarest class/id used by 2+ areas) | 458 | see section 2 |
| at-rules (keyframes etc.) | 4 | |
| **!important in page/ds/** | **1731** | views 284, patterns 256, components 18 decls in 8 rules, tokens 0 real (2 in comments); page/styles.css has 13 lines / 14 decls |

Caveats: "single" is a static guess from the rarest token, so short common names (`.on`, `.open`, `.li`) can
overstate sharing. 776 of the 1496 non-dead rules never matched in the crawl (sessions, workouts, captions states,
sheets, dialogs, errors, read-only, larger text): pixdiff can't see them either (section 7, risk 1). P (Progress and
System) is almost gone from legacy already: 9 rules (L540-545, the weak-spots card that Progress reuses), System 0.

## 1. Where each area's rules sit (line ranges in page/styles.css)

- dead: 38-74 (.top-in, .top-right, .stg, .eyebrow), 99-111 (.wk-k, .ready-lead, .obj-*), 160-165 (.q-head,
  .bar-row), 227-232 (.daysep), 312-339 (.sk-mini, .sk-cur, .share-acts), 406-430 (.cap-cards-more, .bl-*, .sr-*,
  .card-line), 539-585 (.ws-lead, #weak-card, .sq-n, .next-line, the whole .trend-* chart, .ins-*), 611, 828-829,
  885, 974, 1125, 1148-1164 (.ti-hint, .tb-short, .ti-gap), 1228-1229 (.wk-props), 1535-1536 (.od-task). Partly dead
  lists: 498 and 833 (.bi-prep half), 554, 989, 1325: delete only the dead selector.
- V1 Today: 98, 1004, 1111-1490, 1577-1582, 1817 (a solid block, the easiest lane).
- V2 Study: 157-196 (runner: .q-stem, .opt, .mx), 338-345, 552-569, 794-796, 875, 1026, 1510-1575.
- V3 Record 1589-1669, 1945; V3 Notes 1821-1927, 1963-1964; V3 New 1073-1105 (shared with U1 because the New button
  sits in the shell header: .new-wrap, .new-fields, .new-body).
- E1 (done): 201-238, 268, 297, 367-403, 422-484, 595-596, 696-701, 735, 772-780, 864-884, 904-914, 950-958, 984-992, 1758.
- E2 (running, 62-66): 42, 272-277, 303-346 (skills panel, workout), 495, 537, 633, 788-812, 901-911, 953-957, 990-995, 1706-1743.
- E3 (running, 67, 69-72): 95-101, 241-244, 283-290, 408-413, 498-522 (prep, cards), 535-536, 587-592 (Your turn,
  kickoff), 833, 968-972, 988, 1445.
- U1 (running, shell): 39-71 (top bar, readout, tabs), 112, 166, 261-267, 525, 550, 598-762 (direction C shell, mh,
  sidebar, phone tab bar, PWA safe areas), 819-839, 941-962, 1089-1094, 1367, 1500-1504, 1681-1701, 1754-1818,
  1856-1858, 1934, 1959.

## 2. Shared rules: who depends on them, and how to retire each

| group (lines) | rules | used by | retire by |
|---|---|---|---|
| `body.captions ...` (354-466, 864-899) | 59 | E1 + kit (Message/Presence) | E window lane: E1 is done, so move the rules still in force into page/ds/views/ev.css (or the Message/Presence components); the rest are duplicates of what E1 moved |
| `.on-ev` (198, 352-353, 454, 530, 610 ...) | 20 | U1, E1, E2, kit | body-class layout switches: keep as a small shell pattern (patterns/shell.css) that U1 owns |
| `#today-list` x shell (1112-1119 ...) | 26 | V1 + U1 (`body.task-open`, `--panel-top`) | Today lane; the --panel-top math needs the base vars of section 4 first |
| `.tabs` (57-62), `.mh` (613-653), `.sbar`/`#sbar` (271-280, 785, 1708-1710), `.wrap` (68-70, 608-609), `.side`, `.cols` (528-531, 683-689), `.status`/`.note` (50-64) | 55 | U1 + every view | patterns/shell.css (U1's area): the pane, header, sidebar, two columns. Last lane |
| `.seg` (75-80) | 13 | every view, Progress bar, Study bar | already Segmented (04-segmented.css): delete once no view without data-ui='segmented' remains; grep the built page for `class="seg"` without data-ui first |
| `.btn`, `.primary`, `.icon`, `.tint` (135-146, 1006-1021, 1056-1057) | 18 | every area | Button component (01-button.css); a bare `button` reset to base. Delete after E2/E3/U1 have moved their buttons to data-ui='button' |
| `.li`, `.hov`, `.toolbar`, `.row`, `.tick` (88-91, 144-146, 1038-1062) | 16 | every list view + E | Line component (05-line.css); `.tick` is why 05-line says !important (legacy input.tick). Last lane |
| `.chip`, `.qchip`, `.qchips` (116-117, 256-260, 855, 922-926) | 24 | kit, Today, Notes, System, E1-E3, theme.js | Chip component; `.qchips` row is E1's: E window lane |
| `.card`, `.panel`, `.card-head`, `.ev-card` (65, 82-84, 239-240, 281-287, 536, 847) | 12 | all | Card component; `.ev-card` to E window |
| `.bubble`, `.msg`, `.msg-body`, `.thread`, `.dots` (207-233, 386-387, 412, 882-883) | 23 | E1-E3, System | Message component (16-message.css); E window lane |
| `.field`, `form`, inputs (147-152, 1051-1063) | 10 | kit, V2, E1-E3, U1 | base (element rules) + Field component |
| `.meter`, `.progress`, `.stat(s)`, `.mx`, `.chart`, `.energy` (120-132, 188-193, 247-253) | 20 | V2+P, P+E3, Record+E2+E3 | Meter component; `.mx` and `.chart` to the views that still draw them |
| `.fold-line`, `.chev`, `details>summary` (102, 113, 133, 416, 989) | 6 | kit, V2, E2, E3 | Fold component |
| `.readout`, `.top-av`, `.update`, `.evline`, `#ev-surf`, `#study-side`, `#ev-dates`, `.new-*`, `.ov-grid` | ~45 | two areas each | goes with whichever lane owns the second area (U1 or E) |
| `[hidden]` (27), `*`, html, body, a, h1/h2, button states (136-143), ::selection | base | everything | keep as base: page/ds/base.css in the base layer (section 5) |

## 3. The !important in page/ds/** and what stripping changes

Layer facts: the order is `reset, tokens, base, components, patterns, views, legacy`. Normal declarations: later layer
wins, so legacy beats everything and every moved view rule says !important just to beat it. Important declarations
run backwards: an earlier layer's !important beats a later one's, and any !important beats every normal declaration and
inline `style=`. Unlayered rules beat every layered normal rule.

- **views (284) and patterns (256): only work because of layer order.** With legacy gone they can all be stripped at
  once: inside one layer, a set where every declaration is important keeps the same winners when every one is made normal
  (same specificity, same order). Exceptions, which do change:
  1. **Inline styles from JS.** Today an !important beats `el.style`. `patterns/triage.css:28 .wk-list .pick-menu{left:0!important}`
     cancels 20-study.js:1109-1112 (B-499's shift-left so the objective menu stays on screen): stripping turns B-499 back
     on (a fix, but a visible change at 390 with the menu open). Also check `notes.css:39 #p-notes .n-cmenu{left,top!important}`
     against 25-notes.js:873-874 (askChip is another element, but confirm), `.fc-bar i`, `.pc-bar>i` (heights from
     30-progress.js:217), `.qz-bar` / `#rv-bar` widths (05-question-runner.js:179, 20-study.js:59), 22-flashcards.js:585/665
     fills. A declaration setting width/height/left/top on an element JS sizes stops overriding the JS.
  2. **Components' !important** (01-button 44-46, 03-chip 23, 05-line 27/29/33/36/37/47, 06-fold 14, 07-card 11): an
     important in components beats the same property important in views, so a view that sets an input.tick border, a
     `.nm`/`.title` button's padding or font, or a fold head's display today *loses*. Strip components and views in the
     same commit, or that view rule suddenly wins. List each view rule on `[data-ui='line'] > input.tick`,
     `button.nm`/`.title`, `.fold-line`, `[data-kind='quiet']` card, hover-state buttons and pixdiff it.
  3. **Hidden-state hacks** `[hidden][hidden][hidden]:not(#_):not(#_){display:none!important}` (views/record.css:69,
     views/notes.css:52) and the `X:not([hidden]){display:...!important}` / `X[hidden]{display:none!important}` pairs
     (runner.css 12, 15, 34, 77, 93; triage.css 6, 29, 35; plan-card.css 8, 13, 39; study.css 103; progress.css 12, 15,
     22, 55). Once stripped, a normal `display:flex` beats the browser's `[hidden]` (author beats UA). These stay correct
     only if a `[hidden]{display:none!important}` lives in an *early* layer (base). Then the specificity hacks and every
     `[hidden]{display:none!important}` in the views can go, and `:not([hidden])` guards may stay as plain selectors.
  4. Unlayered CSS: theme.js writes `color-scheme` unlayered (theme.js ~283), and the harness/host skeleton adds
     unlayered `body{margin:0}` and `[hidden]{display:none!important}`. Harmless today, but an unlayered normal beats every
     stripped view rule on the same property, so the token lint should refuse new unlayered CSS.
- **Components (8 rules, 18 declarations)** exist only to beat legacy's `button`, `input.tick`, `.btn:hover`, `.card`
  and `.fold-line` rules: strip when those legacy rules go (shared lane).
- **page/styles.css's own 14**: `[hidden]` (L27) and the reduced-motion blocks (L300, L982) move to base and *keep*
  !important; the seven view-only `display:none` ones (1176, 1263, 1456, 1503 `#seg-study`, 1747 `[data-readonly]`,
  1821-1822 `#tab-notes`/`#p-notes` under 1024) are behaviour, not look: each moves to its view file (normal is enough
  once legacy is gone, but `#seg-study{display:none}` and the notes ones must still beat Segmented/shell `display` rules:
  check that). `.n-stb` colour (1860) goes with Notes.

## 4. Custom properties: --line-h and other shadows

- **--line-h collision (live bug, now).** tokens.css:58/64 defines `--line-h` as the row height (32px, 44px on phone
  or coarse). Legacy `:root{--line-h:0px}` (styles.css:1675) is in the strongest normal layer, and 90-render.js:217/222
  writes `--line-h` inline on `<html>` as the status-line height. So any `var(--line-h)` in a component would get 0px or
  the status line's height. Nothing in page/ds reads `var(--line-h)` yet (05-line.css and 12-field.css work around it
  in comments; 12-field.css:20 repeats the media query). Fix: rename the status-line one to `--status-h` (90-render.js
  217, 222; styles.css 1367, 1455, 1675, 1686, 1818, 1852), in U1's file, so this goes in the last lane or goes to U1 as a
  two-line hand-off.
- **--tap**: both define 44px; legacy's goes.
- **--info and --violet (trap).** Legacy's :root makes them grey (`var(--quiet)`); theme.js generates real blue/violet.
  components 01-button.css:7-10 (`--x` for data-tone info/violet/proposed/plum), 02-badge, 03-chip, 08-notice, and the
  JS (2 refs each) read them. Dropping legacy's :root turns every info/violet/proposed tone blue/violet: a visible change
  and a D-381/D-270 question (neutral interface). Before dropping, either map those tones to `--quiet` in the components
  or decide on purpose. `--warn` and `--bad` are the same colour either way (tokens.css:77-81 already says this).
- **Non-colour legacy vars that page/ds reads**, which must move to tokens.css *before* legacy's :root goes, or
  ds rules lose them: `--ts` (69 ds reads; set only at styles.css:980-981, `[data-text="larger"]` 1.125), `--sans` (53),
  `--mono` (4), `--tap` (16), `--x` (10, set by tone rules), `--dock-h`, `--panel-top`, `--right-w`, plus legacy-only layout
  vars the moved shell rules will need: `--mh-h` (15), `--strip-h` (7), `--top-h` (7), `--side-w`, `--pane-l`, `--pane-r`,
  `--stage-h` (JS writes it), `--fh`, `--r` (22px cards; awaiting the card-radius decision), `--ease` (15, -> `--ease-out`).
- Colour aliases with ds readers: `--ink2` (plan-card.css:114), `--accent` (system.css:9), `--chip`, `--warn`, `--bad`.
  Every other alias (`--ink` 29, `--soft` 45, `--glass`, `--glass2`, `--accent-*`, `--plum*`, `--violet-ink`, `--card`
  0 readers, `--serif` 0, `--info-bg`, `--bad-solid`, `--warn-solid`) is read only by legacy and dies with it. tokens.css
  66-99 already has the retirement map: follow it.

## 5. Hidden-state and reduced-motion traps

1. **No base layer exists.** LAYER_ORDER names `reset` and `base`, but STYLE_LAYERS (tools/build.mjs:62-69) feeds
   neither; `[hidden]` and both reduced-motion blocks live only in legacy. Dropping legacy without first adding
   page/ds/base.css (and a build entry) loses them: hidden panels show and take taps (B-390), and motion ignores the
   setting.
2. **Reduced motion is weakest where it should be strongest.** Legacy's `*{transition:none!important;animation:none!important}`
   (L300, L982) sits in the *last* layer, so its !important loses to any !important transition or animation in
   components, patterns or views (layer order runs backwards for important). Moved to base it becomes the strongest.
   tokens.css:66-67 collapses `--dur-*` too, but raw durations in views (the token lint's job) and her own animations are
   only stopped by the `*` rule. 466 and 983-984 (captions reveal, `#ev-side` slide-in) are normal declarations: move to
   ev.css with the E window.
3. `[data-motion="reduce"]` (L982-984) is the in-app setting: it must move with the media query, both selectors.
4. The view `[hidden]` hacks (section 3.3) are only safe to delete after base exists.
5. `transition:none` / `animation:none` in components 01-button:41 and 08-notice:14 are normal and fine.
6. `#seg-study{display:none!important}` (L1503), `[data-readonly] #composer,#new-wrap` (L1747) and the notes
   `display:none` under 1024 (L1822) are behaviour: losing one shows a control that must not show (the read-only page
   shows a composer). The smoke tier doesn't check read-only: prove them with run.cjs or a one-off check.

## 6. Everything named "flower"

The Dial Arc is what's drawn; only the names are left over.

- spec/ev.spec.json:5866 key `ui.look.flower` (sizes, budget), 5872 its `_` text, 5577 the Silk core's `retired` text.
  (spec/schemas: no hit.)
- Readers of the key: tools/build.mjs:384 (comment) and 396 (`flower: { sizes: v.flower.sizes }` into the page's spec),
  page/app/60-ev-conversation.js:717 (comment) and 721 (`EV_SPEC.ui.look.flower.sizes`), test/flower-spec.test.mjs:1,
  11, 18, 29 (rename the file too), test/harness/core.cjs:46, test/harness/captions.cjs:1979 (and 441, 531, 1973, 2047
  check names), test/motion.test.mjs:2 (comment).
- Comments: page/app/01-ui-15-presence.js:1-2, 02-navigation.js:103 (U1's file), 60-ev-conversation.js:56, 744,
  61-ev-captions.js:150, page/ds/components/15-presence.css:1, page/styles.css:599 and 881 (they die with legacy),
  core/motion.mjs:211, test/harness/run.cjs:2828, 3395, 6163-6164 (names) and 6897-6966 (variable), captions.cjs:660,
  test/tenet-sweep.test.mjs:56.
- The class `svg.fl` (60-ev-conversation.js:553 `'fl dial'`, styles.css:202 `.ev-av .fl`, run.cjs:2832
  `#hero svg.fl`): `fl` is short for flower. Rename optional (to `.dial`, which it already carries); if renamed, those
  three move together.
- Generated or ignored, so don't edit: pwa/public/* (gitignored), DECISIONS.md, CHANGELOG.md, docs/trim/scan/*,
  docs/design/ui-polish/* (a snapshot).
- Suggested key: `ui.look.dialArc` (same shape). The rename's three parts land in one commit: spec, build.mjs:396, and
  60-ev-conversation.js:721, so the built page and the spec never disagree.

## 7. Risks, ranked

1. **pixdiff is blind to most of what's being deleted.** It shoots each tab/segment at rest, at 390 and 1280, light and
   dark, with reduced motion. 776 live legacy rules never matched in a broader crawl: study sessions, workouts, the skills
   panel, captions states, sheets, menus, dialogs, error and boot lines, read-only, larger text, 390x450. A wrong
   deletion there passes pixdiff. Mitigation: each lane also runs the harnesses for its area (captions.cjs, notes.cjs,
   run.cjs, panel.cjs, prep.cjs, components.cjs) and `npm run check -- --touched`, and deletes only rules that are dead or
   proven duplicated by a ds rule that says the same thing.
2. **Dropping legacy's :root before its vars move**: `--ts`, `--sans`, `--tap`, `--mono`, `--x`, the layout vars. Text
   scale, fonts and tap sizes break everywhere at once. Plus `--info`/`--violet` turn from grey to blue/violet
   (a look decision, section 4).
3. **No base layer**: hidden panels show, motion ignores the setting (section 5.1-5.2).
4. **The strip order between components and views** (section 3.2) and **inline styles** (3.1; B-499's pick menu). Strip
   per file with pixdiff per file, not by one regex over page/ds.
5. **Running lanes**: E2, E3 and U1 are still moving rules out of these same lines; deleting a rule they're about to
   move, or stripping !important in a file they're adding to, causes conflicts or a lost look. Their areas go last.
6. **One file, many lanes**: every lane edits page/styles.css. Rules are interleaved (shared and single rules alternate in
   31-172 and 598-1000), so lanes must only delete within their own line ranges, rebase before each push, and never
   reorder (order inside legacy is the cascade).
7. **--line-h**: renaming means editing 90-render.js (U1); until then, nothing in ds may read `var(--line-h)`.
8. Static ownership is approximate (common names); Appendix A's "single" is a starting point, and pixdiff plus the
   harnesses are the proof.
9. Token lint thresholds (7 font sizes, 12 spacings, 7 radii, 5 durations per tools/token-audit.mjs): raw values left in
   moved views ("Raw values left are those with no token", study.css header) may break the budget; run the audit first and
   fold by the tokens.css map.

## 8. Proposed B-515 lanes

Every lane: commit per group, `node tools/build.mjs && npm test && npm run smoke`, `node tools/pixdiff.cjs origin/main`
(0 changed pixels at --tol 8 in every shot; any red diff is a lost rule, so restore it and move it instead), plus the
harnesses named, and rebase before each push. Only deletions inside the lane's own line ranges; nothing reordered.

**Lane A: Foundation (first, alone, about 1 h; everything else waits for it)**
- Files: tools/build.mjs (STYLE_LAYERS gets `['base','page/ds/base.css']`), new page/ds/base.css, page/ds/tokens.css,
  page/styles.css lines 10-34, 72-73, 133-152, 300, 604-606, 644, 671-710 (:root/html/body only), 980-984.
- Moves: `[hidden]{display:none!important}` and both reduced-motion blocks (keeping !important) into base; element base
  rules (*, html, body, a, ::selection, h1/h2, button/input/select/textarea defaults) into base; `--ts` (+larger),
  `--sans`, `--mono`, `--r`, `--ease`, `--top-h`, `--dock-h` and the other non-colour layout vars into tokens.css. Legacy's
  colour-alias block moves into tokens.css as a fenced "retired aliases, B-515" block with `--info`/`--violet` kept grey,
  so nothing changes colour yet.
- Deletes: the 74 dead rules and the dead halves of 498, 554, 833, 989, 1325 (section 1), and legacy's duplicate `--tap`.
- Proof: pixdiff 0; smoke; a check that a `[hidden]` panel with a view `display:flex` stays hidden, and reduced
  motion stops a component transition.

**Lane B: Today, Study, Progress/System (after A; parallel with C)**
- Files: page/styles.css V1 (98, 1004, 1111-1490, 1577-1582, 1817), V2 (157-196, 338-345, 552-569, 794-796, 875, 1026,
  1510-1575), P (540-545) and the shared rules whose other area is only U1 for #today-list/#study-side/.ov-grid/.new-body;
  page/ds/views/today.css, study.css, progress.css, system.css, page/ds/patterns/runner.css, triage.css, plan-card.css.
- Order: Today, then Study, then Progress/System. For each one, delete the legacy rules now overridden, move any still in
  force, then strip that view's !important file by file. Drop the views' own `[hidden]{display:none!important}` lines. Fix
  triage.css:28 (keep B-499's inline left). Move `#seg-study` (1503) and the Today `display:none` ones (1176, 1263, 1456).
- Proof: pixdiff 0, plus run.cjs's Today/Study checks, panel.cjs, prep.cjs, paint.cjs answer flows, and smoke's
  check-off and review.

**Lane C: Notes, Record, New, and the flower rename (after A; parallel with B)**
- Files: page/styles.css V3 Record (1589-1669, 1945), Notes (1821-1927, 1963-1964, including 1821-1822 and 1860),
  page/ds/views/notes.css, record.css (remove the `[hidden][hidden][hidden]` hacks once A's base exists); the flower
  files in section 6 except 02-navigation.js (U1's: its one comment goes to lane D) and styles.css 599/881 (they die with
  legacy).
- New's rules (1073-1105) sit in the shell header and stay for lane D.
- Proof: pixdiff 0; notes.cjs; test/flower-spec.test.mjs (renamed) plus core.cjs and captions.cjs stage-size checks.

**Lane D: E window, shell, shared kit, drop legacy, token lint (last: starts only after E2, E3 and U1 have landed, and B and C)**
- Files: every remaining line of page/styles.css (E1/E2/E3 201-522, 587-596, 772-1000; U1 39-71, 598-762, 1681-1818;
  shared kit 31-172, 1004-1063; New 1073-1105); page/ds/components/*.css (strip their 18); new
  page/ds/views/ev.css and patterns/shell.css if E/U1 didn't make them; page/app/90-render.js:217/222 (`--line-h` ->
  `--status-h`); 02-navigation.js:103 comment; tools/build.mjs (remove the legacy entry and `legacy` from LAYER_ORDER);
  delete page/styles.css; tools/token-audit.mjs + an npm test check (raw colour, font size, radius, duration outside
  tokens.css; no unlayered CSS).
- Order: E window (captions, .bubble/.msg/.qchips, `.ev-card`, `#ev-*`), then shell (.mh, .sbar, .tabs, .wrap, .cols,
  .side, .on-ev, .status, New), then the shared kit (.btn, .seg, .li, .chip, .card, .tick, .field: delete once no markup
  lacks its data-ui), then strip the components' and the remaining views' !important in one commit, then retire the alias
  block from A (by the tokens.css map, and decide the `--info`/`--violet` look), drop legacy, add the lint, then run the
  audit and fold raw values until it's under budget.
- Can split into D1 (E window) and D2 (shell + kit + drop + lint) if E2/E3 land well before U1; D2 still goes last.
- Proof: pixdiff 0 at every step; captions.cjs, greet.cjs, frame.cjs, shell.cjs, components.cjs, contrast.cjs (the
  alias/--info step), smoke; `npm run check -- --touched` before ship staging.

Still-moving areas to leave alone until their lane lands: E2's 272-346, 495, 537, 633, 788-812, 901-911, 953-957,
990-995, 1706-1743; E3's 95-101, 241-244, 283-290, 408-413, 498-522, 535-536, 587-592, 833, 968-972, 988, 1445; U1's
ranges in section 1, plus 02-navigation.js, 90-render.js and index.src.html.

## Appendix A: every rule in page/styles.css (at d482520)

kind: dead (a class or id it needs appears in no page source), base (element/:root only), single (its rarest class/id appears in one area only), shared. crawl: matched at least once in the synthetic crawl (5 sizes, every tab and segment, up to 25 opens per view). Areas by page/app file: U1 = 00,02,03,90 + index.src.html; kit = 01-kit,01-ui-*,04,91; V1 = 10; V2 = 05,20-22; V3 = 25 notes, 40 record, 80 new; P = 30 progress, 50 system; E1 = 60,61,68,73-75; E2 = 62-66; E3 = 67,69-72.

| line | kind | areas | crawl | media | selector |
|---|---|---|---|---|---|
| 10 | base |  | yes |  | `:root` |
| 23 | base |  | yes | (prefers-color-scheme:light) | `:root:not([data-theme="dark"])` |
| 24 | base |  | no |  | `:root[data-theme="light"]` |
| 25 | base |  | yes |  | `*` |
| 27 | base |  | yes |  | `[hidden]` |
| 28 | base |  | yes |  | `html` |
| 29 | base |  | yes |  | `body` |
| 31 | shared | E1+U1 | yes |  | `.sr` |
| 32 | base |  | no |  | `a` |
| 34 | base |  | yes |  | `::selection` |
| 36 | shared | kit+U1+V2-study+V1-today+V3-notes+P-progress+P-system+E1+E2+E3 | no |  | `.top` |
| 38 | dead |  | no |  | `.top-in` |
| 39 | single | U1 | yes |  | `.brand` |
| 40 | single | U1 | yes |  | `.brand:hover` |
| 41 | shared | E1+U1 | yes |  | `.top-av` |
| 42 | single | E2 | yes |  | `body.on-ev.opening .top-av,body.on-ev.in-session .top-av,body.on-ev.core-big .top-av` |
| 43 | single | U1 | yes |  | `.brand-txt` |
| 44 | single | U1 | yes |  | `.wordmark` |
| 45 | dead | U1 | no |  | `.wordmark .stg` |
| 46 | shared | E1+U1 | yes |  | `.readout` |
| 47 | shared | E1+U1 | yes |  | `.readout .led` |
| 48 | shared | E1+U1 | no |  | `.readout .led.busy` |
| 48 | shared | E1+U1 | no |  | `.readout .led.off` |
| 48 | shared | E1+U1 | no |  | `.readout .led.brk` |
| 49 | dead |  | no |  | `.top-right` |
| 50 | shared | kit+U1+V1-today+V2-study+V3-notes+P-progress+V3-record+P-system+E2+E3+E1 | yes |  | `.status` |
| 51 | shared | kit+U1+V1-today+V2-study+V3-notes+P-progress+V3-record+P-system+E2+E3+E1 | no |  | `.status:not(.ok)` |
| 51 | shared | kit+U1+V1-today+V2-study+V3-notes+P-progress+V3-record+P-system+E2+E3+E1 | no |  | `.status.note` |
| 52 | single | U1 | yes |  | `.tab-sys` |
| 53 | single | U1 | yes |  | `.tab-sys:hover` |
| 53 | single | U1 | yes |  | `.tab-sys[aria-current="page"]` |
| 55 | shared | kit+U1+V1-today+V2-study+V3-notes+P-progress+V3-record+P-system+E2+E3+E1 | yes | (max-width:1023px) | `.status.ok,.status.note` |
| 55 | dead |  | no | (max-width:1023px) | `.top-in` |
| 55 | shared | kit+U1+V1-today+V2-study+V3-notes+P-progress+V3-record+P-system+E2+E3+E1 | no | (max-width:1023px) | `.status:not(.ok)` |
| 57 | shared | U1+V2-study+V3-notes+V3-record+E2 | yes |  | `.tabs` |
| 58 | shared | U1+V2-study+V3-notes+V3-record+E2 | yes |  | `.tabs .tab` |
| 59 | shared | U1+V2-study+V3-notes+V3-record+E2 | yes |  | `.tabs .tab svg` |
| 60 | shared | U1+V2-study+V3-notes+V3-record+E2 | yes |  | `.tabs .tab span` |
| 61 | shared | U1+V2-study+V3-notes+V3-record+E2 | yes |  | `.tabs .tab:hover` |
| 62 | shared | U1+V2-study+V3-notes+V3-record+E2 | yes |  | `.tabs .tab[aria-selected="true"]` |
| 63 | shared | U1+V2-study+V3-notes+V3-record+E2 | yes | (min-width:1024px) | `.tabs .tab` |
| 63 | shared | U1+V2-study+V3-notes+V3-record+E2 | yes | (min-width:1024px) | `.tabs .tab span` |
| 64 | single | U1 | yes | (min-width:1024px) | `.brand` |
| 64 | shared | kit+U1+V1-today+V2-study+V3-notes+P-progress+V3-record+P-system+E2+E3+E1 | yes | (min-width:1024px) | `.status` |
| 65 | shared | kit+U1+V2-study+V1-today+V3-notes+P-progress+V3-record+E1+E2+E3 | yes |  | `.panel .card` |
| 66 | dead |  | no | (max-width:420px) | `.top-in` |
| 66 | shared | U1+V2-study+V3-notes+V3-record+E2 | yes | (max-width:420px) | `.tabs` |
| 66 | shared | U1+V2-study+V3-notes+V3-record+E2 | yes | (max-width:420px) | `.tabs .tab` |
| 66 | dead |  | no | (max-width:420px) | `.top-right` |
| 68 | shared | V2-study+V3-notes+E2+E3+U1 | yes |  | `.wrap` |
| 70 | shared | V2-study+V3-notes+E2+E3+U1 | yes | (max-width:1023px) | `.wrap` |
| 71 | single | U1 | yes |  | `.ptitle` |
| 72 | base |  | yes |  | `h1` |
| 73 | base |  | yes |  | `h2` |
| 74 | dead |  | no |  | `.eyebrow` |
| 75 | shared | kit+U1+V1-today+V2-study+V3-notes+P-progress+P-system+E2+E3 | yes |  | `.seg` |
| 76 | shared | kit+U1+V1-today+V2-study+V3-notes+P-progress+P-system+E2+E3 | yes |  | `.seg::-webkit-scrollbar` |
| 77 | shared | kit+U1+V1-today+V2-study+V3-notes+P-progress+P-system+E2+E3 | yes |  | `.seg button` |
| 78 | shared | kit+U1+V1-today+V2-study+V3-notes+P-progress+P-system+E2+E3 | yes |  | `.seg button:hover` |
| 79 | shared | kit+U1+V1-today+V2-study+V3-notes+P-progress+P-system+E2+E3 | yes |  | `.seg button[aria-pressed="true"]` |
| 80 | shared | kit+U1+V1-today+V2-study+V3-notes+P-progress+P-system+E2+E3 | yes | (max-width:599px) | `.seg` |
| 80 | shared | kit+U1+V1-today+V2-study+V3-notes+P-progress+P-system+E2+E3 | yes | (max-width:599px) | `.seg button` |
| 82 | shared | kit+U1+V2-study+V1-today+V3-notes+P-progress+V3-record+E1+E2+E3 | yes |  | `.panel` |
| 83 | shared | kit+U1+V2-study+V1-today+P-progress+V3-record+P-system+E1+E2+E3 | yes |  | `.card` |
| 84 | shared | E3+U1 | yes |  | `.card-head` |
| 86 | shared | V2-study+V1-today+V3-notes+P-system+E2+E3+U1 | yes |  | `.big` |
| 87 | shared | kit+U1+V2-study+V1-today+V3-notes+P-progress+V3-record+P-system+E1+E2+E3+V3-new | yes |  | `.list` |
| 88 | shared | kit+U1+V2-study+V1-today+V3-notes+P-progress+V3-record+P-system+E2+E3+E1 | yes |  | `.row` |
| 89 | shared | kit+U1+V2-study+V1-today+V3-notes+P-progress+V3-record+P-system+E2+E3+E1 | yes |  | `.row:first-child` |
| 90 | shared | kit+V2-study+E2+E3+E1+U1 | no |  | `.row .grow` |
| 91 | shared | kit+U1+V2-study+V1-today+V3-notes+P-progress+V3-record+P-system+E2+E3+E1 | no |  | `.row .title` |
| 92 | shared | kit+V2-study+V1-today+V3-notes+P-progress+V3-record+E1+E2+E3+U1 | no |  | `.row.done .title` |
| 93 | shared | kit+V2-study+V1-today+P-progress+V3-record+P-system+E2+E3+E1+U1 | yes |  | `.meta` |
| 95 | single | E3 | yes |  | `.week-item` |
| 96 | single | E3 | yes |  | `.wk-line` |
| 97 | single | E3 | yes |  | `.wk-line:focus-visible,.fold-line:focus-visible` |
| 98 | single | V1-today | yes |  | `.ti-t,.wk-t` |
| 99 | dead |  | no |  | `.wk-k` |
| 100 | dead | kit+E3 | no |  | `.wk-k.urgent` |
| 101 | single | E3 | yes |  | `.week-item .when` |
| 102 | shared | kit+V2-study+E2+E3+U1 | yes |  | `.fold-line` |
| 104 | dead |  | no |  | `.ready-lead` |
| 105 | dead |  | no |  | `.obj-item` |
| 106 | dead |  | no |  | `.obj-line` |
| 107 | dead |  | no |  | `.obj-line:focus-visible` |
| 108 | dead |  | no |  | `.obj-t` |
| 109 | dead |  | no |  | `.obj-n` |
| 110 | dead |  | no |  | `.obj-more` |
| 110 | dead | kit+U1+V2-study+V1-today+V3-notes+P-progress+P-system+E1+E2+E3+V3-new | no |  | `.obj-item.open .obj-more` |
| 111 | dead | kit+V2-study+V1-today+P-progress+V3-record+P-system+E2+E3+E1+U1 | no |  | `.obj-more .meta` |
| 112 | single | U1 | yes |  | `.fold-card` |
| 112 | single | U1 | yes |  | `.fold-card .fold-line` |
| 113 | shared | kit+V2-study+E2+E3+U1 | yes |  | `.fold-line::after` |
| 113 | shared | kit+V2-study+E2+E3+U1 | no |  | `.fold-line[aria-expanded=true]::after` |
| 114 | shared | kit+U1+V2-study+V1-today+V3-notes+P-progress+V3-record+P-system+E1+E2+E3+V3-new+theme.js | yes |  | `.when` |
| 115 | shared | kit+V2-study+V1-today+E1+E2+E3+U1 | no |  | `.chips` |
| 116 | shared | kit+V1-today+V3-notes+P-system+E2+E3+E1+U1+theme.js | no |  | `.chip` |
| 117 | shared | kit+V1-today+E3+theme.js | no |  | `.chip.accent` |
| 117 | shared | kit+V1-today+V3-notes+P-system+E2+E3+E1+U1+theme.js | no |  | `.chip.ok` |
| 118 | shared | kit+V1-today+V3-notes+P-system+E2+E3+E1+U1+theme.js | no |  | `.chip.warn` |
| 118 | shared | kit+V1-today+V3-notes+P-system+E2+E3+E1+theme.js | no |  | `.chip.bad` |
| 119 | shared | kit+V1-today+P-system+E2+E3+theme.js | no |  | `.chip.info` |
| 119 | shared | kit+V1-today | no |  | `.chip.plum` |
| 120 | shared | V2-study+E1 | no |  | `.stats` |
| 121 | shared | kit+V1-today | no |  | `.stat` |
| 122 | shared | kit+V1-today | no |  | `.stat b` |
| 123 | shared | kit+V1-today | no |  | `.stat span` |
| 124 | shared | V2-study+E1 | no | (max-width:420px) | `.stats` |
| 124 | shared | V2-study+E1 | no | (max-width:420px) | `.stats .stat:last-child` |
| 125 | shared | kit+V1-today+V2-study+V3-notes+P-progress+V3-record+E1+E2+E3+V3-new+U1 | yes |  | `.empty` |
| 126 | shared | V2-study+V3-notes+E1 | no |  | `.scroll` |
| 127 | single | kit | no |  | `table.tbl` |
| 128 | single | kit | no |  | `table.tbl th` |
| 129 | single | kit | no |  | `table.tbl td` |
| 130 | single | kit | no |  | `table.tbl .num` |
| 131 | shared | kit+P-progress+E3 | no |  | `.meter` |
| 131 | shared | kit+P-progress+E3 | no |  | `.meter i` |
| 132 | shared | kit+U1+V2-study+P-progress+E1+E2+E3 | yes |  | `.progress` |
| 132 | shared | kit+U1+V2-study+P-progress+E1+E2+E3 | yes |  | `.progress i` |
| 133 | base |  | no |  | `details>summary` |
| 135 | shared | kit+U1+V2-study+V1-today+V3-notes+P-progress+V3-record+E1+E2+E3 | yes |  | `button,.btn` |
| 136 | base |  | yes |  | `button:hover` |
| 137 | base |  | yes |  | `button:active:not(:disabled)` |
| 139 | shared | kit+U1+V2-study+V1-today+V3-notes+V3-record+E2+E3+E1 | yes |  | `button.primary` |
| 140 | shared | kit+U1+V2-study+V1-today+V3-notes+V3-record+E2+E3+E1 | yes |  | `button.primary:hover` |
| 141 | shared | kit+V2-study+P-progress+E3+theme.js | no |  | `button.violet` |
| 142 | base |  | yes |  | `button:disabled` |
| 143 | base |  | yes |  | `button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:f` |
| 144 | shared | kit+V1-today+V2-study+V3-notes+E1+E2+E3 | yes |  | `input.tick` |
| 145 | shared | kit+V1-today+V2-study+V3-notes+E1+E2+E3 | yes |  | `input.tick:checked` |
| 146 | shared | kit+V1-today+V2-study+V3-notes+E1+E2+E3 | yes |  | `input.tick:checked::after` |
| 147 | base |  | yes |  | `form` |
| 148 | shared | V1-today+E3 | no |  | `.fields` |
| 149 | base |  | yes |  | `input[type=text],input[type=date],input[type=number],select,textarea` |
| 150 | base |  | yes |  | `select option` |
| 151 | base |  | yes |  | `input::placeholder,textarea::placeholder` |
| 152 | base |  | yes |  | `textarea` |
| 153 | shared | kit+U1+V2-study+V1-today+V3-notes+E1+E2+E3+theme.js | no |  | `button.quiet` |
| 154 | shared | kit+V2-study+P-progress+E2+E3+U1 | no |  | `.actions` |
| 155 | shared | kit+V2-study+E2+E3+E1+U1 | no |  | `.actions .grow` |
| 157 | single | V2-study | no |  | `.actions .q-back` |
| 158 | single | V2-study | yes |  | `.card-head .pr-fold` |
| 160 | dead |  | no |  | `.q-head` |
| 161 | shared | V2-study+V1-today+E2+E3 | yes |  | `.stem` |
| 163 | single | V2-study | yes |  | `.q-stem` |
| 164 | single | V2-study | no |  | `.q-tags` |
| 165 | dead |  | no |  | `.bar-row` |
| 165 | dead | kit+U1+V2-study+P-progress+E1+E2+E3 | no |  | `.bar-row .progress` |
| 165 | dead | kit+V2-study+V1-today+P-progress+V3-record+P-system+E2+E3+E1+U1 | no |  | `.bar-row .meta` |
| 166 | single | U1 | yes |  | `.more-line` |
| 167 | shared | V2-study+U1 | yes |  | `#more-btn` |
| 168 | shared | kit+V2-study+P-system+E3+V3-new | yes |  | `.opts` |
| 169 | shared | kit+V2-study+E1 | yes |  | `.opt` |
| 170 | shared | kit+V2-study+E1 | yes |  | `.opt:hover` |
| 171 | shared | kit+V2-study+E1 | yes |  | `.opt input` |
| 172 | shared | kit+V2-study+E1 | no |  | `.opt.right` |
| 172 | shared | kit+V2-study+E1 | no |  | `.opt.wrong` |
| 174 | single | V2-study | no |  | `.num-row` |
| 175 | single | V2-study | no |  | `.num-in` |
| 176 | single | V2-study | no |  | `.num-row.right .num-in` |
| 176 | single | V2-study | no |  | `.num-row.wrong .num-in` |
| 177 | single | V2-study | no |  | `.num-unit` |
| 178 | single | V2-study | no |  | `.num-answer` |
| 180 | single | V2-study | no |  | `.open-in` |
| 181 | single | V2-study | no |  | `.open-given` |
| 182 | single | V2-study | no |  | `.open-points` |
| 183 | single | V2-study | no |  | `.open-points li.hit` |
| 183 | single | V2-study | no |  | `.open-points li.miss` |
| 184 | single | V2-study | no |  | `.open-added` |
| 185 | single | V2-study | no |  | `.num-steps` |
| 186 | single | V2-study | no |  | `.opt.locked` |
| 187 | shared | kit+V2-study+V1-today+V3-notes+P-system+E2+E3+E1 | no |  | `.why` |
| 188 | shared | V2-study+P-progress | no |  | `table.mx` |
| 189 | shared | V2-study+P-progress | no |  | `table.mx th` |
| 190 | shared | V2-study+P-progress | no |  | `table.mx th:first-child` |
| 191 | shared | V2-study+P-progress | no |  | `table.mx td` |
| 192 | shared | V2-study+P-progress | no |  | `table.mx td:first-child` |
| 193 | shared | V2-study+P-progress | no |  | `table.mx td:last-child` |
| 194 | shared | V2-study+P-progress | no |  | `table.mx tr.right td` |
| 194 | shared | V2-study+P-progress | no |  | `table.mx tr.wrong td` |
| 195 | shared | V2-study+P-progress | no |  | `table.mx input` |
| 196 | single | V2-study | no |  | `.verdict` |
| 196 | single | V2-study | no |  | `.verdict.ok` |
| 196 | single | V2-study | no |  | `.verdict.no` |
| 197 | shared | kit+U1+V2-study+V1-today+V3-notes+E1+E2+E3+V3-new | yes |  | `.toast` |
| 198 | shared | U1+E1 | yes |  | `body.on-ev .toast` |
| 201 | single | E1 | yes |  | `.ev-av` |
| 202 | single | E1 | yes |  | `.ev-av .fl` |
| 203 | single | E1 | yes |  | `.ev-av .c1` |
| 203 | single | E1 | yes |  | `.ev-av .c2` |
| 203 | single | E1 | no |  | `.ev-av .under` |
| 205 | shared | E1+U1 | yes |  | `.hero` |
| 206 | single | E1 | yes |  | `body.opening .hero,body.core-big .hero` |
| 207 | shared | E1+E2+E3+U1 | yes |  | `.thread` |
| 208 | shared | E1+E2+E3+U1 | no |  | `.thread>button` |
| 209 | shared | P-system+E1+E2 | yes |  | `.msg` |
| 210 | shared | P-system+E1+E2 | no |  | `.msg.matt` |
| 211 | single | E1 | yes |  | `.msg-body` |
| 212 | single | E1 | yes |  | `.msg.ev .msg-body` |
| 213 | single | E1 | no |  | `.msg.matt .msg-body` |
| 214 | single | E1 | yes |  | `.av-slot` |
| 215 | shared | E1+U1 | no |  | `.bubble` |
| 216 | shared | E1+U1 | no |  | `.msg.ev .bubble` |
| 217 | shared | E1+U1 | no |  | `.msg.matt .bubble` |
| 218 | shared | E1+U1 | no |  | `.bubble p` |
| 218 | shared | E1+U1 | no |  | `.bubble p+p,.bubble p+ul,.bubble ul+p` |
| 219 | shared | E1+U1 | no |  | `.bubble ul` |
| 219 | shared | E1+U1 | no |  | `.bubble li+li` |
| 220 | shared | E1+U1 | no |  | `.bubble b` |
| 221 | shared | E1+U1 | no |  | `.bubble a` |
| 222 | shared | E1+U1 | no |  | `.msg.ev .bubble.err` |
| 223 | single | E1 | yes |  | `.msg-cards` |
| 224 | single | E1 | yes |  | `.msg-cards:empty` |
| 225 | single | E1 | yes |  | `.msg-meta` |
| 226 | single | E1 | no |  | `.msg-meta button` |
| 227 | dead | kit+U1+V2-study+V1-today+V3-notes+P-progress+V3-record+P-system+E1+E2+E3+V3-new | no |  | `.list .daysep-row` |
| 228 | dead |  | no |  | `.daysep` |
| 229 | shared | E1+U1 | no |  | `.dots` |
| 229 | shared | E1+U1 | no |  | `.dots i` |
| 230 | shared | E1+U1 | no |  | `.dots i:nth-child(2)` |
| 230 | shared | E1+U1 | no |  | `.dots i:nth-child(3)` |
| 232 | dead | E1+E2+E3+U1 | no |  | `body.opening .thread.today-only .daysep` |
| 233 | shared | E1+E2+E3 | yes |  | `body.opening .msg.greet` |
| 234 | single | E1 | yes |  | `body.opening .msg.greet>.ev-av,body.opening .msg.greet>.av-slot,body.opening .msg.greet .msg-meta` |
| 235 | single | E1 | yes |  | `body.opening .msg.greet .msg-body` |
| 236 | shared | E1+E2+E3 | no |  | `body.opening .msg.greet .bubble` |
| 237 | shared | E1+E2+E3 | no |  | `body.opening .msg.greet .bubble p:first-child` |
| 238 | single | E1 | yes |  | `body.opening .msg.greet .msg-cards` |
| 239 | shared | V1-today+E1+U1 | no |  | `.ev-card` |
| 240 | shared | V1-today+E1+U1 | no |  | `.ev-card .big` |
| 241 | single | E3 | no |  | `.job-title` |
| 242 | shared | U1+V2-study+P-progress+V3-record+E2+E3+E1 | no |  | `.result` |
| 244 | single | E3 | no |  | `.quizlet-block` |
| 245 | shared | V2-study+V3-notes+V3-record+E1+E2+E3+U1 | no |  | `.links` |
| 246 | shared | V2-study+V3-notes+V3-record+E1+E2+E3+U1 | no |  | `.links a` |
| 247 | shared | V3-record+E2+E3 | no |  | `.energy` |
| 248 | shared | V3-record+E2+E3 | no |  | `.energy button` |
| 249 | shared | V3-record+E2+E3 | no |  | `.energy button small` |
| 250 | shared | V3-record+E2+E3 | no |  | `.energy button[aria-pressed="true"]` |
| 251 | shared | V3-record+E2+E3 | no |  | `.energy button[aria-pressed="true"] small` |
| 252 | shared | P-progress+E3 | no |  | `.chart svg` |
| 253 | shared | P-progress+E3 | no |  | `.chart .bar` |
| 253 | shared | P-progress+E3 | no |  | `.chart .base` |
| 253 | shared | P-progress+E3 | no |  | `.chart text` |
| 253 | shared | P-progress+E3 | no |  | `.chart .pct` |
| 254 | shared | kit+V2-study+E1+E2+E3+V3-new+U1 | yes |  | `.composer::after` |
| 255 | shared | kit+V2-study+E1+E2+E3+V3-new+U1 | yes |  | `.composer` |
| 256 | shared | E1+U1 | yes |  | `.qchips` |
| 257 | shared | E1+U1 | yes |  | `.qchips::-webkit-scrollbar` |
| 258 | shared | E2+E1+U1 | no |  | `.qchip` |
| 259 | shared | E2+E1+U1 | no |  | `.qchip.go` |
| 260 | shared | E2+E1+U1 | no |  | `.qchip.go svg` |
| 261 | single | U1 | yes |  | `.compose-row` |
| 262 | single | U1 | yes |  | `.compose-row:focus-within` |
| 263 | single | U1 | yes |  | `.compose-row textarea` |
| 264 | single | U1 | yes |  | `.compose-row button` |
| 265 | single | U1 | yes |  | `.compose-row button svg` |
| 266 | single | U1 | no |  | `.compose-row .attach` |
| 266 | single | U1 | no |  | `.compose-row .attach:hover` |
| 267 | single | U1 | no |  | `#p-ev.drop .compose-row` |
| 268 | single | E1 | no |  | `.fine` |
| 271 | shared | E2+U1 | yes |  | `.sbar` |
| 272 | single | E2 | no |  | `.s-led` |
| 273 | single | E2 | no |  | `.sbar.brk .s-led` |
| 273 | single | E2 | no |  | `.sbar.busy .s-led` |
| 274 | single | E2 | no |  | `.s-main` |
| 275 | single | E2 | no |  | `.s-clock` |
| 276 | single | E2 | no |  | `.sbar.alert .s-clock` |
| 276 | single | E2 | no |  | `.sbar.brk .s-clock` |
| 277 | single | E2 | no |  | `.s-acts` |
| 278 | shared | E2+U1 | no |  | `.sbar button` |
| 279 | shared | E2+U1 | no |  | `.sbar button:hover` |
| 280 | shared | E2+U1 | no |  | `.sbar button.end` |
| 281 | shared | V1-today+E1+U1 | no |  | `.ev-card.check` |
| 282 | shared | V1-today+E1+U1 | no |  | `.ev-card.check.done` |
| 283 | single | E3 | no |  | `.check-items` |
| 284 | single | E3 | no |  | `.check-items li` |
| 285 | single | E3 | no |  | `.check-kind` |
| 286 | single | E3 | no |  | `.check-kind.link` |
| 286 | single | E3 | no |  | `.check-kind.gap,.check-kind.weakspot` |
| 287 | shared | V1-today+E1+U1 | no |  | `.ev-card textarea` |
| 288 | single | E3 | no |  | `.sess-sec` |
| 289 | single | E3 | no |  | `.sess-sec h3` |
| 290 | single | E3 | no |  | `.sess-sec ul` |
| 291 | shared | V3-notes+E3 | no |  | `.pend` |
| 296 | at-rule | | | | @keyframes fade |
| 297 | single | E1 | yes |  | `.rise` |
| 298 | at-rule | | | | @keyframes rise |
| 299 | at-rule | | | | @keyframes pulse |
| 300 | base |  | yes | (prefers-reduced-motion:reduce) | `*,*::before,*::after` |
| 301 | shared | U1+kit+V2-study+V3-record+P-system+E2+E3 | no |  | `.update` |
| 301 | shared | U1+kit+V2-study+V3-record+P-system+E2+E3 | no |  | `.update[hidden]` |
| 301 | shared | U1+kit+V2-study+V3-record+P-system+E2+E3 | no |  | `.update span` |
| 301 | shared | U1+kit+V2-study+V3-record+P-system+E2+E3 | no |  | `.update button` |
| 303 | single | E2 | yes |  | `.sk-sheet` |
| 304 | single | E2 | no |  | `.sk-peek` |
| 305 | single | E2 | no |  | `.sk-tog` |
| 306 | single | E2 | no |  | `.sk-tog::after` |
| 307 | single | E2 | no |  | `.sk-tog[aria-expanded="true"]::after` |
| 308 | single | E2 | no |  | `.sk-tog:hover` |
| 309 | single | E2 | no |  | `.sk-count` |
| 310 | single | E2 | no |  | `.sk-now` |
| 311 | single | E2 | no |  | `.sk-top` |
| 311 | single | E2 | no |  | `.sk-top .grow` |
| 312 | dead |  | no |  | `.sk-mini` |
| 313 | dead |  | no |  | `.sk-mini:hover` |
| 314 | single | E2 | no |  | `.sk-acts` |
| 315 | single | E2 | no |  | `.sk-acts button` |
| 316 | single | E2 | no |  | `.sk-body` |
| 317 | single | E2 | no |  | `.sk-head` |
| 317 | single | E2 | no |  | `.sk-head .meta` |
| 318 | single | E2 | no |  | `.sk-title` |
| 319 | single | E2 | no |  | `.sk-steps` |
| 320 | single | E2 | no |  | `.sk-step` |
| 321 | single | E2 | no |  | `.sk-step.cur` |
| 322 | single | E2 | no |  | `.sk-step.pass .sk-txt` |
| 323 | single | E2 | no |  | `.sk-mark` |
| 324 | single | E2 | no |  | `.sk-step.miss .sk-mark` |
| 325 | single | E2 | no |  | `.sk-crit` |
| 326 | dead |  | no |  | `.sk-cur` |
| 327 | single | E2 | no |  | `.sk-panel` |
| 328 | single | E2 | no |  | `body.skill-on .qchips` |
| 332 | single | E2 | no |  | `.wo-clock` |
| 333 | single | E2 | no |  | `.wo-moves` |
| 334 | single | E2 | no |  | `.wo-moves li` |
| 335 | single | E2 | no |  | `.wo-moves b` |
| 336 | single | E2 | no |  | `.wo-extra` |
| 338 | single | V2-study | no |  | `a.btn-link` |
| 339 | dead |  | no |  | `.share-acts` |
| 340 | single | E2 | no |  | `.sk-headtxt` |
| 341 | single | E2 | no |  | `.sk-head button` |
| 342 | single | E2 | no |  | `.sk-static` |
| 342 | single | E2 | no |  | `.sk-static::after` |
| 343 | single | E2 | no |  | `.sk-clock` |
| 344 | single | V2-study | no |  | `.share-bar` |
| 345 | single | V2-study | no |  | `.share-bar .grow` |
| 346 | single | E2 | no | (max-width:1023px) | `body.skill-on .toast` |
| 352 | shared | kit+E1 | yes |  | `body.captions.on-ev` |
| 353 | shared | kit+E1 | yes |  | `body.captions.on-ev .top-av` |
| 354 | shared | kit+E1 | yes |  | `body.captions #p-ev` |
| 356 | shared | kit+E1 | no |  | `body.captions #p-ev>*` |
| 358 | shared | kit+E1 | yes | (max-height:559px) | `body.captions #p-ev` |
| 358 | shared | kit+E1 | yes | (max-height:559px) | `body.captions .composer` |
| 359 | shared | kit+E1 | no |  | `body.captions #p-ev>.hero` |
| 361 | shared | kit+E1 | no |  | `body.captions #p-ev>.sbar` |
| 362 | shared | kit+E1 | no |  | `body.captions #p-ev>.thread` |
| 363 | shared | kit+E1 | no |  | `body.captions #p-ev>.composer` |
| 364 | shared | kit+E1 | no |  | `body.captions #p-ev>#ev-side` |
| 366 | shared | kit+E1 | no |  | `body.captions #p-ev>#ev-side:empty` |
| 367 | single | E1 | yes |  | `body.captions .hero,body.captions.opening .hero,body.captions.core-big .hero` |
| 368 | single | E1 | no |  | `body.captions .hero>.ev-av` |
| 370 | shared | kit+E1 | yes |  | `body.captions .thread` |
| 371 | shared | kit+E1 | yes |  | `body.captions .thread::-webkit-scrollbar` |
| 372 | single | E1 | yes |  | `body.captions .cap-in` |
| 373 | single | E1 | yes |  | `body.captions .cap-pull` |
| 374 | single | E1 | yes |  | `body.captions .cap-pull .ring` |
| 375 | single | E1 | yes |  | `body.captions .cap-pull svg.r` |
| 376 | single | E1 | yes |  | `body.captions .cap-pull .r .t` |
| 377 | single | E1 | yes |  | `body.captions .cap-pull .r .a` |
| 378 | single | E1 | yes |  | `body.captions .cap-pull .arrow` |
| 379 | single | E1 | yes |  | `body.captions .cap-pull .arrow svg` |
| 380 | single | E1 | yes |  | `body.captions .cap-pull .lbl` |
| 381 | single | E1 | no |  | `body.captions .cap-div` |
| 382 | single | E1 | no |  | `body.captions .cap-div::before,body.captions .cap-div::after` |
| 384 | shared | kit+E1 | yes |  | `body.captions .msg` |
| 385 | single | E1 | no |  | `body.captions .msg>.ev-av,body.captions .msg>.av-slot` |
| 386 | shared | kit+E1 | yes |  | `body.captions .msg-body` |
| 387 | shared | kit+E1 | yes |  | `body.captions .msg.ev .msg-body,body.captions .msg.matt .msg-body` |
| 388 | shared | kit+E1 | no |  | `body.captions .bubble,body.captions .msg.matt .bubble,body.captions.opening .msg.greet .bubble` |
| 389 | shared | kit+E1 | no |  | `body.captions .msg.ev .bubble` |
| 390 | shared | kit+E1 | no |  | `body.captions .msg.ev.current .bubble` |
| 391 | single | E1 | no |  | `body.captions.surface-open .msg.ev.current .bubble` |
| 392 | shared | kit+E1 | no |  | `body.captions.opening .msg.greet .bubble p:first-child` |
| 393 | shared | kit+E1 | no |  | `body.captions .msg.matt .bubble` |
| 394 | shared | kit+E1 | no |  | `body.captions .msg.matt .bubble::before` |
| 395 | shared | kit+E1 | no |  | `body.captions .msg.matt.last` |
| 396 | shared | kit+E1 | no |  | `body.captions .msg.earlier .bubble` |
| 397 | shared | kit+E1 | no |  | `body.captions .msg.ev .bubble.err` |
| 398 | shared | kit+E1 | no |  | `body.captions .bubble b` |
| 399 | shared | kit+E1 | no |  | `body.captions .bubble ul` |
| 400 | single | E1 | yes |  | `body.captions .msg-meta` |
| 401 | single | E1 | no |  | `body.captions .msg-meta>span` |
| 402 | single | E1 | yes |  | `body.captions .msg-cards,body.captions.opening .msg.greet .msg-cards` |
| 403 | single | E1 | yes |  | `body.captions .msg-cards:empty` |
| 406 | dead | kit+E1 | no |  | `body.captions .cap-cards-more` |
| 407 | dead | kit+E1 | no |  | `body.captions .cap-cards-more:hover` |
| 408 | single | E3 | no |  | `.card-more` |
| 411 | shared | V2-study+E2+E3+E1 | yes |  | `.brief` |
| 412 | shared | E1+E2+E3 | yes |  | `.msg.greet .brief` |
| 413 | single | E3 | yes |  | `.brief-line` |
| 414 | dead | E3 | no |  | `.brief-line .bl-t` |
| 415 | dead | E3 | no |  | `.brief-line .bl-go` |
| 416 | shared | V2-study+V3-notes+E3+E1 | yes |  | `.chev` |
| 418 | shared | E2+U1 | yes |  | `.sread` |
| 419 | dead | E2+U1 | no |  | `.sread .sr-where` |
| 420 | dead | E2+U1 | no | (max-width:599px) | `.sread .sr-nm` |
| 421 | dead | E2+U1 | no |  | `.sread .sr-line` |
| 422 | single | E1 | no |  | `.cap-quote` |
| 423 | single | E1 | no |  | `body.captions .msg.ev:not(.current) .cap-quote` |
| 425 | dead |  | no |  | `.card-line` |
| 426 | dead |  | no |  | `.card-line:hover,.card-line:active,.card-line:focus` |
| 427 | dead |  | no |  | `.card-line .cl-t` |
| 428 | dead |  | no |  | `.card-line:hover .cl-t` |
| 429 | dead |  | no |  | `.card-line .cl-go` |
| 430 | dead |  | no |  | `.card-line .cl-go svg` |
| 431 | single | E1 | yes |  | `body.captions .msg-cards` |
| 433 | shared | E1+U1 | yes |  | `#qchips:empty` |
| 435 | shared | kit+E1 | no |  | `body.captions .w` |
| 436 | shared | kit+E1 | no |  | `body.captions .reveal .w` |
| 437 | shared | kit+E1 | no |  | `body.captions .reveal .w.on` |
| 439 | shared | kit+E1 | yes |  | `body.captions .composer` |
| 440 | shared | kit+E1 | yes |  | `body.captions .composer::after` |
| 441 | single | E1 | yes |  | `body.captions .cap-echo` |
| 442 | single | E1 | no |  | `body.captions .cap-echo.on` |
| 445 | single | E1 | yes |  | `body.captions button.cap-now` |
| 446 | single | E1 | yes |  | `body.captions .cap-now:hover` |
| 447 | single | E1 | yes |  | `body.captions .cap-now svg` |
| 448 | single | E1 | yes | (max-width:599px) | `body.captions button.cap-now` |
| 449 | single | E1 | yes |  | `body.captions .cap-now[hidden]` |
| 450 | single | E1 | yes |  | `body:not(.on-ev) .cap-now` |
| 451 | shared | kit+E1 | no |  | `body.captions .composer>*` |
| 452 | single | E1 | no |  | `body.captions .composer>.cap-echo` |
| 454 | shared | kit+E1 | yes | (min-width:1024px) | `body.captions.on-ev .wrap` |
| 455 | shared | kit+E1 | yes | (min-width:1024px) | `body.captions .hero` |
| 460 | shared | kit+E1 | no | (min-width:1024px) | `body.captions .msg.ev .bubble` |
| 461 | shared | kit+E1 | no | (min-width:1024px) | `body.captions .msg.ev.current .bubble` |
| 462 | shared | kit+E1 | no | (min-width:1024px) | `body.captions .msg.matt .bubble` |
| 463 | single | E1 | no | (min-width:1024px) | `body.captions.surface-open .msg.ev.current .bubble` |
| 465 | at-rule | | | | @keyframes ev-side-in |
| 466 | shared | kit+E1 | no | (prefers-reduced-motion:reduce) | `body.captions .reveal .w` |
| 466 | single | E1 | no | (prefers-reduced-motion:reduce) | `body.captions.side-on #p-ev>#ev-side` |
| 470 | single | E1 | no |  | `.surf` |
| 471 | single | E1 | no |  | `.sf-top,.sf-rows` |
| 472 | single | E1 | no |  | `.sf-head,.sf-row` |
| 473 | single | E1 | no |  | `.sf-row` |
| 474 | single | E1 | no |  | `.sf-head:hover,.sf-head:active,.sf-head:focus,.sf-row:hover,.sf-row:active,.sf-row:focus` |
| 475 | single | E1 | no |  | `.sf-head:focus-visible,.sf-row:focus-visible` |
| 476 | single | E1 | no |  | `.sf-t` |
| 477 | single | E1 | no |  | `.sf-head .chev` |
| 478 | single | E1 | no |  | `.surf.folded .sf-head .chev,.sf-row .chev` |
| 479 | single | E1 | no |  | `.sf-body:empty` |
| 480 | single | E1 | no |  | `.sf-body` |
| 481 | single | E1 | no |  | `.surf .ev-card` |
| 482 | single | E1 | no |  | `.surf .ev-card>.card-head:first-child>h2,.surf .ev-card.check>.check-head` |
| 483 | single | E1 | no |  | `.surf .ev-card>.card-head:first-child:not(:has(> :not(h2)))` |
| 484 | single | E1 | no |  | `.surf .passage` |
| 485 | shared | kit+E1 | no |  | `body.captions .bubble a.cite` |
| 487 | shared | kit+E1 | no | (max-width:1199px) | `body.captions #p-ev>#ev-side` |
| 488 | shared | kit+E1 | no | (max-width:1199px) | `body.captions #p-ev>.composer` |
| 489 | shared | kit+E1 | no | (max-width:1199px) | `body.captions #ev-surf` |
| 490 | shared | kit+E1 | no | (max-width:1199px) | `body.captions #ev-surf.folded` |
| 492 | shared | kit+E1 | yes | (min-width:1200px) | `body.captions #ev-side` |
| 495 | single | E2 | yes |  | `body.captions #p-ev,body.captions.skill-on #p-ev` |
| 498 | single (part dead: .bi-prep) | E3 | no |  | `.bi-prep,.prep-mark` |
| 499 | single | E3 | no |  | `.prep-mark` |
| 500 | shared | V1-today+V2-study+E3+E1 | no |  | `.prep` |
| 501 | single | E3 | no |  | `.prep-row` |
| 502 | single | E3 | no |  | `.prep-row:hover,.prep-row:active,.prep-row:focus` |
| 503 | single | E3 | no |  | `.prep-row:focus-visible` |
| 504 | single | E3 | no |  | `.prep-t` |
| 505 | single | E3 | no |  | `.prep.open .prep-t` |
| 506 | single | E3 | no |  | `.prep-n` |
| 507 | single | E3 | no |  | `.prep-row .chev` |
| 508 | single | E3 | no |  | `.prep.open .prep-row .chev` |
| 509 | single | E3 | no |  | `.prep.done .prep-t` |
| 509 | single | E3 | no |  | `.prep.done .prep-mark` |
| 510 | single | E3 | no |  | `.prep-box[hidden]` |
| 511 | single | E3 | no |  | `.prep-note` |
| 512 | single | E3 | no |  | `.prep-list` |
| 513 | single | E3 | no |  | `.prep-item` |
| 514 | single | E3 | no |  | `.prep-lab` |
| 515 | single | E3 | no |  | `.pi-txt` |
| 516 | single | E3 | no |  | `.pi-t` |
| 517 | single | E3 | no |  | `.prep-item.on .pi-t` |
| 518 | single | E3 | no |  | `.pi-c` |
| 519 | single | E3 | no |  | `.pi-rm` |
| 520 | single | E3 | no |  | `.prep-add` |
| 521 | single | E3 | no |  | `.prep-add input` |
| 522 | single | E3 | no |  | `.prep-add button` |
| 525 | single | U1 | yes | (max-width:1023px) | `.ptitle` |
| 528 | shared | V1-today+V3-notes+V3-record+U1 | yes |  | `.cols,.col-main,.col-side` |
| 530 | shared | U1+E1 | yes | (min-width:1024px) | `body:not(.on-ev) .wrap` |
| 531 | shared | V1-today+V3-notes+V3-record+U1 | yes | (min-width:1024px) | `.cols` |
| 532 | shared | V1-today+V3-notes+P-progress+V3-record+U1 | yes | (min-width:1024px) | `.col-main,.col-side` |
| 535 | single | E3 | no |  | `.check-head .check-fold` |
| 536 | shared | V1-today+E1+U1 | no |  | `.ev-card.check.folded` |
| 536 | single | E3 | no |  | `.ev-card.check.folded>:not(.check-head)` |
| 537 | single | E2 | no |  | `.sk-pfold` |
| 537 | single | E2 | no |  | `.sk-panel.folded` |
| 539 | dead |  | no |  | `.ws-lead` |
| 540 | single | P-progress | no |  | `.ws-item` |
| 541 | single | P-progress | no |  | `.ws-line` |
| 542 | single | P-progress | no |  | `.ws-line:focus-visible` |
| 543 | single | P-progress | no |  | `.ws-t` |
| 544 | single | P-progress | no |  | `.ws-n` |
| 545 | single | P-progress | no |  | `.ws-more` |
| 545 | single | P-progress | no |  | `.ws-item.open .ws-more` |
| 545 | single | P-progress | no |  | `.ws-more .meta` |
| 545 | single | P-progress | no |  | `.ws-more .actions` |
| 546 | dead | kit+V2-study+E2+E3+U1 | no |  | `#weak-card>.fold-line` |
| 547 | shared | kit+V2-study+E2 | no |  | `button.tlink` |
| 547 | shared | kit+V2-study+E2 | no |  | `button.tlink:focus-visible` |
| 550 | single | U1 | yes |  | `.set-count` |
| 551 | shared | V2-study+E1 | yes |  | `.fold-line.flat` |
| 551 | shared | V2-study+E1 | yes |  | `.fold-line.flat::after` |
| 552 | single | V2-study | no |  | `.set-list` |
| 553 | single | V2-study | no |  | `.set-q,.sum-line` |
| 554 | single (part dead: .next-line:focus-visible) | V2-study | no |  | `.set-q:focus-visible,.sum-line:focus-visible,.next-line:focus-visible` |
| 555 | single | V2-study | no |  | `.set-list .row,.sum-list .row,#pr-body .row` |
| 556 | dead |  | no |  | `.sq-n` |
| 557 | single | V2-study | no |  | `.sq-t,.sum-t` |
| 558 | single | V2-study | no |  | `.sq-s,.sum-k` |
| 558 | single | V2-study | no |  | `.sq-s.ok` |
| 559 | single | V2-study | no |  | `.set-item.current .sq-t` |
| 560 | single | V2-study | no |  | `.q-beside` |
| 561 | single | V2-study | no |  | `.q-main` |
| 561 | single | V2-study | no |  | `.q-set` |
| 562 | single | V2-study | no |  | `.verdict` |
| 563 | shared | kit+V2-study+V1-today+V3-notes+P-system+E2+E3+E1 | no |  | `.why[hidden]` |
| 564 | single | V2-study | no |  | `.why-fold` |
| 565 | single | V2-study | no |  | `.sum-h` |
| 566 | single | V2-study | no |  | `.sum-more` |
| 566 | single | V2-study | no |  | `.sum-more p` |
| 567 | dead |  | no |  | `.next-line` |
| 567 | dead |  | no |  | `.next-line::after` |
| 568 | shared | V2-study+U1 | no |  | `#more-card:not(.card)` |
| 569 | single | V2-study | yes |  | `.plan-lead` |
| 572 | dead |  | no |  | `.trend-wrap` |
| 573 | dead |  | no |  | `.trend` |
| 574 | dead |  | no |  | `.trend-grid` |
| 575 | dead |  | no |  | `.trend-axis` |
| 576 | dead |  | no |  | `.trend-line` |
| 577 | dead |  | no |  | `.trend-link` |
| 578 | dead |  | no |  | `.trend-pt` |
| 579 | dead | V1-today+V2-study+P-progress+P-system+E2+E3+E1+U1 | no |  | `.trend-pt.week` |
| 580 | dead |  | no |  | `.trend-pred` |
| 581 | dead |  | no |  | `.trend-label` |
| 582 | dead |  | no |  | `.trend-cap` |
| 584 | dead |  | no |  | `.ins-list` |
| 585 | dead |  | no |  | `.ins-line` |
| 587 | single | E3 | no |  | `.yt-place + .yt-place` |
| 588 | single | E3 | no |  | `.yt-label` |
| 589 | single | E3 | no |  | `.yt-item` |
| 590 | single | E3 | no |  | `.yt-ask` |
| 591 | single | E3 | no |  | `.yt-chips` |
| 592 | single | E3 | no |  | `.yt-confirm` |
| 595 | single | E1 | no |  | `.bubble.to-copy,body.captions .msg.ev .bubble.to-copy,body.captions .msg.ev.current .bubble.to-copy` |
| 596 | single | E1 | no |  | `.copy-chip` |
| 604 | base |  | yes |  | `:root` |
| 605 | base |  | yes |  | `html` |
| 606 | base |  | yes |  | `body` |
| 608 | shared | V2-study+V3-notes+E2+E3+U1 | yes |  | `.wrap` |
| 609 | shared | V2-study+V3-notes+E2+E3+U1 | yes | (max-width:1023px) | `.wrap` |
| 610 | shared | U1+E1 | yes |  | `body:not(.on-ev) .wrap` |
| 611 | dead |  | no |  | `.top-in,.top-right` |
| 613 | shared | U1+E2 | yes |  | `.mh` |
| 616 | shared | U1+V1-today+V3-notes | yes |  | `.mh-title` |
| 617 | shared | U1+E2 | yes |  | `.mh .status` |
| 618 | shared | U1+E2 | no |  | `.mh .status:not(.ok)` |
| 620 | shared | U1+E2 | yes |  | `.mh .status.ok` |
| 622 | shared | U1+E2 | yes |  | `.mh .status` |
| 624 | single | U1 | no |  | `body.boot-stopped .mh .status` |
| 626 | shared | U1+E2 | no |  | `.mh .status.sys` |
| 627 | shared | E1+U1 | no |  | `.readout.sys` |
| 628 | single | U1 | yes |  | `.ptitle` |
| 630 | shared | V2-study+V1-today+P-progress+V3-record+E1+E2+E3+U1 | yes |  | `.side` |
| 631 | single | U1 | yes |  | `.side .brand` |
| 632 | shared | E1+U1 | yes |  | `.side .top-av` |
| 633 | single | E2 | yes |  | `body.on-ev.opening .side .top-av,body.on-ev.in-session .side .top-av,body.on-ev.core-big .side .top-av,body.ca` |
| 634 | single | U1 | yes |  | `.side .wordmark` |
| 635 | shared | U1+V2-study+V3-notes+V3-record+E2 | yes |  | `.side .tabs` |
| 636 | single | U1 | yes |  | `.side .tabs .tab,.side .tab-sys` |
| 637 | single | U1 | yes |  | `.side .tabs .tab > svg,.side .tab-sys > svg` |
| 638 | single | U1 | yes |  | `.side .tabs .tab span,.side .tab-sys span` |
| 639 | single | U1 | yes |  | `.side .tabs .tab:hover,.side .tab-sys:hover` |
| 640 | single | U1 | yes |  | `.side .tabs .tab[aria-selected="true"],.side .tab-sys[aria-current="page"]` |
| 644 | base |  | yes | (max-width:599px) | `:root` |
| 645 | shared | V2-study+V1-today+P-progress+V3-record+E1+E2+E3+U1 | yes | (max-width:599px) | `.side` |
| 646 | single | U1 | yes | (max-width:599px) | `.side .brand` |
| 648 | shared | U1+V2-study+V3-notes+V3-record+E2 | yes | (max-width:599px) | `.side .tabs` |
| 649 | shared | U1+V2-study+V3-notes+V3-record+E2 | yes | (max-width:599px) | `.side .tabs .tab` |
| 650 | shared | U1+V2-study+V3-notes+V3-record+E2 | yes | (max-width:599px) | `.side .tabs .tab[aria-selected="true"]` |
| 651 | single | U1 | yes | (max-width:599px) | `.side .tab-sys` |
| 652 | single | U1 | yes | (max-width:599px) | `.side .tab-sys span` |
| 653 | shared | U1+E2 | yes | (max-width:599px) | `.mh` |
| 655 | shared | kit+E1 | no | (max-width:599px) | `body.captions #ev-surf` |
| 661 | shared | U1+E1 | no | (max-width:599px) | `html:has(>body.on-ev)` |
| 662 | shared | U1+E1 | yes | (max-width:599px) | `body.on-ev` |
| 663 | shared | U1+E1 | yes | (max-width:599px) | `body.on-ev .qchips` |
| 666 | shared | U1+E2 | yes | (max-width:599px) | `.mh` |
| 667 | shared | U1+E1 | yes | (max-width:599px) | `body.on-ev .mh` |
| 671 | base |  | yes | (min-width:600px) | `:root` |
| 672 | base |  | yes | (min-width:600px) | `html` |
| 673 | base |  | yes | (min-width:600px) | `body` |
| 674 | base |  | yes | (min-width:600px) | `body::before` |
| 675 | shared | V2-study+V1-today+P-progress+V3-record+E1+E2+E3+U1 | yes | (min-width:600px) | `.side` |
| 676 | single | U1 | yes | (min-width:600px) | `.side .tab-sys` |
| 678 | shared | U1+E2 | yes | (min-width:600px) | `.mh` |
| 680 | base |  | yes | (min-width:600px) and (max-width:699px) | `:root` |
| 681 | base |  | yes | (min-width:1600px) | `:root` |
| 683 | shared | V1-today+V3-notes+V3-record+U1 | yes |  | `.cols,.col-main,.col-side` |
| 684 | shared | V1-today+V3-notes+V3-record+U1 | yes | (min-width:1024px) | `.cols,.col-main,.col-side` |
| 687 | base |  | yes | (min-width:1200px) | `:root` |
| 688 | shared | V1-today+V3-notes+V3-record+U1 | yes | (min-width:1200px) | `body:has(section.panel:not([hidden]) > .cols > .col-side, section.panel:not([hidden]) > .panel:not([hidden]) >` |
| 689 | shared | V1-today+V3-notes+V3-record+U1 | yes | (min-width:1200px) | `section.panel > .cols > .col-side,section.panel > .panel > .cols > .col-side` |
| 690 | shared | V1-today+V3-notes+P-progress+V3-record+U1 | yes | (min-width:1200px) | `.col-main` |
| 696 | single | E1 | yes |  | `body.captions .hero,body.captions.opening .hero,body.captions.core-big .hero` |
| 697 | single | E1 | yes |  | `body.captions.her-folded .hero` |
| 698 | single | E1 | no |  | `body.captions .hero>.ev-av` |
| 699 | shared | E1+U1 | yes |  | `.mh-her` |
| 700 | shared | E1+U1 | yes |  | `.mh-her:hover` |
| 701 | single | E1 | yes |  | `body.on-ev.her-folded .mh-her` |
| 703 | single | U1 | yes |  | `.compose-row #ev-send` |
| 704 | single | U1 | no |  | `.compose-row #ev-send.on` |
| 709 | base |  | yes | (min-width:600px) | `html` |
| 710 | base |  | yes | (min-width:600px) | `body` |
| 714 | single | U1 | yes |  | `.side-sec` |
| 715 | single | U1 | yes |  | `.side-sec .sec` |
| 716 | single | U1 | yes |  | `.side-sec .sec .sp` |
| 717 | single | U1 | yes |  | `.side-sec .si` |
| 718 | single | U1 | yes |  | `.side-sec .si,.side .prefs-btn,.side .prefpop .tab-sys.sys-link` |
| 719 | single | U1 | yes |  | `.side-sec .si .t` |
| 720 | single | U1 | yes |  | `.side-sec .si .st` |
| 721 | single | U1 | yes |  | `.side-sec .si:hover` |
| 722 | single | U1 | yes |  | `.side-sec .si.on` |
| 724 | single | U1 | no |  | `.side-sec .si.si-rev` |
| 725 | single | U1 | no |  | `.side-sec .si.si-rev .t` |
| 726 | single | U1 | no |  | `.side-sec .si.si-rev .t,.side-sec .si.si-rev .tr` |
| 727 | single | U1 | no |  | `.side-sec .si.si-rev .tr` |
| 728 | single | U1 | yes |  | `.sdot` |
| 729 | single | U1 | yes |  | `.sdot.d-q` |
| 730 | single | U1 | yes |  | `.side .lab-side` |
| 731 | single | U1 | yes | (min-width:600px) | `.side .tabs .tab .lab-bar` |
| 731 | single | U1 | yes | (min-width:600px) | `.side .tabs .tab .lab-side` |
| 732 | single | U1 | yes | (max-width:599px) | `.side-sec` |
| 735 | single | E1 | no |  | `.side .ev-av .under` |
| 736 | single | U1 | no |  | `.side-sec .si.more` |
| 739 | single | U1 | yes |  | `.side-foot` |
| 740 | single | U1 | yes |  | `.side .prefs-btn` |
| 741 | single | U1 | no |  | `.side .prefs-btn>svg` |
| 742 | single | U1 | yes |  | `.side .prefs-btn:hover` |
| 743 | single | U1 | yes |  | `.side .prefs-btn[aria-expanded="true"]` |
| 744 | single | U1 | yes |  | `.side .prefpop` |
| 745 | single | U1 | yes |  | `.side .prefpop[hidden]` |
| 746 | single | U1 | yes |  | `.side .prefpop .pref` |
| 747 | single | U1 | no |  | `.side .prefpop .pref>.lbl` |
| 748 | single | U1 | yes |  | `.side .prefpop .seg` |
| 749 | single | U1 | yes |  | `.side .prefpop .tab-sys.sys-link` |
| 750 | single | U1 | yes |  | `.side .prefpop .tab-sys.sys-link span` |
| 751 | single | U1 | yes |  | `.side .prefpop .tab-sys.sys-link:hover` |
| 752 | single | U1 | yes |  | `.side .prefpop .tab-sys.sys-link[hidden]` |
| 754 | single | U1 | yes | (max-width:599px) | `.side-foot` |
| 755 | single | U1 | yes | (max-width:599px) | `.side .prefs-btn` |
| 756 | single | U1 | yes | (max-width:599px) | `.side .prefs-btn span` |
| 757 | single | U1 | yes | (max-width:599px) | `.side .prefpop` |
| 761 | single | U1 | yes | (min-width:600px) | `.side .prefpop` |
| 762 | single | U1 | yes | (min-width:600px) | `.side .brand` |
| 763 | shared | U1+V2-study+V3-notes+V3-record+E2 | yes | (min-width:600px) | `.side .tabs .tab` |
| 765 | shared | E1+U1 | yes |  | `.readout .led` |
| 768 | shared | kit+E1 | no |  | `body.captions .msg.matt.last` |
| 769 | shared | kit+E1 | no |  | `body.captions .msg.matt` |
| 770 | shared | kit+E1 | no |  | `body.captions .msg.matt .bubble` |
| 771 | shared | kit+E1 | no |  | `body.captions .msg.matt .bubble::before` |
| 772 | single | E1 | yes |  | `body.captions .cap-echo` |
| 777 | shared | kit+E1 | yes |  | `body.captions.on-ev .wrap` |
| 779 | single | E1 | no | (min-width:1200px) | `body.captions.on-ev.side-on` |
| 780 | single | E1 | no | (min-width:1200px) | `body.captions.side-on #p-ev>#ev-side` |
| 781 | shared | kit+E1 | yes | (min-width:1200px) | `body.captions:not(.on-ev) #ev-side` |
| 785 | shared | U1+E2 | yes |  | `.mh .sbar` |
| 786 | shared | U1+E2 | yes |  | `.mh .sbar[hidden]` |
| 787 | shared | U1+E2 | no |  | `.mh .sbar button.btn` |
| 788 | single | E2 | no |  | `.mh .sbar .s-main` |
| 789 | shared | U1+E2 | no |  | `.mh .sbar button` |
| 790 | shared | U1+E2 | no |  | `.mh .sbar button:hover` |
| 791 | shared | U1+E2 | no |  | `.mh .sbar button.end` |
| 792 | single | E2 | no |  | `.mh .sbar .s-led` |
| 792 | single | E2 | no |  | `.mh .sbar.brk .s-led` |
| 793 | single | E2 | no | (max-width:599px) | `.mh .sbar .s-acts button:not(.end):not(:first-child)` |
| 794 | single | V2-study | yes |  | `.opt kbd.opt-n` |
| 795 | single | V2-study | no |  | `.opt input:checked~kbd.opt-n` |
| 796 | single | V2-study | yes | (hover:none) | `.opt kbd.opt-n` |
| 799 | single | E2 | no |  | `#ev-side>.sk-panel` |
| 801 | single | E2 | no | (min-width:1200px) | `body.captions #ev-side>.sk-panel` |
| 802 | single | E2 | no | (min-width:1200px) | `body.skill-on .sk-sheet .sk-tog` |
| 803 | single | E2 | no | (min-width:1200px) | `body.skill-on .sk-sheet .sk-tog::after` |
| 804 | single | E2 | no | (min-width:1200px) | `body.skill-on .sk-sheet .sk-body` |
| 806 | single | E2 | yes |  | `.sk-sheet` |
| 807 | single | E2 | no |  | `.sk-count` |
| 808 | single | E2 | no |  | `.sk-step.cur` |
| 809 | single | E2 | no |  | `.sk-mark` |
| 810 | single | E2 | no |  | `.sk-step.miss .sk-mark` |
| 811 | single | E2 | no |  | `.sk-panel .sk-head` |
| 812 | single | E2 | no |  | `.sk-panel .sk-pfold` |
| 819 | single | U1 | no |  | `:where(#p-today,#p-study,#p-progress,#p-record,#p-system) .card` |
| 820 | single | U1 | no |  | `:where(#p-today,#p-study,#p-progress,#p-record,#p-system) .card>h2,:where(#p-today,#p-study,#p-progress,#p-rec` |
| 821 | single | U1 | no |  | `:where(#p-today,#p-study,#p-progress,#p-record,#p-system) .card>h2,:where(#p-today,#p-study,#p-progress,#p-rec` |
| 822 | single | U1 | no |  | `:where(#p-today,#p-study,#p-progress,#p-record,#p-system) .card>.card-head .meta` |
| 823 | single | U1 | no |  | `:where(#p-today,#p-study,#p-progress,#p-record,#p-system) .row` |
| 824 | single | U1 | no |  | `:where(#p-today,#p-study,#p-progress,#p-record,#p-system) .row.week-item` |
| 825 | single | U1 | no |  | `:where(#p-today,#p-study,#p-progress,#p-record,#p-system) .row .meta` |
| 826 | single | U1 | no |  | `:where(#p-today,#p-study,#p-progress,#p-record,#p-system) .when` |
| 827 | single | U1 | no |  | `:where(#p-today,#p-study,#p-progress,#p-record,#p-system) .wk-line` |
| 828 | dead | U1 | no |  | `:where(#p-today,#p-study,#p-progress,#p-record,#p-system) .wk-k` |
| 829 | dead | U1 | no |  | `:where(#p-today,#p-study,#p-progress,#p-record,#p-system) .wk-k.urgent` |
| 830 | single | U1 | no |  | `:where(#p-today,#p-study,#p-progress,#p-record,#p-system) input.tick` |
| 831 | single | U1 | no |  | `:where(#p-today,#p-study,#p-progress,#p-record,#p-system) input.tick:checked` |
| 832 | single | U1 | no |  | `:where(#p-today,#p-study,#p-progress,#p-record,#p-system) input.tick:checked::after` |
| 833 | single (part dead: .bi-prep) | E3 | no |  | `.bi-prep,.prep-mark` |
| 835 | single | U1 | no | (min-width:600px) | `:where(#p-today,#p-study,#p-progress,#p-record,#p-system) .row,:where(#p-today,#p-study,#p-progress,#p-record,` |
| 836 | single | U1 | no | (min-width:600px) | `:where(#p-today,#p-study,#p-progress,#p-record,#p-system) .row` |
| 837 | single | U1 | no | (min-width:600px) | `:where(#p-today,#p-study,#p-progress,#p-record,#p-system) .row.week-item` |
| 838 | single | U1 | no | (min-width:600px) | `:where(#p-today,#p-study,#p-progress,#p-record,#p-system) input[type=text]` |
| 839 | single | U1 | no | (min-width:600px) | `:where(#p-today,#p-study,#p-progress,#p-record,#p-system) form button` |
| 842 | shared | U1+E2 | yes |  | `.mh .seg` |
| 843 | shared | U1+E2 | yes |  | `.mh .seg[hidden],body.on-ev .mh .seg` |
| 846 | shared | V1-today+V3-notes+V3-record+U1 | yes | (min-width:1200px) | `section.panel > .cols > .col-side .card,section.panel > .panel > .cols > .col-side .card` |
| 847 | shared | E3+U1 | no | (min-width:1200px) | `section.panel > .cols > .col-side .card>h2,section.panel > .panel > .cols > .col-side .card>.card-head` |
| 850 | shared | kit+V2-study+E2 | no |  | `button.tlink` |
| 851 | shared | kit+V2-study+E2 | no |  | `button.tlink:hover` |
| 855 | shared | E2+E1+U1 | no |  | `.qchip.go` |
| 856 | shared | E2+E1+U1 | no |  | `.qchip.go:hover` |
| 862 | shared | V2-study+U1 | yes |  | `#study-side` |
| 863 | shared | V1-today+E1 | yes |  | `#ev-dates` |
| 864 | single | E1 | no | (max-width:1199px) | `body.captions:not(.side-on) #p-ev>#ev-side` |
| 866 | shared | V2-study+U1 | yes | (min-width:1200px) | `body:has(#p-study:not([hidden]) > #study-side:not([hidden]))` |
| 867 | shared | V2-study+U1 | yes | (min-width:1200px) | `#study-side:not([hidden])` |
| 868 | single | E1 | yes | (min-width:1200px) | `body.captions.on-ev.ev-rest-on` |
| 869 | single | E1 | no | (min-width:1200px) | `body.captions.ev-rest-on #p-ev>#ev-side` |
| 870 | single | E1 | yes | (min-width:1200px) | `body.captions:not(.side-on) #ev-dates` |
| 872 | single | E1 | yes | (min-width:1200px) | `#study-side .card,#ev-dates,body.captions #ev-side>.surf,body.captions #ev-side>.sk-panel,body.captions #ev-si` |
| 873 | shared | V2-study+U1 | yes | (min-width:1200px) | `#study-side .card,#ev-dates` |
| 874 | shared | V2-study+U1 | no | (min-width:1200px) | `#study-side .card>h2,#ev-dates>h2` |
| 875 | single | V2-study | no | (min-width:1200px) | `#study-side .set-list` |
| 878 | single | E1 | no |  | `.surf .ev-card>.card-head:first-child>:is(.meta,.chip)` |
| 879 | single | E1 | no |  | `.surf .ev-card>.card-head:first-child:not(:has(> :not(h2,.meta,.chip)))` |
| 882 | shared | kit+E1 | yes |  | `body.captions .msg-body,body.captions.opening .msg.greet` |
| 883 | shared | kit+E1 | no |  | `body.captions .msg.matt .msg-body` |
| 884 | single | E1 | yes |  | `body.captions .msg-meta` |
| 885 | dead | kit+E1 | no |  | `body.captions .cap-cards-more` |
| 892 | shared | kit+E1 | yes |  | `body.captions #p-ev` |
| 893 | shared | kit+E1 | no |  | `body.captions #p-ev>.hero` |
| 894 | shared | kit+E1 | no |  | `body.captions #p-ev>.thread` |
| 895 | shared | kit+E1 | no |  | `body.captions #p-ev>.composer` |
| 896 | shared | kit+E1 | no |  | `body.captions #p-ev>#ev-side` |
| 898 | shared | kit+E1 | no | (max-width:1199px) | `body.captions #p-ev>#ev-side` |
| 899 | shared | kit+E1 | no | (max-width:1199px) | `body.captions #p-ev>.composer` |
| 901 | single | E2 | yes |  | `.ckin` |
| 902 | single | E2 | no |  | `.ckin[hidden]` |
| 904 | single | E1 | no |  | `.msg-acts` |
| 905 | single | E2 | yes |  | `.ckin .ck-row` |
| 906 | single | E2 | yes |  | `.ckin .ck-head` |
| 907 | single | E2 | yes |  | `.ckin .lab` |
| 908 | single | E2 | yes |  | `.ckin .mini` |
| 909 | single | E2 | yes |  | `.ckin .ck-q` |
| 910 | single | E2 | yes |  | `.ckin .seg` |
| 911 | single | E2 | no |  | `.ckin .adv` |
| 912 | single | E1 | yes |  | `body.captions .cap-in` |
| 913 | shared | kit+E1 | no |  | `body.captions .msg.ev .bubble,body.captions .msg.earlier .bubble` |
| 914 | single | E1 | no |  | `body.captions .msg.ev.current .bubble,body.captions.surface-open .msg.ev.current .bubble` |
| 915 | shared | kit+E1 | no |  | `body.captions .msg.matt.last` |
| 916 | shared | kit+E1 | no |  | `body.captions .msg.matt .bubble` |
| 917 | shared | kit+E1 | no |  | `body.captions .msg.matt .bubble::before` |
| 918 | shared | kit+E1 | yes |  | `body.captions .composer` |
| 919 | shared | kit+E1 | no |  | `body.captions .composer>*` |
| 922 | shared | E1+U1 | yes |  | `.qchips` |
| 923 | shared | E1+U1 | no |  | `.qchips>*` |
| 924 | shared | E1+U1 | no |  | `.qchips>:first-child` |
| 925 | shared | E1+U1 | no |  | `.qchips>:last-child` |
| 926 | shared | E2+E1+U1 | no |  | `.qchip,.qchip.go` |
| 927 | shared | E2+E1+U1 | no |  | `.qchip:hover` |
| 931 | shared | E1+U1 | yes | (min-width:600px) | `.qchips` |
| 932 | shared | E1+U1 | no | (min-width:600px) | `.qchips>:first-child` |
| 933 | shared | E1+U1 | no | (min-width:600px) | `.qchips>:last-child` |
| 936 | shared | E1+U1 | yes | (max-width:599px) | `.qchips` |
| 937 | shared | E1+U1 | no | (max-width:599px) | `.qchips>*` |
| 938 | shared | E1+U1 | no | (max-width:599px) | `.qchips>:first-child` |
| 939 | shared | E1+U1 | no | (max-width:599px) | `.qchips>:last-child` |
| 941 | single | U1 | no |  | `body.captions .composer>.compose-row` |
| 942 | single | U1 | yes |  | `.compose-row` |
| 943 | single | U1 | yes |  | `.compose-row:focus-within` |
| 944 | single | U1 | yes |  | `.compose-row textarea` |
| 945 | single | U1 | yes |  | `.compose-row textarea::placeholder` |
| 946 | single | U1 | no |  | `.compose-row textarea:placeholder-shown` |
| 947 | single | U1 | no |  | `.compose-row .attach` |
| 948 | single | U1 | yes |  | `.compose-row #ev-send,.compose-row #ev-send.on` |
| 949 | single | U1 | yes |  | `.compose-row #ev-send:hover` |
| 950 | single | E1 | no | (max-width:1199px) | `body.captions.surface-open #qchips` |
| 953 | single | E2 | yes | (max-width:599px) | `.ckin` |
| 954 | shared | E1+U1 | yes | (max-width:599px) | `.qchips` |
| 955 | single | U1 | no | (max-width:599px) | `body.captions .composer>.compose-row` |
| 956 | single | E2 | yes | (max-width:599px) | `.ckin .seg` |
| 957 | single | E2 | yes | (max-width:599px) | `.ckin .seg button` |
| 958 | single | E1 | yes | (max-width:599px) | `body.captions .cap-in` |
| 959 | shared | E2+E1+U1 | no | (max-width:599px) | `.qchip,.qchip.go` |
| 960 | single | U1 | no | (max-width:599px) | `body.captions .composer>.compose-row` |
| 961 | single | U1 | yes | (max-width:599px) | `.compose-row #ev-send,.compose-row #ev-send.on` |
| 962 | single | U1 | no | (max-width:599px) | `.compose-row .attach` |
| 965 | shared | kit+E1 | no | (min-width:1200px) | `body.captions #ev-side>#ev-dates` |
| 966 | shared | V1-today+E1 | no | (min-width:1200px) | `#ev-dates>h2` |
| 967 | shared | V1-today+E1 | yes | (min-width:1200px) | `#ev-dates .list` |
| 968 | single | E3 | yes | (min-width:1200px) | `#ev-dates .week-item` |
| 969 | single | E3 | yes | (min-width:1200px) | `#ev-dates .wk-line` |
| 970 | single | E3 | yes | (min-width:1200px) | `#ev-dates .wk-line:hover` |
| 971 | single | E3 | yes | (min-width:1200px) | `#ev-dates .wk-line::before` |
| 972 | single | E3 | yes | (min-width:1200px) | `#ev-dates .wk-t` |
| 973 | shared | V1-today+E1 | yes | (min-width:1200px) | `#ev-dates .when` |
| 974 | dead | V1-today+E1 | no | (min-width:1200px) | `#ev-dates .bi-prep,#ev-dates .wk-k` |
| 980 | base |  | yes |  | `:root` |
| 981 | base |  | no |  | `:root[data-text="larger"]` |
| 982 | base |  | no |  | `:root[data-motion="reduce"] *,:root[data-motion="reduce"] *::before,:root[data-motion="reduce"] *::after` |
| 983 | shared | kit+E1 | no |  | `:root[data-motion="reduce"] body.captions .reveal .w` |
| 984 | single | E1 | no |  | `:root[data-motion="reduce"] body.captions.side-on #p-ev>#ev-side` |
| 988 | single | E3 | yes |  | `.chev,.prep-row .chev` |
| 989 | shared (part dead: .open>.brief-row .chev; .brief-item.open .chev) | V2-study+V3-notes+E3+E1 | yes |  | `.open>.brief-row .chev,.brief-item.open .chev,.prep.open .chev,[aria-expanded="true"] .chev,[aria-expanded="tr` |
| 990 | single | E2 | no |  | `.sk-tog::after` |
| 991 | single | E2 | no |  | `.sk-tog[aria-expanded="true"]::after` |
| 992 | single | E1 | yes |  | `body.captions.her-folded .hero` |
| 994 | shared | kit+V1-today+V2-study+E1+E2+E3 | no |  | `.work` |
| 994 | single | E2 | no |  | `.work-line` |
| 994 | single | E2 | no |  | `.work-line:disabled` |
| 994 | single | E2 | no |  | `.work-line:disabled::after` |
| 995 | single | E2 | no |  | `.work-changes` |
| 995 | single | E2 | no |  | `.work-changes li` |
| 995 | single | E2 | no |  | `.work-changes .tlink` |
| 1004 | single | V2-study | yes |  | `.x-green` |
| 1004 | shared | V1-today+V2-study | yes |  | `.x-yellow` |
| 1004 | single | V1-today | no |  | `.x-red` |
| 1004 | shared | V1-today+V3-record | yes |  | `.x-blue` |
| 1004 | shared | kit+V1-today+V2-study+V3-record | yes |  | `.x-violet` |
| 1004 | shared | V1-today+V2-study | yes |  | `.x-quiet` |
| 1006 | shared | kit+U1+V2-study+V1-today+V3-notes+P-progress+V3-record+E1+E2+E3 | yes |  | `button.btn` |
| 1007 | shared | kit+U1+V2-study+V1-today+V3-notes+P-progress+V3-record+E1+E2+E3 | yes |  | `button.btn svg` |
| 1008 | shared | kit+U1+V2-study+V1-today+V3-notes+V3-record+E2+E3+E1 | yes |  | `button.btn.primary` |
| 1009 | shared | kit+U1+V2-study+V1-today+V3-notes+V3-record+E2+E3+E1 | yes |  | `button.btn.primary:not(:disabled):hover` |
| 1010 | shared | kit+U1+V2-study+V1-today+V3-notes+P-progress+V3-record+E1+E2+E3 | yes |  | `button.btn.neutral` |
| 1011 | shared | kit+U1+V2-study+V1-today+V3-notes+P-progress+V3-record+E1+E2+E3 | yes |  | `button.btn.neutral:not(:disabled):hover` |
| 1012 | shared | kit+V2-study+theme.js | no |  | `button.btn.tint` |
| 1013 | shared | kit+V2-study+theme.js | no |  | `button.btn.tint svg` |
| 1014 | shared | kit+V2-study+theme.js | no |  | `button.btn.tint:not(:disabled):hover` |
| 1015 | shared | kit+V2-study+theme.js | no |  | `button.btn:is(.ghost,.icon):not(.primary,.neutral,.tint)` |
| 1016 | shared | kit+V2-study+theme.js | no |  | `button.btn:is(.ghost,.icon):not(.primary,.neutral,.tint,:disabled):hover` |
| 1017 | shared | kit+V1-today+V2-study+V3-notes+V3-record+U1 | yes |  | `button.btn.icon` |
| 1018 | shared | kit+U1+V2-study+V1-today+V3-notes+P-progress+V3-record+E1+E2 | yes |  | `button.btn.sm` |
| 1019 | shared | kit+V1-today+V2-study+V3-notes+V3-record+U1 | yes |  | `button.btn.icon.sm` |
| 1020 | shared | V2-study+E1+E3+U1 | no |  | `button.btn.send` |
| 1021 | shared | kit+U1+V2-study+V1-today+V3-notes+P-progress+V3-record+E1+E2+E3 | yes |  | `button.btn:disabled` |
| 1023 | shared | kit+V1-today+V2-study+V3-notes+P-progress+V3-record+V3-new | yes |  | `.badge` |
| 1024 | shared | kit+V1-today+V2-study+V3-notes+P-progress+V3-record+V3-new | yes |  | `.badge::before` |
| 1025 | shared | kit+V2-study+V1-today+E2+E3+U1 | no |  | `.badge.proposed` |
| 1026 | single | V2-study | no |  | `.badge:is(.x-green,.x-yellow,.x-red,.x-blue,.x-violet,.x-quiet,.proposed)` |
| 1027 | single | kit | no |  | `.title .row-badge` |
| 1030 | shared | kit+U1+V1-today+V2-study+V3-notes+P-progress+P-system+E2+E3 | yes |  | `.seg` |
| 1031 | shared | kit+U1+V1-today+V2-study+V3-notes+P-progress+P-system+E2+E3 | yes |  | `.seg button` |
| 1032 | shared | kit+U1+V1-today+V2-study+V3-notes+P-progress+P-system+E2+E3 | yes |  | `.seg button:hover` |
| 1033 | shared | kit+U1+V1-today+V2-study+V3-notes+P-progress+P-system+E2+E3 | no |  | `.seg button:is([aria-pressed="true"],[aria-checked="true"])` |
| 1035 | shared | kit+U1 | yes |  | `.ui-card` |
| 1036 | shared | kit+U1 | no |  | `.ui-card>h3` |
| 1038 | shared | kit+V2-study+V1-today+V3-notes+P-progress+V3-record+P-system+E1+E2+E3 | yes |  | `.li` |
| 1039 | shared | kit+V2-study+V1-today+V3-notes+P-progress+V3-record+P-system+E1+E2+E3 | yes |  | `.li:hover` |
| 1040 | shared | kit+V1-today+V2-study+V3-notes+P-progress+V3-record+E2 | yes |  | `.li .nm` |
| 1041 | shared | kit+V2-study+V1-today+V3-notes+P-progress+V3-record+P-system+E1+E2+E3 | yes |  | `.li .t` |
| 1042 | shared | kit+V1-today+V3-notes | yes |  | `.li .hov` |
| 1043 | shared | kit+V1-today+V3-notes | yes |  | `.li:hover .hov,.li:focus-within .hov` |
| 1045 | shared | U1+V1-today+V2-study+V3-notes+P-progress+V3-record | yes |  | `.toolbar` |
| 1046 | shared | U1+V1-today+V2-study+V3-notes+P-progress+V3-record | yes |  | `.toolbar .sp` |
| 1048 | shared | kit+V1-today+V2-study | yes |  | `.pbar` |
| 1049 | shared | kit+V1-today+V2-study | no |  | `.pbar>i` |
| 1051 | shared | kit+V2-study+E2+E3+E1+U1 | no |  | `.field` |
| 1052 | shared | kit+V2-study+E2+E3+E1+U1 | no |  | `.field:focus-within` |
| 1053 | shared | kit+V2-study+E2+E3+E1+U1 | no |  | `.field :is(input,textarea)` |
| 1054 | shared | kit+V2-study+E2+E3+E1+U1 | no |  | `.field ::placeholder` |
| 1056 | shared | kit+U1+V2-study+V1-today+V3-notes+P-progress+V3-record+E1+E2 | yes | (max-width:599px) | `button.btn,button.btn.sm` |
| 1057 | shared | kit+V1-today+V2-study+V3-notes+V3-record+U1 | yes | (max-width:599px) | `button.btn.icon,button.btn.icon.sm` |
| 1058 | shared | kit+U1+V1-today+V2-study+V3-notes+P-progress+P-system+E2+E3 | yes | (max-width:599px) | `.seg` |
| 1059 | shared | kit+U1+V1-today+V2-study+V3-notes+P-progress+P-system+E2+E3 | yes | (max-width:599px) | `.seg button` |
| 1060 | shared | kit+V2-study+V1-today+V3-notes+P-progress+V3-record+P-system+E1+E2+E3 | yes | (max-width:599px) | `.li` |
| 1061 | shared | kit+V1-today+V3-notes | yes | (max-width:599px) | `.li .hov` |
| 1062 | shared | U1+V1-today+V2-study+V3-notes+P-progress+V3-record | yes | (max-width:599px) | `.toolbar` |
| 1063 | shared | kit+V2-study+E2+E3+E1+U1 | no | (max-width:599px) | `.field` |
| 1069 | shared | U1+E2 | yes |  | `.mh .seg` |
| 1071 | shared | U1+E2 | yes |  | `.mh::after` |
| 1072 | shared | U1+E2 | yes |  | `.mh > .sbar` |
| 1073 | shared | V3-new+U1 | yes |  | `.new-wrap .menu` |
| 1074 | shared | V3-new+U1 | yes |  | `.new-wrap .menu[hidden]` |
| 1075 | shared | V3-new+U1 | yes |  | `.new-wrap .menu button.btn.mi` |
| 1078 | shared | V2-study+V3-new+U1 | no |  | `:root[data-theme="dark"] .new-dlg::backdrop` |
| 1079 | shared | V2-study+V3-new+U1 | yes |  | `.new-dlg form` |
| 1081 | shared | V2-study+V3-new+U1 | yes |  | `.new-head` |
| 1082 | shared | V2-study+U1 | yes |  | `.new-body #new-title` |
| 1083 | shared | V2-study+U1 | yes |  | `.new-body #new-title:focus,.new-body #new-title:focus-visible` |
| 1084 | shared | V2-study+U1 | no |  | `.new-body :is(input,textarea)` |
| 1086 | shared | V2-study+U1 | yes |  | `.new-body #new-text` |
| 1087 | shared | V2-study+U1 | yes |  | `.new-body #new-text:focus,.new-body #new-text:focus-visible` |
| 1088 | shared | V2-study+U1 | no |  | `.new-body :is(#new-title,#new-text)::placeholder` |
| 1089 | single | U1 | yes |  | `.new-fields .frow[hidden]` |
| 1090 | shared | V2-study+U1 | yes |  | `.new-body #new-warn` |
| 1092 | shared | V3-new+U1 | yes |  | `.new-fields` |
| 1093 | shared | V3-new+U1 | yes |  | `.new-fields[hidden]` |
| 1094 | single | U1 | yes |  | `.new-fields .frow` |
| 1095 | shared | V3-new+U1 | yes |  | `.new-fields .seg` |
| 1096 | shared | V3-new+U1 | no |  | `.new-fields .seg button` |
| 1097 | shared | V3-new+U1 | no | (max-width:599px) | `.new-fields .seg button` |
| 1099 | shared | V3-new+U1 | yes |  | `.new-fields #new-date` |
| 1100 | shared | V3-new+U1 | yes |  | `.new-fields #new-date:focus,.new-fields #new-date:focus-visible` |
| 1101 | shared | V3-new+U1 | yes | (max-width:599px) | `.new-fields #new-date` |
| 1102 | shared | V2-study+U1 | yes |  | `.new-foot #new-hint` |
| 1104 | shared | V3-new+U1 | yes | (max-width:599px) | `.new-wrap .menu` |
| 1105 | shared | V3-new+U1 | yes | (max-width:599px) | `.new-wrap .menu button.btn.mi` |
| 1111 | single | V1-today | yes |  | `#today-list .ti-list,#today-list .ti-folded` |
| 1112 | shared | V1-today+U1 | yes |  | `#today-list .li` |
| 1113 | single | V1-today | yes |  | `#today-list .li .tk` |
| 1114 | shared | V1-today+U1 | yes |  | `#today-list .li input.tick` |
| 1115 | shared | V1-today+U1 | yes |  | `#today-list .li input.tick:checked` |
| 1116 | shared | V1-today+U1 | yes |  | `#today-list .li input.tick:checked::after` |
| 1117 | shared | V1-today+U1 | yes |  | `#today-list .li .nm` |
| 1118 | single | V1-today | yes |  | `#today-list .li .nm:hover .ti-t` |
| 1119 | shared | V1-today+U1 | yes |  | `#today-list .li .nm:focus-visible` |
| 1120 | single | V1-today | no |  | `#today-list .li.done .ti-t` |
| 1121 | shared | V1-today+U1 | yes |  | `#today-list .li .t` |
| 1122 | single | V1-today | no |  | `#today-list .ti-fold` |
| 1123 | single | V1-today | no |  | `#today-list .ti-fold:focus-visible` |
| 1124 | single | V1-today | no |  | `#today-list .ti-folded .row` |
| 1125 | dead | V1-today | no |  | `#today-list .ti-folded .row.ti-hint` |
| 1127 | shared | V1-today+U1 | yes | (max-width:599px) | `#today-list .li` |
| 1128 | single | V1-today | yes | (max-width:599px) | `#today-list .li .tk` |
| 1129 | shared | V1-today+U1 | yes | (max-width:599px) | `#today-list .li input.tick` |
| 1130 | shared | V1-today+U1 | yes | (max-width:599px) | `#today-list .li .badge` |
| 1131 | single | V1-today | yes | (max-width:599px) | `#today-list .li .ti-start` |
| 1132 | single | V1-today | no | (max-width:599px) | `#today-list .ti-folded .row` |
| 1133 | single | V1-today | no | (max-width:599px) | `#today-list .ti-fold` |
| 1141 | single | V1-today | yes |  | `#today-budget` |
| 1142 | single | V1-today | yes |  | `#today-budget .tb-big` |
| 1143 | single | V1-today | yes |  | `#today-budget .tb-bar` |
| 1144 | single | V1-today | no |  | `#today-budget .tb-bar>i.tb-neutral` |
| 1145 | single | V1-today | yes |  | `#today-budget .tb-done-line` |
| 1146 | single | V1-today | no |  | `#p-today .tb-over:not(.pbar)` |
| 1147 | single | V1-today | no |  | `#today-budget .tb-over-line` |
| 1148 | dead | V1-today+U1 | no |  | `#today-list .card-head .tb-short` |
| 1149 | dead | V1-today+U1 | no | (min-width:1200px) | `#today-list .card-head .tb-short` |
| 1153 | single | V1-today | no |  | `#today-changes .row` |
| 1154 | single | V1-today | no |  | `#today-changes .row .title` |
| 1159 | shared | V1-today+U1 | no |  | `#today-list .card-head` |
| 1160 | single | V1-today | no |  | `#today-list .card-head .ti-rest` |
| 1161 | dead | V1-today | no |  | `#today-list .card-head .tb-short+.ti-rest` |
| 1162 | single | V1-today | no |  | `#today-list .ti-review` |
| 1163 | single | V1-today | no |  | `#today-list .ti-review-t` |
| 1164 | dead | V1-today+U1 | no |  | `#today-list .li .ti-gap` |
| 1165 | single | V1-today | no |  | `#today-list .li.ti-prop .nm` |
| 1166 | single | V1-today | no |  | `#today-list .li.ti-prop .nm:hover .ti-t` |
| 1168 | single | V1-today | no | (max-width:599px) | `#today-list .ti-review` |
| 1169 | single | V1-today | no | (max-width:599px) | `#today-list .ti-review-t` |
| 1176 | single | V1-today | no |  | `#p-today .wk-away` |
| 1177 | single | V1-today | no |  | `#p-today>#seg-today` |
| 1178 | single | V1-today | no |  | `.mh #seg-today` |
| 1179 | single | V1-today | yes |  | `#today-week` |
| 1180 | single | V1-today | no |  | `#today-week .wk-her` |
| 1181 | single | V1-today | no |  | `.wk-days` |
| 1182 | single | V1-today | no |  | `.wk-day` |
| 1183 | single | V1-today | no |  | `.wk-day:first-child` |
| 1184 | single | V1-today | no |  | `.wk-day.today` |
| 1185 | single | V1-today | no |  | `.wk-h` |
| 1186 | single | V1-today | no |  | `.wk-h b` |
| 1187 | single | V1-today | no |  | `.wk-day.today .wk-h b` |
| 1188 | single | V1-today | no |  | `.wk-chips` |
| 1189 | single | V1-today | no |  | `.wchip` |
| 1190 | single | V1-today | no |  | `.wchip:hover` |
| 1191 | single | V1-today | no |  | `.wchip:focus-visible` |
| 1192 | single | V1-today | no |  | `.wchip[aria-pressed="true"]` |
| 1193 | single | V1-today | no |  | `.wchip.exam .wc-t` |
| 1194 | single | V1-today | no |  | `.wchip .wc-t,.wchip .wc-s` |
| 1195 | single | V1-today | no |  | `.wchip .wc-s` |
| 1196 | single | V1-today | no |  | `.wchip .wc-s.urgent` |
| 1197 | single | V1-today | no |  | `.wchip.off .wc-t` |
| 1198 | single | V1-today | no |  | `.wchip.wk-list .wc-t` |
| 1199 | single | V1-today | no |  | `.wchip.wk-load.done .wc-t` |
| 1200 | single | V1-today | yes |  | `#today-date` |
| 1203 | single | V1-today | no |  | `button.wk-h` |
| 1204 | single | V1-today | no |  | `button.wk-h:hover b` |
| 1205 | single | V1-today | no |  | `button.wk-h:focus-visible` |
| 1206 | single | V1-today | no |  | `button.wk-h[aria-pressed="true"]>span:first-child` |
| 1207 | single | V1-today | no |  | `.wchip.wk-task .wc-t` |
| 1208 | single | V1-today | no |  | `.wchip.wk-task.done .wc-t,#today-date .wd-task.done .wd-tt` |
| 1209 | single | V1-today | no |  | `#today-date .wd-tasks` |
| 1210 | single | V1-today | no |  | `#today-date .wd-task` |
| 1211 | single | V1-today | no |  | `#today-date .wd-task:first-child` |
| 1212 | single | V1-today | no |  | `#today-date .wd-tt` |
| 1213 | single | V1-today | no |  | `#today-date .wd-tasks>.mini` |
| 1214 | single | V1-today | no |  | `#today-date .wd-cal` |
| 1215 | single | V1-today | no |  | `#today-date .wd-cal .wchip` |
| 1218 | single | V1-today | yes |  | `#today-date.wk-panel` |
| 1219 | single | V1-today | yes |  | `#today-date[hidden]` |
| 1220 | single | V1-today | no |  | `#today-date .wd-badge` |
| 1221 | single | V1-today | no |  | `#today-date .wd-title` |
| 1222 | single | V1-today | no |  | `#today-date .wd-props` |
| 1223 | single | V1-today | no |  | `#today-date .wd-props .prop` |
| 1224 | single | V1-today | no |  | `#today-date .wd-props .prop-k` |
| 1225 | single | V1-today | no |  | `#today-date .wd-props .prop-v` |
| 1226 | single | V1-today | no |  | `#today-date .wd-acts` |
| 1227 | single | V1-today | no |  | `#today-date .wd-acts .btn` |
| 1228 | dead | V1-today | no |  | `#today-task .wk-props .prop,#today-date .wk-props .prop` |
| 1229 | dead | V1-today | no |  | `#today-task .wk-props .prop:last-child,#today-date .wk-props .prop:last-child` |
| 1230 | single | V1-today | yes |  | `#today-task .prop-k,#today-date .prop-k` |
| 1231 | single | V1-today | yes |  | `#today-task .prop-v,#today-date .prop-v` |
| 1232 | single | V1-today | yes |  | `#today-task .wk-acts,#today-date .wk-acts` |
| 1234 | single | V1-today | no | (min-width:1200px) | `.wk-days` |
| 1235 | single | V1-today | no | (min-width:1200px) | `.wk-day` |
| 1236 | single | V1-today | no | (min-width:1200px) | `.wk-day:first-child` |
| 1237 | single | V1-today | no | (min-width:1200px) | `.wk-h` |
| 1238 | single | V1-today | no | (min-width:1200px) | `.wk-chips` |
| 1239 | single | V1-today | no | (min-width:1200px) | `.wchip` |
| 1242 | single | V1-today | no | (max-width:599px) | `.wk-day` |
| 1243 | single | V1-today | no | (max-width:599px) | `.wk-h` |
| 1244 | single | V1-today | no | (max-width:599px) | `.wk-chips` |
| 1245 | single | V1-today | no | (max-width:599px) | `.wchip` |
| 1246 | single | V1-today | no | (max-width:599px) | `#today-date .wd-props .prop` |
| 1247 | single | V1-today | no | (max-width:599px) | `#today-date .wd-acts .btn` |
| 1248 | single | V1-today | no | (max-width:599px) | `button.wk-h` |
| 1254 | shared | V1-today+U1 | yes |  | `#today-list .li.sel` |
| 1255 | single | V1-today | yes |  | `#today-task` |
| 1256 | single | V1-today | yes |  | `#today-taskmain .tp-from` |
| 1257 | single | V1-today | yes |  | `#today-task .wk-acts` |
| 1258 | single | V1-today | yes |  | `#today-taskmain .tp-from .meta,#today-task .tp-note` |
| 1261 | single | V1-today | yes |  | `#today-task.tp-panel` |
| 1262 | single | V1-today | yes |  | `#today-task[hidden]` |
| 1263 | single | V1-today | no |  | `.col-side>.tk-away,.col-main>.tk-away` |
| 1264 | single | V1-today | yes |  | `#today-task .tp-props` |
| 1265 | single | V1-today | yes |  | `#today-task .tp-props .prop` |
| 1266 | single | V1-today | yes |  | `#today-task .tp-props .prop-k` |
| 1267 | single | V1-today | yes |  | `#today-task .tp-props .prop-v` |
| 1268 | single | V1-today | yes |  | `#today-task .tp-seg` |
| 1269 | single | V1-today | yes |  | `#today-task .tp-seg button` |
| 1270 | single | V1-today | yes |  | `#today-task .tp-seg button:hover` |
| 1271 | single | V1-today | yes |  | `#today-task .tp-seg button.on` |
| 1272 | single | V1-today | yes |  | `#today-task .tp-seg button:focus-visible` |
| 1273 | single | V1-today | yes |  | `#today-task .wk-acts` |
| 1274 | single | V1-today | yes |  | `#today-task .wk-acts .btn` |
| 1275 | single | V1-today | yes |  | `#today-task .tp-note` |
| 1276 | single | V1-today | yes |  | `#today-taskmain .tp-from` |
| 1277 | single | V1-today | yes |  | `#today-taskmain .tp-from .prop-k` |
| 1280 | single | V1-today | yes |  | `#today-taskmain .tp-chk` |
| 1281 | single | V1-today | yes |  | `#today-taskmain .tp-chk svg` |
| 1282 | single | V1-today | yes |  | `#today-taskmain .tp-chk:hover` |
| 1283 | single | V1-today | yes |  | `#today-taskmain .tp-chk:not(.done):hover svg` |
| 1284 | single | V1-today | no |  | `#today-taskmain .tp-chk.done` |
| 1285 | single | V1-today | no |  | `#today-taskmain .tp-chk.done svg` |
| 1286 | single | V1-today | yes |  | `#today-taskmain .tp-chk:focus-visible` |
| 1287 | single | V1-today | no |  | `#today-taskmain .tp-desc` |
| 1288 | single | V1-today | yes |  | `#today-taskmain .tp-from` |
| 1289 | single | V1-today | yes |  | `#today-taskmain .tp-act` |
| 1290 | single | V1-today | yes |  | `#today-taskmain .tp-dot` |
| 1291 | single | V1-today | yes |  | `#today-taskmain .tp-what` |
| 1292 | single | V1-today | yes |  | `#today-taskmain .tp-when` |
| 1294 | single | V1-today | yes | (max-width:599px) | `#today-task .tp-props .prop` |
| 1295 | single | V1-today | yes | (max-width:599px) | `#today-task .tp-seg button` |
| 1296 | single | V1-today | yes | (max-width:599px) | `#today-task .wk-acts .btn` |
| 1302 | single | V1-today | no |  | `#p-today>.today-bar` |
| 1303 | single | V1-today | no |  | `#p-today>.today-bar .seg` |
| 1304 | single | V1-today | no |  | `#p-today>.today-bar .seg button` |
| 1305 | single | V1-today | no |  | `#p-today>.today-bar .seg button:hover` |
| 1306 | single | V1-today | no |  | `#p-today>.today-bar .seg button[aria-pressed="true"]` |
| 1307 | single | V1-today | no |  | `#p-today>.today-bar .seg button i` |
| 1308 | single | V1-today | no |  | `#p-today>.today-bar svg.ico` |
| 1309 | single | V1-today | no |  | `#p-today>.today-bar .wk-nav` |
| 1310 | single | V1-today | no |  | `#p-today>.today-bar .wk-range` |
| 1311 | single | V1-today | no |  | `#p-today>.today-bar .sp` |
| 1312 | shared | V1-today+U1 | yes |  | `#p-today` |
| 1313 | shared | V1-today+U1 | no |  | `#p-today>.cols` |
| 1314 | shared | V1-today+U1 | yes |  | `#today-list` |
| 1315 | single | V1-today | yes |  | `#today-list .ti-list` |
| 1316 | single | V1-today | no |  | `#today-list .ti-list>.li` |
| 1317 | single | V1-today | no |  | `#today-list .ti-list>.li:hover` |
| 1318 | shared | V1-today+U1 | yes |  | `#today-list .li .t` |
| 1319 | shared | V1-today+U1 | yes |  | `#today-list .li .nm` |
| 1320 | shared | V1-today+U1 | no |  | `#today-list .li>.badge,#today-list .li>.nm:not(:has(+ .badge))` |
| 1321 | single | V1-today | no |  | `#today-list .ti-fold` |
| 1322 | single | V1-today | no |  | `#today-list .ti-folded` |
| 1323 | single | V1-today | no |  | `#today-list .ti-folded>.li` |
| 1324 | single | V1-today | no |  | `#today-list .ti-folded .row` |
| 1325 | shared (part dead: #today-list>.ti-live) | V1-today+U1 | no |  | `#today-list>.empty,#today-list>.ti-live` |
| 1326 | single | V1-today | no |  | `#today-list .ti-review` |
| 1327 | single | V1-today | yes |  | `#today-budget` |
| 1328 | single | V1-today | no |  | `#p-today #today-budget>h2` |
| 1329 | single | V1-today | yes |  | `#today-budget .tb-big` |
| 1330 | single | V1-today | yes |  | `#today-budget .tb-bar` |
| 1331 | single | V1-today | yes |  | `#today-budget .prop` |
| 1332 | single | V1-today | yes |  | `#today-budget .prop .prop-k` |
| 1333 | single | V1-today | no |  | `#today-week .wk-her` |
| 1334 | single | V1-today | yes |  | `#today-week` |
| 1335 | single | V1-today | no |  | `#today-week .wk-days` |
| 1337 | single | V1-today | no | (min-width:1200px) | `#today-week .wk-days` |
| 1338 | single | V1-today | no | (min-width:1200px) | `#today-week .wk-day` |
| 1339 | single | V1-today | no | (min-width:1200px) | `#today-week .wk-chips` |
| 1340 | single | V1-today | no | (min-width:1200px) | `#today-week .wchip` |
| 1341 | single | V1-today | no | (min-width:1200px) | `#today-week .wchip .wc-t` |
| 1342 | single | V1-today | no | (min-width:1200px) | `#today-week .wk-h` |
| 1343 | single | V1-today | no | (min-width:1200px) | `#today-week .wk-h b` |
| 1346 | single | V1-today | no | (min-width:600px) and (max-width:1199px) | `#today-week .wchip .wc-t` |
| 1349 | single | V1-today | no | (max-width:599px) | `#p-today>.today-bar` |
| 1350 | single | V1-today | no | (max-width:599px) | `#p-today>.today-bar .seg button` |
| 1351 | single | V1-today | no | (max-width:599px) | `#today-list .ti-list>.li` |
| 1352 | single | V1-today | no | (max-width:599px) | `#today-list .ti-folded>.li` |
| 1353 | shared | V1-today+U1 | yes | (max-width:599px) | `#today-list .li .t` |
| 1354 | single | V1-today | no | (max-width:599px) | `#today-list .ti-list>.li .nm` |
| 1355 | single | V1-today | no | (max-width:599px) | `#today-list .ti-list>.li .nm .ti-t` |
| 1356 | single | V1-today | no | (max-width:599px) | `#today-list .ti-fold` |
| 1357 | single | V1-today | no | (max-width:599px) | `#today-week .wchip .wc-t` |
| 1362 | single | V1-today | no |  | `#today-list .ti-list>.li,#today-list .ti-folded>.li` |
| 1363 | single | V1-today | no |  | `#today-week .wchip .wc-t` |
| 1364 | single | V1-today | yes | (max-width:1199px) | `#p-today #today-budget` |
| 1364 | single | V1-today | yes | (max-width:1199px) | `#p-today #today-changes` |
| 1366 | single | V1-today | no | (min-width:1200px) | `#today-week .wk-days` |
| 1367 | single | U1 | no | (min-width:1200px) | `body.has-line #today-week .wk-days` |
| 1370 | single | V1-today | no | (max-width:599px) | `#today-list .ti-list>.li,#today-list .ti-folded>.li` |
| 1371 | single | V1-today | no | (max-width:599px) | `#today-list .ti-list>.li .nm,#today-list .ti-folded>.li .nm` |
| 1372 | single | V1-today | yes | (max-width:599px) | `#today-list .li .nm .ti-t` |
| 1373 | shared | V1-today+U1 | no | (max-width:599px) | `#today-list .li>.badge` |
| 1374 | shared | V1-today+U1 | no | (max-width:599px) | `#today-list .li>.nm:not(:has(+ .badge))` |
| 1375 | shared | V1-today+U1 | yes | (max-width:599px) | `#today-list .li .t` |
| 1380 | single | V1-today | no |  | `#p-today>.today-bar .ti-add` |
| 1381 | single | V1-today | no |  | `#today-list .grp` |
| 1382 | single | V1-today | no |  | `#today-list .grp svg.ico` |
| 1383 | single | V1-today | no |  | `#today-list .grp:focus-visible` |
| 1384 | single | V1-today | no |  | `#today-week .wchip .wc-s` |
| 1385 | single | V1-today | no |  | `#today-week .wchip .dot` |
| 1386 | single | V1-today | no |  | `#today-week .wchip.past .wc-t` |
| 1387 | single | V1-today | no |  | `#today-week .wchip.wk-list .wc-t` |
| 1388 | single | V1-today | no |  | `#today-week .wchip[aria-pressed="true"]` |
| 1389 | single | V1-today | no |  | `#today-date .wd-next` |
| 1390 | single | V1-today | no |  | `#today-date .lab` |
| 1391 | single | V1-today | no |  | `#today-date .mini` |
| 1392 | single | V1-today | no |  | `#today-date .wd-nx` |
| 1393 | single | V1-today | no |  | `#today-date .hb` |
| 1394 | single | V1-today | no |  | `#today-date .hb>i` |
| 1395 | single | V1-today | no |  | `#today-date .wd-sum` |
| 1396 | single | V1-today | no |  | `#today-date .wd-sum-l` |
| 1397 | single | V1-today | no |  | `#today-date .wd-sum .dot` |
| 1398 | single | V1-today | no | (max-width:599px) | `#today-list .grp` |
| 1403 | shared | V1-today+U1 | yes |  | `#today-list .li svg.ico` |
| 1404 | shared | V1-today+U1 | no |  | `#today-list .li>svg.ico` |
| 1405 | shared | V1-today+U1 | no |  | `#today-list .li .sp` |
| 1406 | shared | V1-today+U1 | no |  | `#today-list .li:has(>.sp)>.badge` |
| 1407 | single | V1-today | no |  | `#today-list .li .pmark` |
| 1408 | single | V1-today | no |  | `#today-list .ti-list>.li.ti-padd` |
| 1409 | single | V1-today | no |  | `#today-list .ti-list>.li.ti-padd:hover` |
| 1410 | single | V1-today | no |  | `#today-list .li.ti-off .ti-t` |
| 1411 | single | V1-today | no | (min-width:1200px) | `#today-week .wk-days` |
| 1412 | single | V1-today | no |  | `#today-week .wchip .wc-t` |
| 1414 | single | V1-today | no | (max-width:599px) | `#today-list .ti-list>.li,#today-list .ti-folded>.li` |
| 1415 | single | V1-today | no | (max-width:599px) | `#today-list .ti-list>.li .nm,#today-list .ti-folded>.li .nm` |
| 1416 | shared | V1-today+U1 | no | (max-width:599px) | `#today-list .li>.badge` |
| 1417 | single | V1-today | no | (max-width:599px) | `#today-list .ti-list>.li.ti-padd` |
| 1422 | single | V1-today | no | (min-width:1200px) | `#today-week .wk-days` |
| 1423 | single | V1-today | no |  | `#today-week .wchip .wc-t` |
| 1424 | single | V1-today | no |  | `#today-week .wchip.wk-list .wc-s` |
| 1425 | single | V1-today | yes |  | `#today-list .li .ti-start` |
| 1426 | single | V1-today | yes |  | `#today-list .li .ti-start svg.ico` |
| 1427 | single | V1-today | yes |  | `#today-changes` |
| 1428 | single | V1-today | no |  | `#today-changes[hidden]` |
| 1429 | single | V1-today | yes |  | `#today-changes .lab` |
| 1430 | single | V1-today | no |  | `#today-changes .chg` |
| 1431 | single | V1-today | no |  | `#today-changes .chg .dot` |
| 1432 | single | V1-today | no |  | `#today-changes .chg-t` |
| 1433 | single | V1-today | no |  | `#today-changes .ct` |
| 1434 | single | V1-today | yes |  | `#today-changes .mini` |
| 1435 | single | V1-today | yes |  | `#today-changes .chg-none` |
| 1438 | single | V1-today | no | (min-width:1200px) | `#today-week .wk-days` |
| 1439 | single | V1-today | no |  | `#today-week .wchip .wc-t` |
| 1440 | single | V1-today | no |  | `#today-week .wchip.wk-list .wc-t` |
| 1441 | single | V1-today | no |  | `#today-week .wchip.wk-list .wc-s` |
| 1442 | single | V1-today | no |  | `#today-week .wchip.wk-list .wc-s .dot` |
| 1443 | single | V1-today | no |  | `#today-list .ti-list>.li.today-item:not(.ti-off),#today-list .ti-folded>.li.today-item` |
| 1445 | single | E3 | yes |  | `#ev-dates .wk-line .when` |
| 1450 | single | V1-today | yes |  | `button.btn.mh-back` |
| 1451 | single | V1-today | yes |  | `body[data-view="today"].task-open .mh button.btn.mh-back` |
| 1452 | single | V1-today | yes |  | `body[data-view="today"].task-open .mh button.btn.mh-back:hover` |
| 1453 | single | V1-today | yes |  | `.mh .mh-back svg` |
| 1455 | single | V1-today | yes |  | `body[data-view="today"].task-open` |
| 1456 | single | V1-today | no |  | `#p-today.tk-open>#today-bar` |
| 1457 | single | V1-today | yes |  | `#today-taskmain[hidden]` |
| 1458 | single | V1-today | yes |  | `#today-taskmain` |
| 1459 | single | V1-today | yes |  | `#today-taskmain .tvh` |
| 1460 | single | V1-today | yes |  | `#today-taskmain .tvh .sp` |
| 1461 | single | V1-today | yes |  | `#today-taskmain .tvh .mini` |
| 1462 | single | V1-today | yes |  | `#today-taskmain .tvh-pos` |
| 1463 | single | V1-today | yes |  | `#today-taskmain .tvh .btn.icon` |
| 1464 | single | V1-today | yes |  | `#today-taskmain .tvh .btn.icon:hover` |
| 1465 | single | V1-today | yes |  | `#today-taskmain .tvh .btn.icon svg` |
| 1466 | single | V1-today | yes |  | `#today-taskmain .tvb` |
| 1467 | single | V1-today | yes |  | `#today-taskmain .tvb-title` |
| 1468 | single | V1-today | yes |  | `#today-taskmain .tvb-title h2` |
| 1469 | single | V1-today | yes |  | `#today-taskmain .tp-chk` |
| 1470 | single | V1-today | no |  | `#today-taskmain .tp-desc` |
| 1471 | single | V1-today | yes |  | `#today-taskmain .tp-from` |
| 1472 | single | V1-today | yes |  | `#today-taskmain .tp-from .prop-k` |
| 1473 | single | V1-today | no |  | `#today-taskmain .tp-gone` |
| 1475 | single | V1-today | no |  | `#today-taskmain .tv-quiz` |
| 1477 | single | V1-today | yes | (max-width:1199px) | `#p-today.tk-open #today-task` |
| 1480 | single | V1-today | yes | (max-width:599px) | `body[data-view="today"].task-open .mh button.btn.mh-back` |
| 1481 | single | V1-today | yes | (max-width:599px) | `.mh .mh-back svg` |
| 1482 | single | V1-today | yes | (max-width:599px) | `#today-taskmain .tvh` |
| 1483 | single | V1-today | yes | (max-width:599px) | `#today-taskmain .tvh .btn.icon` |
| 1484 | single | V1-today | yes | (max-width:599px) | `#today-taskmain .tvb` |
| 1485 | single | V1-today | no | (max-width:599px) | `#today-taskmain .tv-quiz` |
| 1486 | single | V1-today | yes | (max-width:599px) | `#today-taskmain .tp-chk` |
| 1487 | single | V1-today | yes | (max-width:599px) | `#today-taskmain .tp-chk::before` |
| 1488 | single | V1-today | no | (max-width:599px) | `#today-taskmain .tp-chk.done` |
| 1489 | single | V1-today | no | (max-width:599px) | `#today-taskmain .tp-chk.done::before` |
| 1490 | single | V1-today | yes | (max-width:599px) | `#today-taskmain .tp-chk svg` |
| 1500 | single | U1 | yes |  | `#p-study .sbar-study` |
| 1501 | single | U1 | no |  | `#p-study .sbar-study:not(:has(> :not([hidden],.sp,#seg-study)))` |
| 1503 | shared | U1+V2-study+E3 | yes |  | `#seg-study` |
| 1504 | single | U1 | yes |  | `#p-study .sbar-study .seg` |
| 1505 | shared | V2-study+U1 | yes |  | `#study-course .code` |
| 1506 | shared | V2-study+U1 | yes |  | `#study-objectives` |
| 1507 | shared | V2-study+U1 | no |  | `#study-objectives[hidden]` |
| 1508 | shared | V2-study+U1 | yes |  | `.ov-card` |
| 1509 | shared | V2-study+U1 | no |  | `.ov-card[hidden]` |
| 1510 | single | V2-study | yes |  | `.ov-head` |
| 1511 | single | V2-study | yes |  | `.ov-head .ov-ex` |
| 1512 | single | V2-study | yes |  | `.ov-head .meta` |
| 1513 | single | V2-study | yes |  | `.ov-bar.pbar` |
| 1514 | single | V2-study | yes |  | `.ov-rows` |
| 1515 | single | V2-study | yes |  | `.ov .obj` |
| 1516 | single | V2-study | yes |  | `.ov:last-child .obj` |
| 1517 | single | V2-study | yes |  | `.obj .badge` |
| 1518 | single | V2-study | yes |  | `.obj .nm` |
| 1519 | single | V2-study | yes |  | `.obj .badge:not([class*=" x-"])` |
| 1520 | single | V2-study | yes |  | `.obj .nm:hover` |
| 1521 | single | V2-study | yes |  | `.obj.on .nm` |
| 1522 | single | V2-study | yes |  | `.obj .ow` |
| 1523 | single | V2-study | yes |  | `.obj .oq` |
| 1524 | single | V2-study | yes |  | `.obj:hover .oq,.obj:focus-within .oq` |
| 1525 | single | V2-study | yes |  | `.ov-detail` |
| 1526 | single | V2-study | yes |  | `.ov-detail .lab` |
| 1527 | single | V2-study | yes |  | `.ov-detail .od-name` |
| 1528 | single | V2-study | yes |  | `.ov-detail .od-row` |
| 1529 | single | V2-study | yes |  | `.ov-detail .mini` |
| 1530 | single | V2-study | yes |  | `.ov-detail .od-note` |
| 1531 | single | V2-study | yes |  | `.ov-detail .od-ws` |
| 1532 | single | V2-study | yes |  | `.ov-detail .od-ws .sn` |
| 1533 | single | V2-study | yes |  | `.ov-detail .od-ws .st` |
| 1534 | single | V2-study | yes |  | `.ov-detail .od-q` |
| 1535 | dead | V2-study | no |  | `.ov-detail .od-task` |
| 1536 | dead | V2-study | no |  | `.ov-detail .od-task .sn` |
| 1537 | single | V2-study | yes |  | `.ov-detail .dot,.ov-up .dot` |
| 1538 | single | V2-study | yes |  | `.ov > .ov-detail` |
| 1539 | single | V2-study | yes |  | `.ov:last-child > .ov-detail` |
| 1540 | single | V2-study | yes |  | `.ov.open:has(> .ov-detail) .obj` |
| 1541 | single | V2-study | yes |  | `#study-side .ov-detail` |
| 1542 | shared | V2-study+U1 | yes |  | `.ov-grid` |
| 1543 | shared | V2-study+U1 | no |  | `.ov-grid:empty` |
| 1544 | shared | V2-study+U1 | no |  | `.ov-grid > :only-child` |
| 1545 | single | V2-study | no |  | `.ov-grid > .ov-up[hidden] ~ .ov-quiz` |
| 1546 | single | V2-study | yes |  | `.ov-quiz` |
| 1547 | single | V2-study | yes |  | `.ov-quiz .lab` |
| 1548 | single | V2-study | yes |  | `.ov-quiz .mq-q` |
| 1549 | single | V2-study | yes |  | `.ov-quiz .mini` |
| 1550 | single | V2-study | yes |  | `.ov-quiz .mq-row` |
| 1551 | single | V2-study | no |  | `.ov-card .ov-none` |
| 1553 | single | V2-study | no |  | `.ov-card .ov-none-row` |
| 1554 | single | V2-study | no |  | `.ov-card .ov-none-row .ov-none` |
| 1555 | single | V2-study | no |  | `.ov-detail .od-add` |
| 1557 | single | V2-study | yes |  | `.ov-grid > .ov-sets` |
| 1558 | single | V2-study | no |  | `.ov-sets[hidden]` |
| 1559 | single | V2-study | yes |  | `.ov-sets .up-head` |
| 1560 | single | V2-study | yes |  | `.ov-sets .lab` |
| 1561 | single | V2-study | yes |  | `.ov-sets .up-head .mini` |
| 1562 | single | V2-study | yes |  | `.ov-sets .st-list` |
| 1563 | single | V2-study | yes |  | `.ov-sets .st-row` |
| 1564 | single | V2-study | yes |  | `.ov-sets .st-row:last-child` |
| 1565 | single | V2-study | yes |  | `.ov-sets .st` |
| 1566 | single | V2-study | yes |  | `.ov-sets .st:hover` |
| 1567 | single | V2-study | yes |  | `.ov-sets .sn` |
| 1568 | single | V2-study | yes |  | `.ov-sets .stt` |
| 1569 | single | V2-study | yes |  | `.ov-sets .sm,.ov-sets .sd` |
| 1570 | single | V2-study | yes |  | `.ov-sets .sd` |
| 1571 | single | V2-study | yes |  | `.ov-sets .ss` |
| 1572 | single | V2-study | yes |  | `.ov-sets .ss.fin` |
| 1573 | single | V2-study | no |  | `.ov-sets .fold-line` |
| 1574 | single | V2-study | yes |  | `.ov-sets .sx` |
| 1575 | single | V2-study | yes |  | `.pl-t .pl-set` |
| 1577 | single | V1-today | yes |  | `#today-list .li .fc-nm` |
| 1578 | single | V1-today | yes |  | `#today-list .li .fc-nm:hover .ti-t` |
| 1579 | single | V1-today | yes |  | `#today-list .li .fc-nm:focus-visible` |
| 1582 | single | V1-today | yes | (max-width:599px),(hover:none) | `#today-list .li.ti-cards .ti-start` |
| 1589 | single | V3-record | yes |  | `#record-sessions .rec-bar` |
| 1590 | single | V3-record | yes |  | `#record-sessions .rec-bar > .seg` |
| 1591 | single | V3-record | yes |  | `#rec-types button .n` |
| 1592 | single | V3-record | yes |  | `.rec-pop` |
| 1593 | single | V3-record | yes |  | `.rec-pop[hidden]` |
| 1594 | single | V3-record | yes |  | `.rec-pop .lbl` |
| 1595 | single | V3-record | yes |  | `.rec-pop .seg` |
| 1596 | single | V3-record | yes |  | `.rec-pop .seg button` |
| 1597 | single | V3-record | yes |  | `.rec-ck` |
| 1598 | single | V3-record | yes |  | `.rec-ck input` |
| 1599 | single | V3-record | yes |  | `.rec-pop-foot` |
| 1600 | single | V3-record | yes |  | `.rec-list` |
| 1601 | single | V3-record | yes |  | `.rec-li .nm` |
| 1602 | single | V3-record | yes |  | `.rec-li .r` |
| 1603 | single | V3-record | yes |  | `.rec-li .t` |
| 1604 | single | V3-record | yes |  | `.rec-li.sel` |
| 1605 | single | V3-record | yes |  | `.rec-list .rec-detail` |
| 1606 | single | V3-record | yes |  | `.rec-detail` |
| 1607 | single | V3-record | yes |  | `.rec-detail[hidden]` |
| 1608 | single | V3-record | yes |  | `.rec-detail .meta` |
| 1609 | single | V3-record | yes |  | `.rec-detail .idea-acts` |
| 1610 | single | V3-record | yes |  | `.rec-detail select.idea-kind` |
| 1612 | single | V3-record | yes | (max-width:599px) | `#record-sessions .rec-bar` |
| 1613 | single | V3-record | yes | (max-width:599px) | `#record-sessions .rec-bar > .seg` |
| 1614 | single | V3-record | yes | (max-width:599px) | `.rec-pop` |
| 1615 | single | V3-record | yes | (max-width:599px) | `.rec-pop .seg button` |
| 1616 | single | V3-record | yes | (max-width:599px) | `.rec-ck` |
| 1617 | single | V3-record | yes | (max-width:599px) | `.rec-li` |
| 1618 | single | V3-record | yes | (max-width:599px) | `.rec-li .r` |
| 1619 | single | V3-record | yes | (max-width:599px) | `.rec-li .t` |
| 1620 | single | V3-record | yes | (max-width:599px) | `.rec-list .rec-detail` |
| 1621 | single | V3-record | yes | (max-width:599px) | `.rec-detail select.idea-kind` |
| 1626 | shared | V3-record+U1 | yes |  | `#record-sessions` |
| 1627 | single | V3-record | yes |  | `#record-sessions .rec-bar` |
| 1628 | single | V3-record | yes |  | `.rec-fbtn` |
| 1629 | single | V3-record | yes |  | `.rec-fbtn .ico` |
| 1630 | single | V3-record | yes |  | `.rec-pop` |
| 1631 | single | V3-record | yes |  | `.rec-pop .seg` |
| 1632 | single | V3-record | yes |  | `.rec-pop .seg button` |
| 1633 | shared | V3-record+U1 | yes |  | `#record-sessions .cols > .col-main` |
| 1634 | single | V3-record | yes |  | `#record-sessions .rec-list` |
| 1635 | single | V3-record | yes |  | `.rec-li` |
| 1636 | single | V3-record | yes |  | `.rec-li.sel` |
| 1637 | single | V3-record | yes |  | `.rec-li:hover` |
| 1638 | single | V3-record | yes |  | `.rec-li .r` |
| 1639 | single | V3-record | yes |  | `.rec-detail` |
| 1640 | single | V3-record | yes |  | `.rec-props` |
| 1641 | single | V3-record | yes |  | `.rec-list .rec-detail` |
| 1643 | single | V3-record | no | (min-width:1200px) | `section.panel > .cols > .col-side .rec-detail` |
| 1646 | single | V3-record | yes | (max-width:599px) | `#record-sessions .rec-bar` |
| 1647 | single | V3-record | yes | (max-width:599px) | `#record-sessions .rec-bar > .seg` |
| 1648 | single | V3-record | yes | (max-width:599px) | `.rec-li` |
| 1649 | single | V3-record | yes | (max-width:599px) | `.rec-list .rec-detail` |
| 1654 | single | V3-record | yes |  | `.rec-li` |
| 1655 | single | V3-record | yes |  | `.rec-li .nm` |
| 1656 | single | V3-record | yes |  | `.rec-li .r` |
| 1658 | single | V3-record | yes | (max-width:599px) | `.rec-li` |
| 1659 | single | V3-record | yes | (max-width:599px) | `.rec-li .nm` |
| 1660 | single | V3-record | yes | (max-width:599px) | `.rec-li .r` |
| 1661 | single | V3-record | yes | (max-width:599px) | `.rec-li .t` |
| 1666 | single | V3-record | yes | (max-width:599px) | `.rec-li` |
| 1667 | single | V3-record | yes | (max-width:599px) | `.rec-li .nm` |
| 1668 | single | V3-record | yes | (max-width:599px) | `.rec-li .r,.rec-li .t` |
| 1669 | single | V3-record | no | (max-width:599px) | `.rec-li .r:empty` |
| 1675 | base |  | yes |  | `:root` |
| 1676 | shared | P-progress+U1 | yes |  | `.evline` |
| 1679 | shared | P-progress+U1 | yes |  | `.evline[hidden]` |
| 1680 | shared | P-progress+U1 | yes |  | `.evline .el-ico` |
| 1681 | single | U1 | yes |  | `.evline .el-t` |
| 1682 | shared | P-progress+U1 | yes |  | `.evline .btn` |
| 1683 | single | U1 | no |  | `body.has-line #today-week .wk-her` |
| 1685 | shared | P-progress+U1 | yes | (min-width:600px) | `.evline` |
| 1686 | single | U1 | yes | (min-width:600px) | `body.has-line` |
| 1692 | single | U1 | yes |  | `#p-record > .panel` |
| 1693 | single | U1 | yes |  | `#p-record > .panel .rec-bar` |
| 1694 | single | U1 | yes |  | `#p-record > .panel .rec-bar > .seg` |
| 1695 | single | U1 | yes |  | `#p-record > .panel .seg button .n` |
| 1696 | single | U1 | yes |  | `#p-record > .panel .cols > .col-main` |
| 1697 | single | U1 | no |  | `#p-record .rec-list > .empty` |
| 1699 | single | U1 | yes | (max-width:599px) | `#p-record > .panel .rec-bar` |
| 1700 | single | U1 | yes | (max-width:599px) | `#p-record > .panel .rec-bar > .seg` |
| 1701 | single | U1 | no | (max-width:599px) | `#p-record .rec-list > .empty` |
| 1706 | single | E2 | no |  | `.mh>#sbar .s-topic` |
| 1708 | shared | U1+E2 | no | (max-width:599px) | `.mh:has(>#sbar:not([hidden]))` |
| 1709 | shared | U1+E2 | no | (max-width:599px) | `.mh:has(>#sbar:not([hidden]))::before` |
| 1710 | shared | U1+E2 | no | (max-width:599px) | `.mh>#sbar` |
| 1711 | single | E2 | no | (max-width:599px) | `.mh>#sbar .s-led` |
| 1712 | single | E2 | no | (max-width:599px) | `.mh>#sbar .s-main` |
| 1713 | single | E2 | no | (max-width:599px) | `.mh>#sbar .s-topic` |
| 1714 | single | E2 | no | (max-width:599px) | `.mh>#sbar .s-topic::after` |
| 1715 | single | E2 | no | (max-width:599px) | `.mh>#sbar .s-clock` |
| 1716 | single | E2 | no | (max-width:599px) | `.mh>#sbar .s-acts` |
| 1717 | single | E2 | no | (max-width:599px) | `.mh>#sbar .s-acts button:not(.end):not(:first-child)` |
| 1718 | single | E2 | no | (max-width:599px) | `.mh>#sbar .s-acts button.btn` |
| 1722 | shared | kit+E1 | no | (max-width:599px) | `body.captions:has(.mh>#sbar:not([hidden])) #p-ev` |
| 1723 | single | E2 | no | (max-width:599px) | `.mh>#sbar .s-main` |
| 1724 | single | E2 | no | (max-width:599px) | `.mh>#sbar .s-topic` |
| 1725 | single | E2 | no | (max-width:599px) | `.mh>#sbar .s-topic::after` |
| 1726 | single | E2 | no | (max-width:599px) | `.mh>#sbar .s-clock` |
| 1727 | single | E2 | no | (max-width:599px) | `.mh>#sbar .s-clock::before` |
| 1730 | shared | kit+E1 | no | (min-width:600px) and (max-width:1199px) | `body.captions.on-ev:has(.mh>#sbar:not([hidden])) #p-ev` |
| 1733 | shared | U1+E1 | no | (min-width:600px) and (max-width:1199px) | `body.on-ev .mh:has(>#sbar:not([hidden]))` |
| 1734 | shared | U1+E1 | no | (min-width:600px) and (max-width:1199px) | `body.on-ev .mh:has(>#sbar:not([hidden]))::before` |
| 1735 | single | E2 | no | (min-width:600px) and (max-width:1199px) | `body.on-ev .mh>#sbar .s-acts` |
| 1736 | shared | U1+E1 | no | (min-width:600px) and (max-width:1199px) | `body.on-ev .mh>#sbar` |
| 1737 | single | E2 | no | (min-width:600px) and (max-width:1199px) | `body.on-ev .mh>#sbar .s-led` |
| 1738 | single | E2 | no | (min-width:600px) and (max-width:1199px) | `body.on-ev .mh>#sbar .s-main` |
| 1739 | single | E2 | no | (min-width:600px) and (max-width:1199px) | `body.on-ev .mh>#sbar .s-topic` |
| 1740 | single | E2 | no | (min-width:600px) and (max-width:1199px) | `body.on-ev .mh>#sbar .s-topic::after` |
| 1741 | single | E2 | no | (min-width:600px) and (max-width:1199px) | `body.on-ev .mh>#sbar .s-clock` |
| 1742 | single | E2 | no | (min-width:600px) and (max-width:1199px) | `body.on-ev .mh>#sbar .s-acts button:not(.end):not(:first-child)` |
| 1743 | single | E2 | no | (min-width:600px) and (max-width:1199px) | `body.on-ev .mh>#sbar .s-acts button.btn` |
| 1746 | single | kit | no |  | `.ro-banner` |
| 1747 | shared | V3-new+U1 | no |  | `[data-readonly] #composer,[data-readonly] #new-wrap` |
| 1754 | single | U1 | yes |  | `.estrip,.chatp` |
| 1756 | base |  | yes | (min-width:1024px) | `:root` |
| 1757 | base |  | yes | (min-width:1024px) | `body::before` |
| 1758 | single | E1 | yes | (min-width:1024px) | `section.panel > .cols > .col-side,section.panel > .panel > .cols > .col-side,#study-side:not([hidden]),body.ca` |
| 1759 | single | U1 | yes | (min-width:1024px) | `.estrip` |
| 1760 | single | U1 | yes | (min-width:1024px) | `.estrip .ss` |
| 1761 | single | U1 | yes | (min-width:1024px) | `.estrip .ss:empty` |
| 1763 | single | U1 | no | (min-width:1024px) | `.estrip .ss b` |
| 1764 | single | U1 | no | (min-width:1024px) | `.estrip .ss .s-led` |
| 1764 | single | U1 | no | (min-width:1024px) | `.estrip .ss.brk .s-led` |
| 1766 | single | U1 | no | (min-width:1024px) | `.estrip .ss.paused .s-led` |
| 1766 | single | U1 | no | (min-width:1024px) | `.estrip .ss.paused b` |
| 1767 | single | U1 | no | (min-width:1024px) | `.estrip .ss .tn` |
| 1768 | single | U1 | no | (min-width:1024px) | `.estrip .ss .tn:hover` |
| 1769 | single | U1 | no | (min-width:1024px) | `.estrip .ss .s-ended` |
| 1770 | single | U1 | no | (min-width:1024px) | `.estrip>.sp` |
| 1771 | single | U1 | yes | (min-width:1024px) | `.estrip .sug` |
| 1772 | single | U1 | yes | (min-width:1024px) | `.estrip .sug:hover` |
| 1773 | single | U1 | yes | (min-width:1024px) | `.estrip button.btn.evb` |
| 1774 | single | U1 | no | (min-width:1024px) | `.estrip button.btn.evb.on` |
| 1775 | single | U1 | yes | (min-width:1024px) | `.estrip button.btn.pchip` |
| 1776 | single | U1 | yes | (min-width:1024px) | `.estrip .pchip .pc` |
| 1777 | single | U1 | yes | (min-width:1024px) | `.estrip .ico,.chatp .ico` |
| 1778 | single | U1 | no | (min-width:1024px) | `.chatp:not([hidden])` |
| 1779 | single | U1 | yes | (min-width:1024px) | `.chatp` |
| 1780 | single | U1 | no | (min-width:1024px) | `.chatp.wide` |
| 1782 | single | U1 | yes | (min-width:1024px) | `body.on-ev .chatp` |
| 1783 | single | U1 | yes | (min-width:1024px) | `.chatp .cph` |
| 1784 | single | U1 | yes | (min-width:1024px) | `.chatp .cph .tt` |
| 1785 | single | U1 | yes | (min-width:1024px) | `.chatp .cph .tt b` |
| 1786 | single | U1 | yes | (min-width:1024px) | `.chatp .cph .tt span` |
| 1787 | single | U1 | yes | (min-width:1024px) | `.chatp .msgs` |
| 1788 | single | U1 | no | (min-width:1024px) | `.chatp .mev` |
| 1789 | single | U1 | no | (min-width:1024px) | `.chatp .mev p` |
| 1789 | single | U1 | no | (min-width:1024px) | `.chatp .mev p:last-child` |
| 1790 | single | U1 | no | (min-width:1024px) | `.chatp .mev ul` |
| 1791 | single | U1 | no | (min-width:1024px) | `.chatp .mev.err` |
| 1792 | single | U1 | no | (min-width:1024px) | `.chatp .mev .mch` |
| 1793 | single | U1 | no | (min-width:1024px) | `.chatp .myou` |
| 1794 | single | U1 | no | (min-width:1024px) | `.chatp .myou b` |
| 1795 | single | U1 | yes | (min-width:1024px) | `.chatp .pchips` |
| 1796 | single | U1 | no | (min-width:1024px) | `.chatp .pchips .qchip` |
| 1797 | single | U1 | yes | (min-width:1024px) | `.chatp .cin2` |
| 1798 | single | U1 | yes | (min-width:1024px) | `.chatp .cin2:focus-within` |
| 1799 | single | U1 | yes | (min-width:1024px) | `.chatp .cin2 textarea` |
| 1800 | single | U1 | yes | (min-width:1024px) | `.chatp .cin2 textarea::placeholder` |
| 1801 | single | U1 | yes | (min-width:1024px) | `.chatp .cin2 .crow` |
| 1802 | single | U1 | yes | (min-width:1024px) | `.chatp .cin2 .crow .sp` |
| 1803 | single | U1 | yes | (min-width:1024px) | `.chatp .cin2 .ctx` |
| 1804 | single | U1 | no | (min-width:1024px) | `.chatp .cin2 .ctx .ico` |
| 1805 | single | U1 | yes | (min-width:1024px) | `.chatp .cin2 .send` |
| 1806 | single | U1 | no | (min-width:1024px) | `.chatp .cin2 .send .ico` |
| 1807 | single | U1 | yes | (min-width:1024px) | `.chatp .hlist` |
| 1808 | single | U1 | no | (min-width:1024px) | `.chatp .hlist .mhd` |
| 1809 | single | U1 | no | (min-width:1024px) | `.chatp .hlist .mi` |
| 1810 | single | U1 | no | (min-width:1024px) | `.chatp .hlist .mi:hover` |
| 1811 | single | U1 | no | (min-width:1024px) | `.chatp .hlist .pt` |
| 1812 | single | U1 | no | (min-width:1024px) | `.chatp .hlist .pn` |
| 1813 | single | U1 | no | (min-width:1024px) | `.chatp .hlist .pm` |
| 1814 | single | U1 | no | (min-width:1024px) | `.chatp .hlist .hnone` |
| 1817 | single | V1-today | no | (min-width:1200px) | `#today-week .wk-days` |
| 1818 | single | U1 | no | (min-width:1200px) | `body.has-line #today-week .wk-days` |
| 1821 | single | V3-notes | yes |  | `#tab-notes[hidden],#p-notes[hidden]` |
| 1822 | single | V3-notes | yes | (max-width:1023px) | `#tab-notes,#p-notes` |
| 1823 | single | V3-notes | yes |  | `#p-notes .ico` |
| 1827 | single | V3-notes | yes |  | `#p-notes > .n-list` |
| 1828 | single | V3-notes | yes |  | `#p-notes .n-list .col-main` |
| 1829 | single | V3-notes | yes |  | `#p-notes .n-filters` |
| 1830 | single | V3-notes | yes |  | `#p-notes .n-row` |
| 1831 | single | V3-notes | yes |  | `#p-notes .n-row:hover,#p-notes .n-row.sel` |
| 1832 | single | V3-notes | yes |  | `#p-notes .n-row .nm` |
| 1833 | single | V3-notes | yes |  | `#p-notes .n-row .nm:focus-visible` |
| 1834 | single | V3-notes | yes |  | `#p-notes .n-row .hov` |
| 1835 | single | V3-notes | yes |  | `#p-notes .n-row:hover .hov,#p-notes .n-row:focus-within .hov` |
| 1836 | single | V3-notes | yes |  | `#p-notes .n-row .nk,#p-notes .n-row .t` |
| 1837 | single | V3-notes | no |  | `#p-notes .n-row .n-unsaved` |
| 1838 | single | V3-notes | no |  | `#p-notes .nempty` |
| 1839 | single | V3-notes | no |  | `#p-notes .nempty span` |
| 1840 | single | V3-notes | no |  | `#p-notes .nempty .ico` |
| 1841 | single | V3-notes | no |  | `#p-notes .nempty b` |
| 1842 | single | V3-notes | no |  | `#p-notes .nempty .btn` |
| 1843 | single | V3-notes | yes |  | `#p-notes .n-pvt` |
| 1844 | single | V3-notes | yes |  | `#p-notes .n-outline .si` |
| 1845 | single | V3-notes | yes |  | `#p-notes .n-acts .btn` |
| 1847 | single | V3-notes | yes | (max-width:1199px) | `#p-notes .n-pv` |
| 1849 | single | V3-notes | yes |  | `#p-notes .n-fbar` |
| 1852 | single | V3-notes | yes |  | `#p-notes .n-fbar` |
| 1854 | single | V3-notes | no | (min-width:600px) | `body:has(#notes-editor:not([hidden])) .mh::before` |
| 1856 | single | U1 | yes |  | `.estrip .sug.plain,.estrip .sug:disabled` |
| 1858 | single | U1 | no |  | `.estrip #ev-uncounted:not([hidden])` |
| 1859 | single | V3-notes | yes |  | `#p-notes .n-fbar button.btn.on` |
| 1860 | single | V3-notes | yes |  | `#p-notes .n-stb` |
| 1861 | single | V3-notes | yes |  | `#p-notes .menu` |
| 1862 | single | V3-notes | yes |  | `#p-notes .menu[hidden],#p-notes .n-lkp[hidden]` |
| 1864 | single | V3-notes | yes |  | `.n-ask` |
| 1865 | single | V3-notes | yes |  | `.n-ask[hidden]` |
| 1866 | single | V3-notes | yes |  | `#p-notes .menu .mi` |
| 1867 | single | V3-notes | yes |  | `#p-notes .menu .mi:hover,#p-notes .menu .mi:focus-visible,#p-notes .menu .mi.on` |
| 1868 | single | V3-notes | no |  | `#p-notes .menu .mi.on` |
| 1869 | single | V3-notes | yes |  | `#p-notes .n-lkp` |
| 1870 | single | V3-notes | yes |  | `#p-notes .n-lkp .in` |
| 1871 | single | V3-notes | yes |  | `#p-notes .n-doc` |
| 1872 | single | V3-notes | yes |  | `#p-notes .n-meta .btn` |
| 1873 | single | V3-notes | no |  | `#p-notes .n-meta .ico` |
| 1874 | single | V3-notes | yes |  | `#note-body` |
| 1877 | single | V3-notes | no |  | `#note-body.empty:not(.untitled)::before` |
| 1879 | single | V3-notes | no |  | `#note-body .nb` |
| 1880 | single | V3-notes | no |  | `#note-body h1.nb` |
| 1881 | single | V3-notes | no |  | `#note-body h2.nb` |
| 1882 | single | V3-notes | no |  | `#note-body h3.nb` |
| 1883 | single | V3-notes | no |  | `#note-body p.nb` |
| 1884 | single | V3-notes | no |  | `#note-body .nb[data-t=ul],#note-body .nb[data-t=ol],#note-body .nb[data-t=todo]` |
| 1887 | single | V3-notes | no |  | `#note-body .nb[data-t=ol]` |
| 1888 | single | V3-notes | no |  | `#note-body .nb[data-t=ol]::before` |
| 1889 | single | V3-notes | no |  | `#note-body .nb[data-indent="1"]` |
| 1889 | single | V3-notes | no |  | `#note-body .nb[data-indent="2"]` |
| 1889 | single | V3-notes | no |  | `#note-body .nb[data-indent="3"]` |
| 1890 | single | V3-notes | no |  | `#note-body .nb[data-indent="4"]` |
| 1890 | single | V3-notes | no |  | `#note-body .nb[data-indent="5"]` |
| 1890 | single | V3-notes | no |  | `#note-body .nb[data-indent="6"]` |
| 1891 | single | V3-notes | no |  | `#note-body .nb[data-t=todo][data-checked=true]` |
| 1892 | single | V3-notes | no |  | `#note-body .n-chk` |
| 1893 | single | V3-notes | no |  | `#note-body .n-chk.done` |
| 1894 | single | V3-notes | no |  | `#note-body .n-chk .ico` |
| 1895 | single | V3-notes | no |  | `#note-body .n-chk.done .ico` |
| 1896 | single | V3-notes | no |  | `#note-body u` |
| 1897 | single | V3-notes | no |  | `#note-body a` |
| 1898 | single | V3-notes | yes |  | `.mh .n-sync` |
| 1899 | single | V3-notes | no |  | `.mh .n-sync.bad` |
| 1901 | single | V3-notes | no |  | `.mh .n-sync.warn .ico` |
| 1902 | single | V3-notes | no |  | `#p-notes .n-pick .vpick` |
| 1903 | single | V3-notes | no |  | `#p-notes .n-pick .vh` |
| 1904 | single | V3-notes | no |  | `#p-notes .n-pick .vh>.ico` |
| 1905 | single | V3-notes | no |  | `#p-notes .n-pick .vhw` |
| 1906 | single | V3-notes | no |  | `#p-notes .n-pick .vhw b` |
| 1907 | single | V3-notes | no |  | `#p-notes .n-pick .vhw span` |
| 1908 | single | V3-notes | no |  | `#p-notes .n-pick .vgrid` |
| 1909 | single | V3-notes | no |  | `#p-notes .n-pick .ver` |
| 1910 | single | V3-notes | no |  | `#p-notes .n-pick .ver .btn` |
| 1911 | single | V3-notes | no |  | `#p-notes .n-pick .vrow` |
| 1912 | single | V3-notes | no |  | `#p-notes .n-pick .vwho` |
| 1913 | single | V3-notes | no |  | `#p-notes .n-pick .vwho b` |
| 1914 | single | V3-notes | no |  | `#p-notes .n-pick .vwho .ico` |
| 1915 | single | V3-notes | no |  | `#p-notes .n-pick .vx` |
| 1916 | single | V3-notes | no |  | `#p-notes .n-pick .vt` |
| 1917 | single | V3-notes | no |  | `#p-notes .n-pick .vl` |
| 1918 | single | V3-notes | no |  | `#p-notes .n-pick .vl::before` |
| 1919 | single | V3-notes | no |  | `#p-notes .n-pick .only` |
| 1920 | single | V3-notes | no |  | `#p-notes .n-pick .mini` |
| 1921 | single | V3-notes | no |  | `#p-notes .n-pick .endline` |
| 1922 | single | V3-notes | no |  | `#p-notes .n-pick .endline .sp` |
| 1924 | single | V3-notes | yes |  | `.mh .n-read` |
| 1925 | single | V3-notes | no |  | `.mh .n-read .ico` |
| 1926 | single | V3-notes | no |  | `.mh .n-read[aria-pressed=false]` |
| 1927 | single | V3-notes | yes |  | `.mh .n-crumb[hidden],.mh .n-sync[hidden],.mh .n-back[hidden],.mh .n-read[hidden]` |
| 1934 | single | U1 | yes | (max-width:599px) | `input[type=text],input[type=date],input[type=number],input[type=search],select,textarea,.compose-row textarea,` |
| 1936 | shared | kit+V2-study+V3-notes+E1 | no | (max-width:599px) | `body.kb` |
| 1937 | shared | kit+E1 | no | (max-width:599px) | `body.captions.kb #p-ev` |
| 1938 | shared | kit+V2-study+V3-notes+E1 | no | (max-width:599px) | `body.kb .side` |
| 1939 | shared | U1+E1 | no | (max-width:599px) | `html:has(>body.on-ev.kb)` |
| 1940 | shared | U1+E1 | no | (max-width:599px) | `body.on-ev.kb` |
| 1945 | single | V3-record | yes | (max-width:599px) | `.rec-li .r` |
| 1946 | base |  | yes | (max-width:599px) | `body` |
| 1953 | shared | U1+E1 | no | (max-width:599px) | `html:has(>body.on-ev)` |
| 1954 | shared | V2-study+V1-today+P-progress+V3-record+E1+E2+E3+U1 | yes | (max-width:599px) | `.side` |
| 1955 | base |  | yes | (max-width:599px) | `body` |
| 1959 | single | U1 | yes | (max-width:599px) | `#new-dlg .new-body #new-text,#p-record .rec-detail select.idea-kind` |
| 1963 | single | V3-notes | yes |  | `.mh .n-read` |
| 1964 | single | V3-notes | no |  | `.mh .n-read[aria-pressed=true]` |
| 1966 | shared | U1+E2 | yes | (max-width:599px) | `.mh #new-btn` |
| 1967 | shared | V2-study+V1-today+P-progress+V3-record+E1+E2+E3+U1 | yes | (max-width:599px) | `.side` |
