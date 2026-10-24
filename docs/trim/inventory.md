# Trim inventory (B-258, B-262)

Written by an overnight trimmer run on Oct 24, 2026, at origin/main 7d57e7c, for `docs/trim-brief.md` step 1. It
removes nothing. Each row says what a piece of machinery is, the failure it prevents, when it last fired, its size, the
risk to studying if it went, and a suggestion. A trimmer takes the rows marked **shrink** or **retire** in the order at
the end.

**How "last fired" was found.** GitHub Actions run history (`gh api .../actions/workflows/<file>/runs`, read Oct 24
01:20Z); git log on origin/main (1,060 commits, unshallowed); task notes in `chart/tasks.json` and entries in
`chart/deploys.json` (190 deploys, 33 of them live). No E.V. record was read, so pipeline runs are dated by the newest run
id the Chart names, not by the record's own `runs/`. For a gate, "fired" means it refused something; "passed" means it
was checked and let the deploy through. "Never recorded" means no refusal appears in any of those sources; it does not
prove the check never refused in a chat.

Lines are the file's lines, the entry's lines in the pretty-printed spec, or the CLAUDE.md section's lines (and words).

## Rules (`chart/rules.json`)

| Rule | What it is | Failure it prevents | Last fired (evidence) | Lines | Risk if it goes | Suggestion |
| --- | --- | --- | --- | --- | --- | --- |
| R-01 | Live takes page-only changes while v3's rollback window is open | A live deploy that changes stored documents, prompts or schemas while v3 could still be rolled back to (D-139) | Ended Oct 19 by D-145 (commit 10c6b3c, "R-01 ends"). The row stays, marked ended, as CLAUDE.md says. Its check can no longer refuse anything, but `tools/chart.mjs` still carries it: `PAGE_ONLY`, `pageOnlyFindings` and the R-01 branch of ship live, plus their tests | rule row 9; code about 45 in chart.mjs, tests about 20 | none | **retire** the code (the rules.json row stays as it is) |
| R-02 | A build reaches live only through staging, green at the same commit | An untested build going to Matt's live page (D-049, B-35) | Proven refusing Oct 18 (B-35 note: "deploy live now refuses"); passed on all 33 live deploys; no later refusal recorded | 7 | high | keep |
| R-03 | A live deploy waits while a study session or skills run is going on | A deploy swapping the page under Matt mid-session (D-139, B-87) | Passed and named in notes: B-90, B-91 (Oct 19, "read the running sessions first (none)"), B-104 (Oct 20, "no live study session running"). No refusal recorded | 7 | high | keep |
| R-04 | A live deploy needs Matt's explicit OK (chat words or his Ship it tap) | Anything going live without Matt (D-083, B-185) | Every live deploy in deploys.json carries `okFrom: "Matt"`; 2 of the 7 live deploys since Oct 22 05:29Z came from a ship job. No refusal recorded | 7 | high | keep |
| R-05 | Live deploys wait out the 20 minutes around each live watchdog run | A deploy landing while the watchdog reads the record, so health reads a half-deployed system (D-142, B-102) | Added Oct 20 (0c0da55). 18 live deploys since; never recorded refusing (B-104: "outside the watchdog windows") | 7 rule; about 20 code | low | keep for now: never recorded firing, but rules.json is outside a trimmer's reach; Matt's call **Done Oct 23 (D-262).** |
| R-06 | Live takes only a commit the full check passed | A build that passed only the touched check going live (D-226, B-219) | Added Oct 22 (d8f4579). 6 live deploys since; never recorded refusing | 7 rule; about 25 code | low | keep |

## Hooks (`.claude/settings.json`)

| Hook | What it is | Failure it prevents | Last fired (evidence) | Lines | Risk if it goes | Suggestion |
| --- | --- | --- | --- | --- | --- | --- |
| SessionStart marker | Writes the time to /tmp/ev4-hook-marker | None any more: it was the B-65 probe for "do hooks load in a scheduled run?" | Answered Oct 20: marker written 00:09Z in a build session, absent in the scheduled diagnostic (spec `environments` evidence, B-65). Nothing reads the file; only spec text quotes it | 1 | none | **retire**, but `.claude/settings.json` is outside a trimmer's reach: a build chat's job, on Matt's OK **Done Oct 23 (D-262).** |
| PreToolUse live-guard | Refuses a live Artifact or ArtifactData write unless `deploy live --matt-ok` wrote dist/live-ok | A build chat writing Matt's live record or page by hand (B-58, a hard limit) | Fired Oct 20 03:55Z, refusing the live watchdog's writes (a false positive, fixed by B-131's run marker; spec `environments`) | about 60 of tools/hooks.mjs | high | keep |
| PostToolUse spec-format | Rewrites spec JSON at indent 1 with no trailing newline after each edit | Spec diffs and hashes that churn on formatting (B-57) | Runs on every Edit/Write in a build chat; no record of it changing a file | about 30 of tools/hooks.mjs | none | keep (small; tools/hooks.mjs is outside a trimmer's reach) |
| Stop | Runs npm test at the end of each turn, once per tree | A turn ending on red tests (B-56) | Runs every build-chat turn; reworked Oct 21 (848ac9b, B-146) to skip an unchanged green tree | about 70 of tools/hooks.mjs | none | keep |

## Workflows (`.github/workflows/`)

| Workflow | What it is | Failure it prevents | Last fired (evidence) | Lines | Risk if it goes | Suggestion |
| --- | --- | --- | --- | --- | --- | --- |
| test.yml | prettier --check and npm test on every push and pull request | Red or unformatted code reaching main unseen (B-64) | 594 runs; 54 red, the newest Oct 23 15:12Z at a33d0e9 (run 39976244713) | 24 | low | keep |
| smoke.yml | The two-minute page smoke at 390 and 1280 on every push and pull request, then each plant must turn it red | A push that breaks boot, a tab, a check-off, a review answer or a reply (B-199) | Since Oct 22: 91 completed runs, all green; 214 cancelled before finishing by its cancel-in-progress concurrency; red **never** (`status=failure` total 0, read Oct 24) | 53 | low | **shrink**: it costs a runner on every record commit and has never been red in a finished run; it could run only on pushes that change the page (order 4) |
| nightly.yml | The full `npm run check` every night with screenshots | Page and look regressions the per-push tiers miss (B-151) | 6 runs; newest Oct 23 13:46Z, green; one red, Oct 22 14:03Z at 9e56081 (run 39792387960, the check step) | 39 | low | keep |
| tags.yml | Makes each live deploy's release tag on origin | Live deploys without a release tag, since a cloud session can't push tags (B-175, D-173) | 62 runs, none red; newest Oct 24 00:44Z, after the v4.5 live deploy | 24 | none | keep |

## Pipelines (`spec.pipelines`)

Pipeline behavior is out of the trim's scope; these rows are for the picture only.

| Pipeline | What it is | Failure it prevents | Last fired (newest run the Chart names) | Lines | Risk if it goes | Suggestion |
| --- | --- | --- | --- | --- | --- | --- |
| morning | Builds the day's review set, drills, plan and list before the 5am alarm | Matt waking to no practice | runs/morning-20261021-154424342 | 118 | high | keep |
| evening-cloud | Parks passed-exam weak spots, recomputes weak spots, writes the snapshot | Stale weak spots and a snapshot that doesn't match his answers | runs/evening-cloud-20261022-014325892 | 109 | high | keep |
| weekly | Sunday review of the week | No weekly picture | runs/weekly-20261023-125141375 | 113 | low | keep |
| evening-mac | Canvas changes (read-only) and the nightly backup to his Mac | Missed course changes; no backup | runs/evening-mac-20261022-015207543 | 159 | high | keep |
| worker | Does one job Matt asked for and posts the result | Jobs from the page going nowhere | runs/worker-20261021-115949480 | 135 | low | keep |
| watchdog | Writes health/current: which runs ran, missed or wait | A silent missed run | runs/watchdog-20261021-125602723 | 39 | low | keep |
| restore-drill | Restores the newest backup into staging and checks counts and hashes | A backup that can't be restored, found only when needed | runs/restore-drill-20261018-104320797 | 127 | none | keep (out of scope; it has not been named since Oct 18) |
| diagnostic | Runs one named probe so a capability is proven before it is built on | Building on a capability a run doesn't have | runs/diagnostic-20261021-110125159 | 159 | none | keep (out of scope) |
| `_rules` | The run protocol's five shared rules | Pipelines drifting apart | n/a | 5 rules | high | keep |

## Tools (`tools/`)

| Tool | What it is | Failure it prevents | Last fired (evidence) | Lines | Risk if it goes | Suggestion |
| --- | --- | --- | --- | --- | --- | --- |
| build.mjs | Builds dist/: manifest, prompts, system docs, the page | Shipping what wasn't built from main | Every deploy; newest live Oct 24 00:44Z at 2eba0a6 | 607 | high | keep |
| chart.mjs | The Chart's commands: report, inbox, log, plan, ship, brief, lint, rollback | A hand-edited, drifting project record (D-140) | Every record commit (newest 7d57e7c area) | 3,924 | none (process only) | **shrink**: it carries code for things that are over: R-01's check (row above), the retired Docs views (`views`, Board and overview calls, about 250 lines beside `printViews`, retired by D-172; the inbox's Board-comment read must stay) and the one-time `import` from v3 (B-92, about 150 lines) |
| check.mjs | Runs every check in order; `--touched` for the changed harnesses | Shipping without the page harnesses and look pass (B-101, B-219) | Nightly Oct 23 13:46Z, green | 208 | none | keep |
| format-app.mjs | Formats the page logic as one joined file | Prettier splitting the page closure badly (B-64) | Used by `npm run format`; one commit ever (Oct 20) | 73 | none | keep |
| gate.mjs | The run gate rendered into every task prompt | A run executing code that isn't the deployed build (B-132, D-170) | Every pipeline run | 112 | high | keep (outside a trimmer's reach) |
| guard.mjs | The builder marker that refuses pushes to guarded paths | An unattended builder changing hard limits or tasks (B-184, D-200) | Every builder run's first step (D-194); no refusal recorded | 152 | low | keep |
| hooks.mjs | The three hooks above | See the hook rows | See the hook rows | 216 | high | keep (outside a trimmer's reach) |
| kickoff.md | Template for the design kickoff | A design chat starting without the north star and the Chart (B-183, D-197) | Staging design job Oct 23 (Matt: "reads like one he would paste: Yes") | 33 | none | keep |
| personal-data.mjs | Scans for record exports and backups before they're committed | Matt's data in the repository (a hard limit) | Every npm test | 138 | high | keep |
| prompts.mjs | Renders every scheduled task's prompt from the spec | Prompts drifting from the spec (verify-deploy compares hashes) | Every build | 111 | high | keep |
| tags.mjs | Makes missing release tags from deploys.json | See tags.yml | Oct 24 00:44Z (tags.yml) | 94 | none | keep |
| tool-result.mjs | Saves a tool's result from the transcript | Retyped reads (B-04) | Every deploy and verify (core/deploy.mjs) | 56 | none | keep |

## CLAUDE.md sections

| Section | What it is | Failure it prevents | Last fired (evidence) | Lines (words) | Risk if it goes | Suggestion |
| --- | --- | --- | --- | --- | --- | --- |
| Opening | What v4 is, where the design and the Chart live, the hand-off tables, tenets | Sessions working from a stale design doc (D-184) | Read every build session | 23 (307) | none | **shrink**: it still explains things that are retired (the v3 Docs views, D-172; v3's retirement history) |
| Every session | The build chat's eight steps | Untracked, unproven or unreviewed work | Every build chat | 45 (735) | none | keep |
| Unattended runs | What an unwatched build session may do | A scheduled run waiting forever or acting irreversibly | Builder runs | 11 (163) | none | keep |
| Builder runs | The builder's job kinds | A builder doing more than its job (Oct 21 note) | Builder runs Oct 21 to 23 | 31 (483) | low | keep |
| Trimmer runs | Points to the trim brief | Trimmers following build-chat steps | This run | 5 (44) | none | keep |
| Scheduled pipeline runs | Pipeline runs aren't build chats | A pipeline refusing its own job | Every pipeline run | 8 (109) | low | keep |
| Hard limits | spec.boundaries B-01 to B-18 in words | Every hard limit | Always | 14 (258) | high | keep (outside a trimmer's reach) |
| Rules from past failures (was Gotchas carried from v3; moved to docs/lessons.md, #4) | Eight lessons, each with its rule | Repeating v3's and v4's incidents | Read every build session | 28 (432) | none | **shrink**: brief order 2; the lessons move to a lessons file, and only the rules that still name a failure stay |
| Rollback (D-145) | How going back works now | A rollback done by hand | Never run on live (no rollback deploy in deploys.json) | 9 (125) | low | **shrink**: its first paragraph retells v3's ended window; the skill holds the steps |
| Where things live | Links and paths | Sessions hunting for links | Every build chat | 10 (138) | none | keep |

## Order for the cuts

The brief's order, with what each trimmer may reach:

1. Process that can't fire again, and text-only cuts:
   1. R-01's leftover check in `tools/chart.mjs` (`trim/r01-check`). The rules.json row stays. **Done: #2.**
   2. The SessionStart probe hook: **skip for trimmers** (`.claude/settings.json`); a build chat can do it on Matt's OK.
      **Done Oct 23 (D-262).**
   3. R-05's leftover check: the watchdog-window code in `tools/chart.mjs` and its test (`trim/r05-check`). R-05 was
      retired Oct 23 (D-262) and its rules.json row stays, marked ended. **Done: #3** (and CLAUDE.md's step 6 no longer lists it).
2. CLAUDE.md: the gotchas move to a lessons file (`trim/gotchas`, **done: #4**), then the opening (`trim/claude-opening`, **done: #5**) and the
   rollback paragraph (`trim/rollback-text`, **done: #6**).
3. Dead code in `tools/chart.mjs`: the Docs-view calls (`trim/docs-views`, **done: #8**), then the one-time v3 import
   (`trim/v3-import`, **done: #9**). The tool went from 3,924 lines to 3,308.
4. Test and check time: smoke on page changes only (`trim/smoke-scope`, **done: #7**).
5. The rest of the retired Docs views in `tools/chart.mjs` (`trim/docs-views-2`, **done: #12**):
   `changelogCalls`, `decisionsCalls`, `mdEscape`, `tenetLabel`, `tabTitle`, `textCell` and `sameStatus` with their tests
   (only tests call them now, about 110 code and 150 test lines); then the `views` command, `printViews` and the
   `views: [...]` arrays `applyLog` and `applyReport` return, which now only print "retired"; and `brief`'s Finish line
   that still says "views prints the Board call".
6. Low value since the repository went public on Oct 23 (its Actions minutes are free now): GitHub Actions minutes
   (`trim/ci-minutes`). **Declined by Matt, #11:** it would also skip the personal-data scan on those pushes, which
   matters more on a public repository. Run npm test on pull requests and on pushes that change code, not on pushes that touch only
   `chart/`, the generated files or `docs/`; keep the nightly. Worth it only to cut noise.
7. Small text, low value: CLAUDE.md's "Where things live" repeated the v3 row (`trim/where-v3-row`, **done: #10**).

Added by the queue refill of Oct 24 (`trim/queue-refill`, at origin/main 239e72b), when items 1 to 7 were all done or
claimed (#11 holds item 6, #12 holds item 5). Each was mapped by a read-only helper and its key callers
re-checked by grep. Git history on main is squashed before 75c2b59, so evidence comes from the Chart and the code.

8. Leftovers in `tools/chart.mjs` that #8 and #9 left behind (`trim/chart-leftovers`, about 45 lines; take it after
   item 5 merges, since both edit the same file):
   - `parseBacklogRow` (about 8 lines): no caller anywhere, tests included; its only caller was `importChart`, removed
     by #9.
   - `plan --handoff-note`: `BUILD_PLAN`, `HANDOFF_NOTE`, `handoffNoteCall`, the branch in `plan`, the flag and its
     usage text (about 20 lines), and the one assert at the end of the B-106 plan test. It wrote one line to the design
     doc's Build plan tab once; B-106 is done ("Build plan tab line and CLAUDE.md hand-off line in"), and nothing in
     tools/, core/, .claude/, .github/ or CLAUDE.md passes the flag.
   - `docCall`: once item 5 and the hand-off note are gone, nothing calls it.
   - Board-only fields written and never read: `board.why`, `board.notes` and `board.were` (the `--why` and
     `--board-note` options of `log <task>`, and the `why`/`notes` that `applyReport` stores; `log decision --why` and a
     deploy's `why` stay). Their readers (`boardRow`, `boardCalls`) went in #8; `board.were` is also written by the
     renumber path (item 11), which the cutter edits too. `board.row`, `--name` and `boardName` stay: the deploy summary and Your turn read them.
   - `brief`'s `rec.views.retired ? 'DECISIONS.md' : rec.views.decisionsTab` (one line; `retired` is always set) and
     the header comments that still describe the Board, Changelog and overview views and the import.
   - Must stay: everything the inbox's Board-comment read uses (`commentsFrom`, `commentQuery`, `commentReply`,
     `inboxPlan`, `applyReport --from-comment`, `rec.views.doc` and `'views'` in `FILES`).
9. The v3-to-v4 migration (`trim/v3-migration`). A hashed change (`core/`), so it ships through staging and the full
   check on merge. Live was migrated at the Oct 19 cutover (B-24, 10c6b3c) after `verify-migration` was green on the
   live v3 export (B-06), staging at B-12, and D-145 ends any going back to v3. No pipeline, prompt, workflow or skill
   runs `migrate v3` or `verify-migration`; only `core/cli.mjs`, `core/seed.mjs` and tests reach `migrateV3`. About
   515 lines in `core/migrate.mjs`, 70 in `core/cli.mjs`, 5 in `core/seed.mjs`, and about 510 test lines, so it
   comes in parts under the 400-line budget:
   1. **Done: #14.** `verify-migration`: the command, `verifyMigration`, `comparable` and `DERIVED_FIELDS`, and their tests.
   2. `migrate v3` and `seed-staging`'s v3 branch, then `migrateV3` and its helpers, and the v3 tests in
      `test/migrate.test.mjs` (including the "real v3 export" test, which always skips: `fixtures/` is ignored) and
      `test/seed.test.mjs` (lines 68 to 88).
   - Must stay: the schema bumps (`BUMPS`, `migrateBumps`, `bumpWrite`, `currentVersion`: `migrate bumps`, seed,
     restores and core/watch.mjs use them), `applyWrites` and `chunkWrites` with their tests, `iso`, and the
     `migration` field in system.schema.json (schemas are out of scope). The cutter should say plainly what
     `seed-staging` does with an export that has a document without the v4 envelope once the v3 branch is gone.
10. Small leftovers in `core/deploy.mjs` (`trim/deploy-leftovers`, about 15 lines; hashed, so it ships through staging,
    and is low value on its own: pair it with another `core/` change if one is going anyway):
    - The commit-only fallback for a `dist/verify-staging.json` saved before content hashes existed (`deployCalls`, its
      own comment says so); both writers always include `contentHash` now, and dist/ is rebuilt for every deploy. Its
      test in `test/cli.test.mjs` changes with it. The fallback sits inside R-02's staging-green check, so cutting it
      makes that check stricter, never looser; that cut's pull request should say so.
    - The "(created in B-12)" wording it still prints, which a chart test bans elsewhere as pre-cutover text, and
      `deployCalls`' doc comment, which sits above `liveSessions`.
    - The `export` keyword on `readIds`, `tasksFor`, `liveSessions` and `RUNNING_READ` (no importer).
11. Judgement call, Matt's: `log <id> --which <n> --renumber <id>` in `tools/chart.mjs` (about 18 lines). The only
    duplicate id ever was B-83 from the v3 import (B-98 carries `renumberedFrom`), and nothing files a duplicate now,
    but lint's `duplicate-id` check would still need a repair path after a hand edit. Keep unless Matt prefers fixing
    such a slip by hand.

Added by the second queue refill of Oct 24 (`trim/queue-refill`, at origin/main a9b9c40), when items 1 to 10 were all
done, claimed or declined (#15 holds item 8, #16 holds item 10, and item 9's second part sits with the v3-migration
run). Two read-only helpers mapped `tools/chart.mjs` and the rest of `tools/` with the test suite; their key claims
were re-checked by grep. `core/migrate.mjs`, `core/cli.mjs`, `core/seed.mjs` and `core/deploy.mjs` were left alone
because other runs are cutting there. Ranked by value for the long term (D-264):

12. Core v2's motion functions (`trim/motion-v2`). The biggest dead block left, and it is in the page's own code.
    `core/motion.mjs` (244 lines) is "history since D-212 and D-224" by its own header, but the build still publishes
    all 16 of its functions as `window.EVMotion` (tools/build.mjs, the core.js join). The page calls only
    `EVMotion.coreSize` (page/app/60-ev-conversation.js and 61-ev-captions.js). A word grep of the other 15 names
    (`critSpring`, `nucleusStep`, `wordVoice`, `envelopeRadius`, `envelopeStart`, `envelopeStep`, `GESTURES`,
    `gestureBlend`, `blendAll`, `glanceAngle`, `percentile`, `stepDownStart`, `slowShare`, `stepDownStep`, `smooth`)
    over page/, core/, scripts/ and tools/ finds none (the only `smooth` hits are CSS `behavior: 'smooth'`). Their tests
    are 10 of the 13 in `test/motion.test.mjs` (lines 58 to 270, about 210 lines); the `coreSize` test (205), the spec
    test (271) and the EVMotion-in-core.js test (323) stay, though 323's check that `envelopeStep` and `gestureBlend` reach `window.EVMotion` changes to `coreSize`. About 200 code and 210 test lines, so it comes in two parts
    under the budget: the functions with their tests, then any `spec.ui.look.core` parameters only they read (spec is
    hashed; leave the parameters if the spec test or the look harness reads them). Risk to studying: low; it changes
    the published core.js, so it ships through staging and the full check, and `npm run smoke` and the look pass must
    show her drawing exactly as before.
13. Small leftovers in `tools/chart.mjs` after #15 (`trim/chart-leftovers-2`, about 15 lines; take it after #15
    merges, since both edit the file):
    - `--force` and `--retire` in `args()`'s flag set: nothing reads `o.force` or `o.retire` (the other `force`s in
      the file are two `git worktree remove --force` calls).
    - `d.checkedBy ||` in the tenet line of DECISIONS.md: 0 of 221 decisions carry `checkedBy`; it was the v3 import's
      name for `check`.
    - `decisionDate`'s `d.at` fallback: all 221 decisions carry `date`, and `log decision` always writes it.
    - The test fixture keys nothing reads: `SAMPLE_VIEWS`' `changelog`, `overview`, `board.table`, `statusEnum` and
      `statusOptions` (test/chart.test.mjs 33 to 44). Once #15 has merged (it removes `brief`'s `decisionsTab`
      fallback and the writers of `board.why`/`board.notes`), also `decisionsTab` and the sample tasks'
      `board.why`/`board.notes` (60 to 61); until then `brief` still reads `decisionsTab`, since the sample views have
      no `retired`. Keep `board.node` and `decisions.node`: the inbox and the B-143 test read them.
14. Duplicates in `tools/chart.mjs` (`trim/chart-dupes`, restructuring under D-264, about 15 lines out): `docTabRead`
    and `designRead` both take the newest successful Docs read of a doc id from the transcript and differ only in
    their filters (`docTabRead` wants a whole tab read by node; `designRead` wants the 'Tasks to add', 'Decisions
    proposed' or 'Tenets proposed' tables), so one helper taking a predicate would do;
    `CHART_DESIGN` repeats `rec.views.design` (brief already reads the latter); the `boardName(t).replace(/^v4 B-\d+: /,
    '')` pair (yourTurnLines, recordShip) and the "(Bug|Request) (reported ...):" title strip in `askOf` and
    `shortTitle` are each written twice. No behavior changes; the existing tests pass unchanged.
15. Never-taken branches in the other tools (`trim/tools-leftovers`, about 15 lines; tools/ is not hashed, but
    tools/build.mjs makes dist/, so the cutter shows a build before and after gives the same manifest hashes):
    - tools/build.mjs: the "no tools/prompts.mjs" return (the file is always there), the "no page/index.src.html"
      fallbacks (the shell is committed), `taskEntries`' unread `release` parameter, and `const g = g0`.
    - tools/format-app.mjs `--check`: nothing passes it (package.json runs the file without it).
    - tools/tool-result.mjs re-exports `newestTranscript`, `toolResults` and `resultBody`, which only
      test/tool-result.test.mjs imports; it can import them from core/transcript.mjs.
    - Not a cut: `check.mjs --since` (hand use) and build.mjs's `legacy` case (the frozen collection D-145 keeps).
16. The `export` keyword on names nothing imports (`trim/unused-exports`, about 40 one-word edits, no lines out):
    about 30 in tools/chart.mjs (TASK_STATUS, findTask, nextTaskId, ctDate, backlogRow, jobFrom, tenetsFor and others
    the chart helper listed) and 8 in the other tools (build.mjs `gitState`, `releaseOf`, `coreParts`; check.mjs
    `changedSince`, `lastStaging`, `main`; prompts.mjs `runLimits`; format-app.mjs `formatApp`). Lowest value: it only
    makes a file's public face honest. Pair it with item 13 or 15 rather than opening it alone.

Looked at and kept:
- test/schema.test.mjs "every real fixture document validates (fixtures/v4, local only)" always skips in CI (fixtures/
  is ignored and nothing writes fixtures/v4), but it is a 12-line check a build chat can run against a real export it
  drops in; keep unless Matt says no one does.
- The PDF attachment checks in test/harness/run.cjs (about 22 lines) skip in CI because pdfjs-dist is not installed
  there. That is a coverage gap, not dead code; closing it would add an install step, which a trimmer does not do.
  Flagged for a build chat.
- test/spec.test.mjs 331 to 339 asserts the six v3 task ids stay in `spec.tasks.retired`, citing a rollback D-145
  dropped. The list itself still records disabled tasks (CLAUDE.md: v3's tasks disabled and kept), so the check
  stays; only its comment is stale.
- R-01's fixture in the B-141 and B-142 tests: those tests exercise the live ended-rule listing and stale-rule lint.

## Keeping this queue current

- **When a cut merges,** the build chat marks its item done here, with its pull request number.
- **A trimmer that spots another candidate** while cutting lists it under "Found next" in its pull request. The build
  chat adds it here when it merges that pull request.
- **When every item is done or claimed,** the next trimmer run refills the queue instead of cutting. It maps the
  largest process files (tools/chart.mjs first, then core/deploy.mjs and the test suite) with helpers, and opens a pull
  request that adds new ranked items here, with evidence for each.
