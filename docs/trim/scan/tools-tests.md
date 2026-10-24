# Scan: tools and unit tests (D-264)

Written by an overnight trimmer scan run on Oct 24, 2026, at origin/main a9b9c40. It changes no code. The area is
`tools/` (chart.mjs 3,154 lines, build.mjs 607, hooks.mjs 216, check.mjs 208, guard.mjs 152 and the rest) and the
unit tests in `test/*.test.mjs` (69 files, 19,607 lines; the page harnesses in `test/harness/` are another area). Two
read-only helpers mapped it; the findings below were re-checked by grep before they were written. Queue items 8 to 11
in `docs/trim/inventory.md` are left out, since other runs are cutting them.

Nothing in the area is in the deployed build: the page and the runs never import `tools/` or `test/`. So the risk to
studying is **none** for every finding unless it says otherwise; the real risk is breaking `npm test` or a build
chat's workflow.

## Map: tools/chart.mjs

Nothing but six test files imports it (chart, tags, trace, quarantine, guard, check-touched). About 40 of its 120
exports are used only inside the file.

| Lines | Section | Size | Depends on |
| --- | --- | --- | --- |
| 1-29 | Usage comment | 29 | |
| 30-94 | Imports, small helpers, record load and save, next B-/D- id | 65 | core/ (transcript, deploy, validate, evcore, cli, ...), tools/guard, tools/build, chart/*.json |
| 95-110 | Central-time date and clock | 16 | |
| 111-286 | BACKLOG, DECISIONS, CHANGELOG renderers and Your turn | 176 | |
| 287-342 | parseTableXml (Docs XML tables) | 56 | |
| 343-486 | lintChart, formatLint | 144 | spec `tasks.retired`, test files |
| 487-537 | boardName, changelogLine, readBody, isDocsTool | 51 | |
| 538-967 | applyLog (337 lines) and applyReport | 430 | transcript |
| 968-1215 | Chat words, Board comments, quarantine, inbox, commit | 248 | test/harness/quarantine.json, git |
| 1216-1494 | Ship's pure parts: steps, ArtifactData readers, ship-job checks, full-check refusal | 279 | dist/check-full.json |
| 1495-1739 | ship() | 245 | build.mjs, dist/, spec |
| 1740-1841 | Tags and recordShip | 102 | git tags |
| 1842-1970 | trace | 129 | spec, dist/trace |
| 1971-2168 | kickoff | 198 | tools/kickoff.md |
| 2169-2451 | brief, health, whereToLook, nextRuns | 283 | spec, dist/state/live |
| 2452-2679 | plan hand-off | 228 | transcript Docs reads |
| 2680-2923 | rollback | 244 | git worktrees, npm test |
| 2924-3154 | Argument parser, commands, main | 231 | |

## Map: the unit tests

| Group | Files | Lines | Exercises |
| --- | --- | --- | --- |
| The Chart tool | chart (1,933), trace, tags, quarantine, check-touched | 2,479 | tools/chart.mjs, check.mjs, tags.mjs |
| Build, check, hooks, guard | cli (637), actions (451), hooks, build, guard, format, personal-data, synthetic, tool-result, tenet-sweep, smoke, layout | 2,236 | tools/build, hooks, guard, personal-data, tool-result; core/deploy |
| Study logic (core/) | core (1,446), lint (601), conversation (573) and 21 more | 7,094 | core/evcore.mjs, validate.mjs and the rest of core/ |
| Pipelines, prompts, spec | pipelines (1,282), run (800), prompts, spec, evening-mac, watch, scheduler, steps, clinical-prep, reminders, flower-spec | 4,584 | core/run, steps, watch, derive; tools/prompts, gate; the spec |
| The page | page, reader, motion, tenets, contrast, look, interface-motion, panel, page-names | 1,610 | page/ source and harness files, read as text |
| Migration, seed, restore | migrate (908), restore, seed, dosage | 1,604 | core/migrate, seed, batches |

## Findings, ranked by long-term value

Each has a kind, a size, a risk and a suggested branch. "Out" is lines removed; "moved" lines change file but stay.

1. **duplicate: one ArtifactData reader in chart.mjs** (`trim/chart-readers`, about 70 out, risk none). `jobFrom`
   (1349) and `shipJobFrom` (1420) are near-identical; `versionsFrom` (1313) and `docVersionFrom` (1333) repeat one
   version regex; `jobResultSeen` and `weekFrom` repeat one loop. One "newest get of collection/id" helper replaces
   them. The same pass can fold the Docs read scanners, `docTabRead` (1979) and `designRead` (2500), which are the
   same filter-and-reverse loop, and the three copies of XML entity decoding (299-303, 1998-2007, 2477-2483): about
   40 more out. Most valuable first because ship, trace, kickoff and plan all read the transcript through these, so
   the next change to any of them touches one place.
2. **duplicate: the copied fixture preamble in seven study-logic test files** (`trim/test-preamble`, about 200 out,
   risk none). The block `at`/`key`/`ev`/`ws`/`att`/`E4`/`assertValid` (about 35 lines; see test/mirror.test.mjs
   14-45) is copied from core.test.mjs into canvas-rules, conversation, insights, mirror, sessions, share and skills.
   `att` is defined in all seven and used in none of them; `ws` is unused in canvas-rules and conversation;
   `assertValid` is unused in conversation, insights, mirror and share. Move the block into test/helpers.mjs and import
   what each file uses. Only test files change.
3. **retired: test/motion.test.mjs pins the retired core v2** (`trim/motion-v2`, about 250 test lines out, risk low).
   Its header says it "pins the retired Silk core v2" (history since D-212 and D-224). The page calls one export of
   core/motion.mjs: `EVMotion.coreSize` (page/app/60-ev-conversation.js:722; grep of page/, tools/, test/harness/ and
   spec/). The envelope, gesture, spring, glance and step-down tests (about lines 58-270) drive exports nothing real
   calls. Keep the size-step test and the build wiring test. Most of core/motion.mjs (244 lines) could go with it, but
   that file is built into the page (tools/build.mjs 388-408), so that part is a hashed change through staging and
   the full check, and `spec.ui.look.core` (validated at line 271) is a spec shape a trimmer leaves alone: take the
   tests and the dead exports first, and leave the spec to a build chat.
4. **dead: chart.mjs switches and options nothing reads** (`trim/chart-dead-flags`, about 10 out, risk none).
   `--force` and `--retire` are in the parser's switch set (2933, 2937) and nothing reads `o.force` or `o.retire`.
   `--restated` (615) has no caller or test, and a changed title or why already sets it. `--into` (744): `--triage
   join <id>` reads the id first and no test passes `into`. `log new --after` (700-702): no caller, no test.
   `renderBacklog`'s `header` option (195): every caller passes none. `decisionDate`'s `d.at` fallback (230) and
   `d.checkedBy` (238): no decision in chart/decisions.json has either field. With these, the two usage lists, which
   are both out of date (the header comment leaves out `trace` and `kickoff`; main's error at 3142 leaves out
   `quarantine`, `trace`, `kickoff` and `rollback`), become one.
5. **dead: the standalone `kickoff` command** (`trim/kickoff-command`, about 25 out, risk none). CLAUDE.md's design
   job lands the kickoff through `trace --kickoff`, which calls `kickoffFrom` directly; nothing runs `chart.mjs
   kickoff` (grep of CLAUDE.md, docs/, .claude/, .github/, spec/, core/ and tests; only tools/kickoff.md's first line
   mentions it). The command block (3042-3066) and its `--theme` flag go; `kickoffFrom` and `kickoffText` stay.
6. **duplicate: watchdog behaviour tested twice** (`trim/watch-tests`, about 80 out, risk low). Four behaviours are
   tested in both test/watch.test.mjs (on `watch()`) and test/steps.test.mjs (on `CODE_STEPS.watch`): a missed
   morning re-fired once (watch 57, steps 54), a stalled job and an unfinished run re-fired once (watch 78, steps 86),
   a Mac slot never re-fired (watch 283, steps 128), and refused at start or never fired (scheduler 68, steps 73).
   The steps versions also check the push and the record's validity: keep those and cut the matching cases from the
   other files down to what only they check. The cutter should confirm each pair asserts the same outcome first.
7. **duplicate: small repeated asserts** (`trim/test-repeats`, about 20 out, risk none).
   - prompts.test 106 (D-192) and 421 (B-149) both assert no `v4.x.y` in any prompt and the release read from the
     manifest: one test.
   - build.test 117 asserts `registryProblems(...)` is empty; spec.test 343 asserts the same and plants a fault: drop
     the build.test copy.
   - layout.test 33 and format.test 54 both check the devDependencies: one owner.
   - reminders.test 87 checks one boundary phrase in every prompt, which prompts.test 367 (D-175) checks for every
     phrased boundary; confirm the phrase is among them, then drop it.
8. **patch layer: the task-or-page split in ship** (`trim/ship-classify`, about 40 out, risk none). shipStep and ship
   classify reads, lines and calls as task or page six separate ways (isTaskRead/isPageRead, isTaskLine/isPageLine,
   `/trigger/` against `'Artifact'` at 1299, 1688 and 1701, and a skipped-text regex at 1306). One classifier does it.
   Ship is how every change reaches staging, so the cutter runs the ship tests and one `ship staging --check` dry
   read, and takes it after item 1.
9. **duplicate: small helpers repeated across chart.mjs** (`trim/chart-helpers`, about 40 out, risk none). The
   transcript read idiom (`o.transcript || newestTranscript()`, then exists and read) appears 8 times (1524, 1584,
   1950, 2863, 2996, 3044, 3078, 3119); spec/ev.spec.json is read 6 times, twice in one ship call (1529, 1546);
   9 inline `JSON.parse(fs.readFileSync(...))` sit beside `readJson`; the commit message and trailers are built twice
   (1212, 2906); the inbox triage instruction is written 3 times (382, 1143, 2278); the artifact URL is built 6 times;
   "a declined or finished task waits on no one" appears 3 times in applyLog (757, 777, 862).
10. **split: chart.mjs into modules** (`trim/chart-split`, restructuring, 0 out, risk none). The file holds about
    eight jobs: record, renderers and lint (75-486); log, report and inbox (538-1215); ship, tags and ship jobs
    (1216-1841); trace; kickoff and plan, which share the Docs readers; brief; rollback; the CLI. After items 1, 8 and
    9, a `tools/chart/` folder with one module per job and chart.mjs as the CLI would make each command readable on
    its own. The tests use `import * as C`, so chart.mjs re-exports and no test changes but imports. Large: do it in
    parts, one module per pull request.
11. **split: the four largest test files** (restructuring, 0 out, risk none). After the cuts above, split
    test/chart.test.mjs (1,933) by command (log and lint, report and inbox, ship and tags, plan and kickoff,
    rollback), test/core.test.mjs (1,446) by topic (dates and review, answers and weak spots, plans, day edits), and
    test/pipelines.test.mjs (1,282) by pipeline. Move test/migrate.test.mjs's schema bumps (541-907) into one bumps
    file with dosage.test 95 and open.test's bumps once queue item 9 has taken the v3 part. Line ranges are in the
    helper's notes and should be re-read at the time, since items 8 and 9 move them.
12. **dead: test/run.test.mjs `idAnswer`** (659, about 10 out, risk none): defined, never called. Ride along with
    item 7.

## Found, not a trim

- **Possible bug in rollback's keep list.** `ROLLBACK_KEEP` (tools/chart.mjs 2686) keeps `chart/`, BACKLOG.md,
  CLAUDE.md and the skills, but not DECISIONS.md or CHANGELOG.md, which tools/build.mjs's `BOOKKEEPING` lists. A
  rollback restore would bring back old copies of those two generated files while `chart/` stays current, and the
  drift test would fail. Not tested here; a build chat should check it before a rollback is ever needed.

## Keep (looks cuttable, earns its place)

- **`log rule`** (652-680) is called only by tests, but it is the only writer of chart/rules.json, which CLAUDE.md
  says is written only through the tool; and rules.json is outside a trimmer's reach.
- **`ship --during-session`** (1625): no caller passes it, but it is R-03's override on Matt's OK, mirrored in
  core/cli.mjs's `deploy` (test/cli.test.mjs 269). Rules are outside a trimmer's reach.
- **The Board-comment tests** (chart.test 345-392): `inbox` still reads Board comments (CLAUDE.md, chart.mjs 894 and
  1120).
- **R-01, D-172 and `spec.tasks.retired` tests** (chart.test 153-176 and 1250, page.test 311, spec.test 316): they
  test the record's history and the verify path, which are live.
- **v3 leftovers in lint** (lint.test 165, 451, 486, testing core/derive.mjs 663 and core/lint.mjs 128-137): reachable
  from the nightly lint while the record still holds legacy documents. They go only after a build chat drops those.
- **The B-141 doc sweep** (chart.test 1271-1299): partly a one-time check (the Foundation doc's tab names "as read on
  Oct 21"), but it also asserts that CLAUDE.md names the live and staging record ids. If it is trimmed, keep the
  record-id asserts.
- **Skips:** format.test 20 and 72 skip without prettier installed, which CI has; schema.test 88-99 skips without the
  ignored `fixtures/` export. That one never runs in CI either (about 12 lines); it can go with queue item 9's
  always-skipping test if Matt no longer keeps a local export to check.
- **Exported names used only inside chart.mjs** (about 40, such as `FILES`, `chartDir`, `findTask`, `readBody`):
  dropping `export` saves no lines and fights the tests' `import * as C`. Not worth a pull request.

Rough total that can go: about 750 lines out (items 1 to 9 and 12), plus the dead part of core/motion.mjs once
item 3's tests have gone.
