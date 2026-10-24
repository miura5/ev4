# Scan: the page (D-264)

Written by an overnight trimmer scan run on Oct 24, 2026, at origin/main a9b9c40, for `docs/trim-brief.md` "Scan runs".
It changes no code. Two read-only helpers mapped the files: one took `00` to `50`, `90`, `91`, `index.src.html` and
`styles.css`, the other took `60` to `75`. The trimmer then re-checked the key claims by grep (marked **checked**).
Line numbers are at a9b9c40.

The page is `page/index.src.html`, `page/styles.css` (938 lines) and `page/app/*.js` (29 parts, 10,945 lines; about 12,100 with the stylesheet and the shell),
which `tools/build.mjs` joins in name order into one `app.js`. It is one closure, so any part can call a function from
any other, and a "dead" claim has to be grepped across every part and the harnesses (`test/harness/*.cjs`).

Every change to the page is study-facing and hashed. A cut here ships through staging and the full check. The brief
allows page work only as restructuring that changes no behavior, with no test changed except imports, and none in
the days around an exam.

## Map

### Kit and tabs (`00` to `50`, `90`, `91`)

| Part | Lines | Job | Main functions | Leans on |
| --- | --- | --- | --- | --- |
| 00-boot | 15 | Opens the closure, `VERSION` | `boot` | `changed`/`lost` (03) |
| 01-kit | 104 | Shared building blocks | `$`, `el`, `chip`, `btn`, `row`, `table`, `toast`, `store`, date helpers | core's date helpers |
| 02-navigation | 126 | Tabs and segmented switches | `showTab`, `placeSegs`, `wireSeg` | `store`, `render` |
| 03-connect | 218 | Record subscription and repaint | `render`, `changed`, `lost`, `withPaintedRows` | `renderAll` (90), `model` (04) |
| 04-model | 185 | Model, writes and guards | `model`, `write`, `run`, `guard`, `idGate` | `changed`, `toast` |
| 05-question-runner | 713 | Answer, grade, summary | `runner`, `summary`, `retake`, `foldLine` | `write`/`run`, `btn`, `table` |
| 10-today | 564 | Today tab | `renderToday`, `dayState`, `todayRow`, `editList` | `write`/`guard`, `row` |
| 20-study | 663 | Review, Practice, Plan | `renderReview`, `renderPractice`, `renderPlan` | `runner` (05) |
| 30-progress | 453 | Readiness, insights, weak spots | `renderReadiness`, `trendChart`, `renderWeak`, `foldCard` | `weakEvent`, `table` |
| 40-record | 166 | Record tab (ideas) | `renderRecord`, `ideaRow`, `promote` | `write`, `row` |
| 50-system | 389 | System tab, theme, text size, motion | `renderSystem`, `healthLines`, `sysFold` | `clock12` (61), `table` |
| 90-render | 47 | `renderAll` and the sidebar | `renderAll`, `renderSide` | every `render*`, `jobState` (62) |
| 91-forms | 99 | Weak spot, dates and journal forms | `addWeakspot`, `editDates`, `saveEntry` | `idGate`, `write` |

### The E.V. tab (`60` to `75`, 7,203 lines)

| Part | Lines | Job | Main functions | Leans on |
| --- | --- | --- | --- | --- |
| 60-ev-conversation | 755 | Shared state `T` (15–41), her flower `CORE` (46–700), stage size (705–755) | `CORE.*`, `stagePx` | `renderStage` (61), `pinNow` (68) |
| 61-ev-captions | 527 | Captions view: stage steps, pull for earlier lines, speech-paced reveal; also general helpers (460–527) | `renderStage`, `pullView`, `revealTick`, `clock12`, `fmt`, `msgId` | `allMsgs` (68), `activeSession` (64) |
| 62-ev-jobs-and-filing | 585 | Background jobs, filing, Ship it | `startJob`, `jobState`, `fileSessions`, `shipIt` | `run`, `evSay` (69) |
| 63-ev-checkins | 16 | Check-in save, energy advice | `saveCheckin`, `energyAdvice` | `writeDayEdit` (10) |
| 64-ev-study-sessions | 861 | Study sessions: reader, chime, checkpoints, notes | `startSession`, `runCheckpoint`, `endSession` | `write`, `evSay` |
| 65-ev-skills-practice | 356 | Skills run dock | `startSkillRun`, `skillButtons`, `shownCards` | `guard`, `regreet` (73) |
| 66-ev-workouts | 229 | Workouts | `startWorkoutRun`, `workoutCard` | `head2` (67) |
| 67-ev-cards | 1,241 | `CARDS` kinds table (16–899), surface `LINES` (900–992), greeting briefing (994–1108), prep check (1110–1234) | `CARDS`, `briefEl`, `prepEl` | `runner` (05), `showTab` |
| 68-ev-thread | 262 | The caption lines | `allMsgs`, `msgEl`, `renderThread`, `dayDivider` | `fmt` (61), `CARDS` (67), `chat` (72) |
| 69-ev-writing | 54 | Post a line | `postMsg` | `msgId` (61), `write` |
| 70-ev-quick-asks | 201 | Chip answers with no model call | `quick`, `prepAnswer` | `startSession` (64), `startJob` (62) |
| 71-ev-library | 320 | Course materials and uploads | `library`, `attachFile`, `renderLibrary` | |
| 72-ev-talking-with-claude | 1,009 | Chat with Claude: context (2–169), 15 tools (220–858), chat (859–969), summary (970–1009) | `evContext`, `buildTools`, `chat` | `dayState` (10), `CARDS` |
| 73-ev-greeting | 209 | The greeting | `greetNow`, `regreet` | `fileUnfiled` (62) |
| 74-ev-render-and-composer | 313 | `renderEV`, mood, chips, composer | `renderEV`, `computeMood`, `sendText` | `quick` (70) |
| 75-ev-surfaces | 265 | Cards as surfaces | `renderSurface`, `sfSync` | `CARDS`/`LINES` (67), `shownCards` (65) |

### `styles.css` (938 lines)

The base rules come first (top bar, page, controls, study, captions). A layout block from line 674 then re-declares
`:root`, `html`, `body`, `.wrap`, `.ptitle` and the old top bar's pieces for the sidebar layout (D-210). A late block
(about 780–935) overrides earlier rules for Captions and the skills sheet. That late block is why one selector often
has two or three definitions. The cascade order carries meaning, so merge with care.

## Findings, ranked by long-term value

| # | Kind | Finding | Evidence | Size | Risk | Branch |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | dead | Captions v2 stage heights `STAGE_PX`, `STAGE_SHORT`, `STAGE_TINY` (61:111–127), replaced by `stagePx`/`MO_SIZE` (60:705, B-209) | **checked**: each name occurs once in page/ and test/, at its own definition | 18 | none | `trim/page-dead` |
| 2 | dead | Small leftovers: `stat()` (01:49–53; `look.cjs:708` asserts there is no `.stat` tile), `dayLabel` (61:466; the hits in 20-study:351 are a field), `let lastStamp` (60:42) | **checked** by grep: no caller | 7 | none | `trim/page-dead` |
| 3 | dead | `renderCards` is a stub that empties a box ("B-78: no longer drawn", 67:1236–1239), yet 68 still makes the `.msg-cards` box and calls it (68:87–88, 207, 224) | **checked** | about 10 | none | `trim/page-dead` |
| 4 | dead | Skill card's live branch (67:287–310): `shownCards` (65:31) hides a skill card while `skillGoing` (65:10: active and a next step), which is exactly `live` (67:275) | **checked**: same condition both places | 24 | low | `trim/page-skill-card` |
| 5 | dead | Unused CSS selectors with no class/id anywhere in page/ or core/: `.top`, `.top-in`, `.top-right`, `.stg`, `.eyebrow`, `.q-head`, `.daysep`, `.sk-mini`, `.sk-cur`, `.share-acts`, `.cap-cards-more`, `.cl-t`, `.cl-go` (and `.card-line` itself, though `*-card-line` ids exist) | **checked** by grep -w; `captions.cjs:1295` and `:2084` query `.sk-mini` and `.cap-cards-more` expecting none, so those asserts still pass; `captions.cjs:844` and `run.cjs:1587` query `.card-line`, which no element has | about 25 | none | `trim/page-css-dead` |
| 6 | retired | The pre-D-210 top bar's CSS (styles.css:39–71, including the media rules for `.top-in`) and the header comment that still says "a sticky top bar"; the sidebar replaced it and line 680 sets `.top-in, .top-right` to `display:contents` | **checked**: no element has class `top` (the aside is `class="side" id="top"`) | about 30 with #5 | low | `trim/page-css-dead` |
| 7 | retired | The thread's message shape, from before Captions (D-122): `.bubble`, `av-slot`, the per-message avatar (68:46–48, `showAv` is always false at 68:204 and 223) and `msg-meta`, which CSS hides or flattens under `body.captions` (styles.css:243–267, 416–422); `body.captions` is set always (61:6) | helper report; avatar callers **checked** | about 40 JS and CSS | low | `trim/page-thread-shape` |
| 8 | retired | `spec.ui.look.core` is retired (D-212) but 60:722 still reads `EV_SPEC.ui.look.core.sizes`, and `--core-scale` (styles.css:399) is always 1 | **checked** (60:722). The spec's note says "only sizes is still read". Moving `sizes` would change the spec, so this is a build chat's call | about 5 | high if the spec entry goes first | not a trim |
| 9 | duplicate | Exam short title `(ex.title||ex.id).replace(/:.*$/,'')` inlined at 7 sites (67:388, 70:22, 70:27, 70:84, 10:331, 20:325, 30:251) though `exShort` exists (67:900) | helper report | about 7 | none | `trim/page-helpers` |
| 10 | duplicate | Segmented-button "pressed" code three times: `wireSeg` (02:95–105) and the theme and text-size loops (50:350–387) | helper report | about 25 | low | `trim/page-helpers` |
| 11 | duplicate | Fold toggles: `foldCard` (30:37), `wsFold` (30:381), `sysFold` (50:126), `foldLine` (05:104), plus hand-built fold buttons at 67:704, 67:1022, 67:1160, 75:186, 65:337 | helper report | about 30 | low | `trim/page-fold` |
| 12 | duplicate | "Is this check answered" three times (67:690–695, 75:43–46, 75:99–103); the skill card's buttons and bar rebuild `skillButtons` (65:108) and the dock bar (65:345); `CHEV` (67:998) and `SF_CHEV` (75:11) are one string | helper report; `CHEV` **checked** | about 40 | low | `trim/page-helpers` |
| 13 | duplicate | 12-hour clocks: `t12` (10:348, "4pm"), inside `when` (50:30), `clock12` (61:460, "4:00 PM"). They give two styles, so merging changes text unless kept apart | helper report | about 8 | low | judgement |
| 14 | duplicate | Checkbox rows: `row({check})` (01:22), `todayRow`'s own tick (10:104), and 67:1167 | helper report | about 10 | **high**: ticks write the record | leave |
| 15 | patch layer | Re-declared CSS: 55 selectors defined more than once, the main ones `:root` (7, 19, 674, 919), `.wrap`, `.seg`, `.sk-sheet`/`.sk-step`, `.hero` (398, 749, 750, 934), `.cap-echo` (500, then hidden at 787 though 61:37 still creates it), `.readout .led` (51, hidden at 780 though 74:90 still sets its class) | helper report | about 40–60 | low, but cascade order matters; check at every look size | `trim/page-css-merge` |
| 16 | split | 67-ev-cards (1,241) does four jobs: move surface `LINES` (900–992) to 75, the briefing (994–1108) to 73, and the prep check (1110–1234) into its own part | helper report | moves about 340 | none (moves only) | `trim/page-split-cards` |
| 17 | split | 72's `buildTools` (220–858, about 640 lines of tool schemas and handlers) as its own part | helper report | moves 640 | none | `trim/page-split-tools` |
| 18 | split | 60's flower `CORE` (46–700) as its own part; 61's general helpers (460–527: `clock12`, `fmt`, `msgId`) and 67's `head2` into the kit, since 05, 50, 62, 66, 68 and 69 use them | helper report | moves | none | `trim/page-split-core` |
| 19 | keep | `sw-` prefix fallback (62:45) for sessions v3 filed without it: old records still need it | helper report | 1 | | keep |
| 20 | keep | The `CARDS` table: every kind has a producer (e.g. `plan` in core/steps.mjs:1249) | helper report | | | keep |

Ranking: the dead code (1 to 5) is free and makes the next reader's job easier. The splits (16 to 18) do the most for
the next change, since 67 and 72 are where most E.V.-tab work lands, but they move a lot of text, so each should go
alone with no edits beside the move. The duplicates come after the splits, because a split puts the copies side by
side.

## Not page work, seen on the way

- The spec lags the code: `spec/ev.spec.json` (about line 4359) lists 12 card kinds where the code has 20, and its
  tools list (about 4344) has no `start_workout` or `practice_skill` (72:774, 793). The fix is the spec, a build
  chat's job.
- A possible bug, not a trim: 75:110 and 75:128 key surfaces by their index in `shownCards(m)`. When a skills run ends,
  its card comes back and the indexes shift, so the open surface can show the wrong card. Risk low: a wrong card shown,
  no data lost. A build chat should file it as a bug.
