# Scan: core/ (D-264, B-262)

Written by an overnight trimmer scan run on Oct 24, 2026, at origin/main a9b9c40. It changes no code. `core/evcore.mjs`
and `core/steps.mjs` were mapped by two read-only helpers; the other files from their headers and imports. The key
claims below were re-checked by grep. Git history on main is squashed, so churn can't be measured; evidence is the
code, the tests and the spec.

**Read this before changing a file it maps.** Line numbers are at a9b9c40 and will drift; the section names won't.

## How core/ fits together

- **The page's core** is `evcore.mjs` plus its factories (`library`, `sessions`, `conversation`, `skills`, `prep`,
  `insights`, `mirror`, `canvas-rules`, `share`, `item-kinds`, `idcheck`). Each factory file has no imports, so it runs
  in node (evcore imports it) and in the page (`tools/build.mjs` `coreParts` writes each one into core.js, ahead of
  E.V. core, without its export). `validate.mjs`, `motion.mjs` and `study.mjs` go into the page the same way as their
  own globals. `coreParts` finds a new factory from evcore's own `import { x } from './f.mjs'` lines (one export, no
  imports), so `tools/build.mjs` needs no change; the B-160 test's file list (`test/core.test.mjs` 1365) does.
- **The run side** is `run.mjs` (the six moves of the run protocol) calling `steps.mjs` (each pipeline's code steps,
  agent materials and folds), with `derive.mjs` (derived documents), `watch.mjs` (watchdog judgment), `batches.mjs`
  and `transcript.mjs`.
- **The build chat's side** is `cli.mjs`, `deploy.mjs`, `verifystate.mjs`, `seed.mjs`, `migrate.mjs`, `lint.mjs`,
  `links.mjs`, `schemas.mjs` and `actions.mjs`/`his.mjs`. They're node only, except that `actions.mjs` defines the action rows.
- **A budget is about to bind:** `test/core.test.mjs` (B-160, line 1363) requires evcore.mjs under 2,500 lines. It is
  2,490. The next feature added to evcore turns npm test red, so findings 1 to 3 are the cheapest way to get room back.

## Map: core/evcore.mjs (2,490 lines)

| Lines | Size | Section | Depends on |
| --- | --- | --- | --- |
| 1-30 | 30 | Header, 11 factory imports | none |
| 31-79 | 49 | DEFAULTS and `configure` (merges spec.constants) | spec.constants |
| 80-142 | 63 | Course table, `examIs`, `canvasCourses`, `libraryRules`, day labels | spec.courses, spec.registry.canvas |
| 143-270 | 128 | Helpers: norm, slug, similarity, hash, sha256 (about 55 lines) | none |
| 271-312 | 42 | Document helpers: eventKey, entryTime, envelope, editBase | none |
| 313-367 | 55 | Central-time dates | none |
| 368-387 | 20 | Binds makeItemKinds | SPEC, scanIdentifiers |
| 388-484 | 97 | validateItem, scoreAnswer | item-kinds |
| 485-535 | 51 | collectAttempts, answeredItems | dates |
| 536-754 | 219 | Weak spots: facts, deriveWeakspot, buildWeakspots, derivedHash | C.review, attempts |
| 755-875 | 121 | planAnswer, outcomeText | weak spots, plans |
| 876-1073 | 198 | Plans: cards to plan, views, drafts, ticks, offer, preReadFor | courses, editBase |
| 1074-1231 | 158 | dayType, reviewLoad, rankDue, awaitingPark, pickReviews | liveDates, C.review |
| 1232-1434 | 203 | planDay (the minute budget) | plans, pickReviews, liveDates, C.taskMinutes |
| 1435-1484 | 50 | buildDayList | planDay |
| 1485-1606 | 122 | dayView, listEdit (dayedits) | isPrepAdded (bound later) |
| 1607-1674 | 68 | Binds makeLibrary and makePrep (order matters, see the comment at 1608) | C, courses, dates |
| 1675-1706 | 32 | gradedAsk | norm |
| 1707-1853 | 147 | Calendar: dateView, liveDates, dateEdit | editBase, courses |
| 1854-2051 | 198 | lastRuns, buildSnapshot, capacity, buildContext | most sections above, prep |
| 2052-2066 | 15 | Binds makeInsights | none |
| 2067-2141 | 75 | ID_PATTERNS, scanIdentifiers, the id check, lint | idcheck |
| 2142-2166 | 25 | autoParkEvents | awaitingPark |
| 2167-2299 | 133 | Binds mirror, canvas-rules, sessions, skills, share, conversation | many |
| 2300-2490 | 191 | The returned API object | everything |

## Map: core/steps.mjs (1,484 lines, 17 exports)

Since `trim/steps-per-pipeline` part 1, the shared helpers live in `core/steps-shared.mjs` and the worker's job-brief,
its material and the job-result fold in `core/steps-worker.mjs`; since part 2, the diagnostic's probe-brief, named
probes and probe-result in `core/steps-diagnostic.mjs`; steps.mjs merges them into its three tables in the same
key order. The line numbers below are from before that move.

| Lines | Size | Section | Pipelines |
| --- | --- | --- | --- |
| 1-67 | 67 | Header, 12 imports, shared helpers (`models`, `ITEM_FIELDS`, `pick`, `library`, `passages`) | all |
| 69-170 | 102 | `eveningPush` (the push line, cut to fit), `healthStale`, `withStale` | evening-cloud, morning |
| 172-249 | 78 | `CODE_STEPS` core: auto-park, state, push, prediction, day | evening-cloud, morning |
| 251-389 | 139 | `dosageLibrary`, practice-brief (review targets, checks, drills) | morning |
| 391-421 | 31 | week-brief (build recap) | weekly |
| 423-585 | 163 | job-brief: six `kind ===` context builders; share-set writes HTML | worker |
| 587-638 | 52 | watch and health steps | watchdog |
| 640-804 | 165 | Backups and restore: `MAC_FILES`, `macBackup`, `planRestore` (80 lines), mac-files | evening-mac, restore-drill |
| 806-953 | 148 | `AGENT_MATERIAL` (9 builders); verify-brief runs `tools/build.mjs` | all agent steps |
| 955-1053 | 99 | Named probes: `probeNamed`, `probeDoc`, `probeGroups` | diagnostic |
| 1055-1116 | 62 | `ROOT`, `verifyPaths`, `verifyOutcome`, `schedulerPages` | weekly, watchdog |
| 1118-1484 | 367 | `AGENT_FOLDS` (10): verify, probe, job-result (140), practice-sets (112), canvas-sync, restore, evening-note, week-doc, push-line | all |

## Map: the rest of core/

| File | Lines | What it does | Imports |
| --- | --- | --- | --- |
| run.mjs | 826 | The run protocol's moves; makes only the calls these functions print | evcore, schemas, batches, validate, derive, transcript, steps |
| sessions.mjs | 766 | Study Watch intake and study sessions (factory, B-156) | none |
| derive.mjs | 700 | Each derived document's producer, and the nightly rebuild that must match it | evcore, study, watch, schemas |
| deploy.mjs | 673 | verify and deploy as pure functions over saved files | none |
| migrate.mjs | 663 | v3-to-v4 migration and schema bumps (v3 part: inventory item 9, #17) | evcore |
| cli.mjs | 659 | Build-chat commands | 13 core files |
| conversation.mjs | 654 | The E.V. tab's greeting, chips and conversations (factory, B-157) | none |
| prep.mjs | 617 | Clinical, lab, validation and class prep checks (factory, B-159) | none |
| library.mjs | 536 | Course materials (factory, B-155) | none |
| skills.mjs | 493 | Skills practice, Quizlet cards, workouts (factory, B-158) | none |
| lint.mjs | 350 | The record checked against its own rules | evcore, derive, validate, links |
| watch.mjs | 340 | The watchdog's judgment: missed slots, stalled jobs, re-fires | evcore, migrate |
| item-kinds.mjs | 313 | Numeric and open items (factory) | none |
| actions.mjs | 269 | Actions as data: `act(name, args, ctx)` (B-186) | none |
| insights.mjs | 257 | Readiness, prediction, calibration, retrospectives (factory, B-159) | none |
| motion.mjs | 244 | E.V.'s springs, speech envelope, gestures (page global) | none |
| idcheck.mjs | 209 | Two-stage identifier check (factory, B-197) | none |
| validate.mjs | 209 | Schema validation shared by node and the page | none |
| study.mjs | 200 | The review schedulers, fixed and adaptive (page global) | none |
| links.mjs | 195 | Referential integrity from spec.links | evcore |
| canvas-rules.mjs | 170 | Canvas sync's code side (factory, B-160) | none |
| seed.mjs | 134 | seed-staging | evcore, migrate |
| canvas.mjs | 131 | Fills the Canvas fetch scripts' parameters | evcore |
| mirror.mjs | 123 | The Markdown mirror and the backup's restore plan (factory) | none |
| share.mjs | 95 | Shareable practice pages (factory, D-110) | none |
| transcript.mjs | 86 | Reads this session's transcript for saved results | none |
| verifystate.mjs | 78 | Reads the state verify() needs from saved files | deploy |
| recap.mjs | 70 | The weekly's one-sentence build recap | evcore |
| schemas.mjs | 39 | Loads spec/schemas/ | validate |
| batches.mjs | 34 | Cuts a run's writes into batches | none |
| his.mjs | 9 | The fields only Matt writes | none |

## Findings, ranked by long-term value

Every split here must be behavior-preserving (D-264): the existing tests and page harnesses pass with no test changed
except imports. A split that touches `evcore.mjs` or `steps.mjs` changes the deployed build, so it ships through staging
and the full check, and none lands in the days around an exam.

### 1. split: steps.mjs by pipeline (`trim/steps-per-pipeline`)

- **What:** each pipeline's code step, agent material and fold sit hundreds of lines apart. The worker alone is lines
  423-585, around 817, and 1159-1298. The proposed layout is `core/steps/` with one file per pipeline (shared,
  evening-cloud, morning, weekly, worker, watchdog, backup, diagnostic) plus an index that merges `CODE_STEPS`,
  `AGENT_MATERIAL` and `AGENT_FOLDS`.
- **What stays the same:** core/run.mjs's import doesn't change, and tests import only those tables plus
  `eveningPush`, `MAC_FILES`, `macBackup`, `backupSchemaLine` and `planRestore` (grep: 9 test files).
- **Catch:** three tests read the file's text, not its exports.
  - `test/spec.test.mjs` 387 counts `collection: 'health'` in steps.mjs (B-140).
  - `test/reminders.test.mjs` 34 scans evcore.mjs and steps.mjs for standing-reminder wording.
  - `test/core.test.mjs` 1363 counts evcore's lines.

  These tests would need their file list widened. That is more than an import change, so the pull request must say
  so plainly. `ROOT` (1055) is used at 395 before it is defined, so it moves into the shared file.
- **Size:** 1,484 lines move, about +40 for headers and the index.
- **Risk:** low. Every pipeline run goes through it, but the run tests cover each step.

### 2. patch layer: the returned API object in evcore.mjs (`trim/api-spread`)

- **What:** lines 2300-2490 (about 190) write most factory names three times: destructured, passed on, re-exported.
  `CONV`, `PREP`, `IDC` and `libMore` already use `...spread` and the rest don't.
- **Drift is visible:** `weakspotCards` is listed twice (2248 and 2406, grep), two section headings sit over nothing,
  and the share names sit under "workouts".
- **Fix:** spread each factory's result and keep destructuring only for the names evcore itself uses.
- **Size:** about 100 lines out, and it brings evcore back under its 2,500 budget.
- **Risk:** low. The page reads the same `window.EVCore` names. Check `core/canvas.mjs` 23, which looks up `EV[name]`
  dynamically for `@FN:` slots.

### 3. split: the Edit rules, the planning block and the snapshot out of evcore.mjs

These are three factories in the B-155 to B-160 pattern. `tools/build.mjs` picks each up from its import line, but
the B-160 test (`test/core.test.mjs` 1365, a `deepEqual` of the split files) needs each new name added. That is a test
change beyond imports, so each pull request must say so plainly.

- **`trim/split-edits` (about 270 lines):** dayView, listEdit, dateView, liveDates and dateEdit, at 1485-1606 and
  1707-1853. They depend only on editBase, courses, norm, slug, safeId and isPrepAdded. The factory has to be bound
  before library, prep and canvas-rules, which use liveDates.
- **`trim/split-planning` (about 610 lines):** plans, dayType, load, ranking, planDay and buildDayList, at 876-1484.
  This is the largest block that hangs together. steps, derive, study and the page use it.
- **`trim/split-snapshot` (about 200 lines):** lastRuns, buildSnapshot, capacity and buildContext, at 1854-2051. All
  of it is read-only.

Take `trim/api-spread` first, so each split adds one spread line instead of three. Risk is low for each.

### 4. patch layer: job kinds as two if-chains in steps.mjs (`trim/job-kinds-table`)

- **What:** job-brief (457-575) and job-result (1173-1251) each test `kind ===` for six kinds: study-guide,
  practice-set, exam-plan, clinical-prep, exam-retro and share-set. The two chains are 700 lines apart.
- **Fix:** one table of `{context, fold}` per kind, keyed like `spec.jobs.kinds`. Adding a kind becomes one entry.
- **Size:** about 30 lines out.
- **Risk:** low.

### 5. duplicate: item vetting in two folds (`trim/item-vetting`)

- **What:** the practice-set job fold (1191-1205) and the practice-sets fold (1306-1341) each pick `ITEM_FIELDS`, run
  strict `validateItem`, run `crossCourse` (B-193), drop an unknown `weakspotId` and build the envelope. Only the
  dosage rules differ.
- **Fix:** one helper, so the two can't drift on what makes an item valid.
- **Size:** about 25 lines.
- **Risk:** low.

### 6. patch layer: hard-coded push length and schema numbers in steps.mjs (`trim/push-and-schema-consts`)

- **Push length:**
  - Four push lines are cut to a literal 120 (626, 1152, 1297, 1463; grep `slice(0, 120)`).
  - Two are cut to `spec.constants.push.maxChars` (77, 167).
  - `core/run.mjs` takes `r.push` as given.
  - One cut in run.mjs would let all six go.
- **Schema numbers:**
  - They are written by hand: sets 3 (1214, 1342), talk 4 (1274), jobresults 2 (1286).
  - `registryVersions()` already reads them from the schemas.
  - Each schema bump means finding these by hand.
- **Size:** about 10 lines.
- **Risk:** low. The push wording is unchanged unless maxChars differs from 120.

### 7. duplicate: small repeats inside evcore.mjs (`trim/exam-date-once`)

- **Exam dates:**
  - The exam-date lookup exists three times (`examDate` 728, `examDateOf` 781, `examDateMap` 1130).
  - planAnswer builds the exam id by hand (821) and doesn't call `examOf`.
  - buildSnapshot's local `nextExams` (1903) shadows the exported `nextExams` and filters differently: it includes
    today and has no course filter. A merge must keep each caller's result exactly.
- **Fixed kinds:** they are listed four times: FIXED_KINDS 1234, the `required` list 1355, FIXED_TAGS 1491 and
  isFixedDate 1733.
- **Size:** about 30 lines.
- **Risk:** low, but the planner reads it, so each caller's result must stay exactly the same.

### 8. duplicate: identifier patterns in evcore.mjs and idcheck.mjs (`trim/one-id-scan`)

- **What:**
  - `ID_PATTERNS` (evcore 2068) and `ID_VALUE_PATTERNS` (idcheck 8) both carry the date-of-birth, MRN and room rules.
  - They are not the same rules: evcore's flags any mention of MRN or date of birth, while idcheck's needs a value
    after the keyword (for example a number of 4 or more digits after MRN).
  - Sessions, skills and item-kinds use evcore's `scanIdentifiers`; lint uses the idcheck one.
- **Size:** about 15 lines.
- **Risk:** **high**. This is the patient-identifier hard limit (B-04). Merging them can change what gets held back.
  Do it only as a pure move that keeps both lists' exact behavior, with the privacy tests unchanged, or leave it to a
  build chat.

### 9. small duplicates in steps.mjs (`trim/steps-shared-lookups`)

- **Readable materials:** the filter `!(m.needsOcr && !m.ocr)` appears at steps.mjs 58, 258 and 486, and again at
  derive.mjs 415 (grep).
- **Same function twice:** `library` and `dosageLibrary` are the same function plus one filter.
- **Mac folder:** `macFolder` (643) is repeated inline in backup-brief (891).
- **Refusal text:** the "status not ok" refusal is built twice (1418, 1447).
- **Size:** about 20 lines.
- **Risk:** low.

### 10. dead: exports with no importer

Risk is none for both.

- **steps.mjs (`trim/steps-private-helpers`):** 9 of 17 exports have no importer outside the file (grep: 0 files
  each): `healthStale`, `withStale`, `macFolder`, `registryVersions`, `probeNamed`, `probeDoc`, `probeGroups`,
  `verifyOutcome`, `schedulerPages`. Dropping `export` is 9 words.
- **evcore.mjs's API:**
  - Used only inside their own factory: `openGrade`, `openItemErrors`, `unitOf`, `parseWrap`, `workoutMoves`,
    `guessCourse`, `libStem`, `buildContext`.
  - Reached only by tests: `planFromCards`, `planView`, `planDrafts`, `preReadFor`, `deriveWeakspot`,
    `weakspotFacts`, `courseOf`, `isExamDay`, `scoreAnswer`, and `restorePlan` (only `test/mirror.test.mjs`).
  - Keep the test-only names, since tests reach them, but drop the factory-only ones from the API, after checking
    `core/canvas.mjs`' dynamic `EV[name]` lookups.

### 11. dead: branches no spec pipeline reaches (`trim/steps-dead-branches`)

- **Fixture-only steps:** the material `day-summary` (949) and the fold `push-line` (1481) are named by no spec
  pipeline; only `test/run.test.mjs` 48-50 reaches them. Either move them into that test's fixture, or keep them on
  purpose and say so.
- **A key that doesn't exist:** probe-brief (810) reads `spec.environments.surfaces`. The spec has no such key, so only
  the fallback branch runs.
- **A one-item loop:** `for (const c of ['system'])` (693).
- **Size:** about 15 lines.
- **Risk:** none.

### 12. patch layer: planDay's inline tuning (`trim/plan-rules-data`)

- **Inline tables:** the `cutRank` table (1334) and the optional-text regex are tuning constants in code, beside
  `C.taskMinutes`, which lives in the spec.
- **One-off checks:**
  - `['clinical'].includes(t.kind)` (1327).
  - The "exam but not sim" title rule (1084).
  - Two exam-dedupe checks (1260, 1294).
  - `minutes = 0` overriding values just set (1321).
- **A hard-coded phrase:** outcomeText says "two different days" while `solidAfterRightDays` is configurable.
- **Size:** about 40 lines.
- **Risk:** low for studying if the values stay the same. Moving constants into spec.constants touches the spec, and that is a build chat's call.

### 13. small

- **gradedAsk (`trim/graded-to-conversation`):** gradedAsk (evcore 1675-1706, 32 lines) is used only by the page's
  talking tab. It fits conversation.mjs. Risk: low. It is the graded-work refusal (B-01), so move it as written.
- **Pure-function header:** steps.mjs's header says "pure", but share-set (547), mac-files (779) and `probeGroups` write
  files, and verify-brief runs `tools/build.mjs` (913). Fold the fix into finding 1 by naming the I/O at each file's
  top.
- **Duplicated header text:** eleven factory headers repeat the same three-line "Split from core/evcore.mjs ... no
  imports ... the build writes it into core.js" paragraph. A one-line pointer to this map would do. Text only.
- **Repeated "no imports" test:** see inventory item 13, which is the same test repeated nine times.

### Keep

- **sha256** in evcore (about 55 lines): it guarantees that the page and the pipelines compute the same derivedHash.
- **deriveWeakspot, applyEvent, planAnswer, validateItem and scoreAnswer:** this is the record's core rule. It is
  tested in `test/core.test.mjs`, and planAnswer is the one pure write path that keeps nothing derived stored.
- **The `get C()` / `get SPEC()` getters and the binding order:** `configure` swaps C after binding. The order is
  documented at 1608.
- **`planRestore`, `eveningPush`, practice-brief, `probeGroups`, and the agent prose in verify-brief and canvas-brief:**
  each is dense but is one rule with tests, or the agent's contract.
- **migrate.mjs's v3 half:** already queued as inventory item 9 (#17).
- **The schema bumps:** these stay.
