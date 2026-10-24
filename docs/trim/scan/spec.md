# Scan: the spec (`spec/ev.spec.json`)

Written by an overnight trimmer scan run on Oct 24, 2026, at origin/main a9b9c40, for `docs/trim-brief.md` "Scan runs"
(D-264). It changes no code. Two read-only helpers mapped the sections; the findings below were re-checked by grep at
that commit. Sizes are lines in the file as written (indent 1, 5,548 lines in all).

**How the spec reaches each reader.** Node code reads the whole file (`core/cli.mjs`, `tools/build.mjs`,
`tools/chart.mjs`, `tools/guard.mjs`, `tools/hooks.mjs`, `core/links.mjs`). `EV.configure(spec)` (core/evcore.mjs)
deep-merges `constants` over its own `DEFAULTS` and keeps the rest for lazy reads. The page never gets the whole spec:
`tools/build.mjs` `PAGE_SPEC_KEYS` picks sections, trims some (pipelines to lane, purpose and step count; `ui` without
`tenets`, `look.core` cut to `sizes`, `look.flower` without `inks`, `budget`, `reducedMotion`; `actions` without
`does`) and drops every `_`-key. Scheduled-task prompts are rendered from `pipelines` and `boundaries.rules[].prompt` by
`tools/prompts.mjs`. Two sections are also published into the record as system documents: `environments`
(`system/environments`) and `capacity.system`.

**Out of a trimmer's reach** (trim brief and run limits): `boundaries` and `actions` (both in
`boundaries.guarded.spec`), anything that changes a rendered prompt, the record's schemas, and what is published into
the record (`environments`). They are mapped here for the picture; findings in them are for a build chat with Matt.

## Map

| Section | What it does | Lines | Read by |
| --- | --- | --- | --- |
| specVersion | The spec's version; the untagged release falls back to it | 1 | build.mjs, chart.mjs, steps.mjs, derive.mjs, page 50-system |
| purpose | One sentence on what the spec is | 1 | nothing (`spec.purpose` appears nowhere; `p.purpose` hits are pipeline-level) |
| roles | The 13 writer and pipeline names | 15 | tests only (spec.test, pipelines.test) |
| pipelines | Each pipeline's purpose, lane, inputs, steps, failure handling, agent calls (9 entries) | 968 | run.mjs (steps, agentCalls), prompts.mjs (into every task prompt), derive.mjs (reads), steps.mjs (diagnostic probes), cli.mjs; page gets a summary |
| classes | What Fact, Edit, Derived, Log and Config mean | 7 | tests only; the class names are hard-coded in derive.mjs |
| constants | Numbers the logic runs on: review, day budgets, task minutes, plan day, studyWatch, library, watchdog, conversation, push, health, prep (156), runs | 277 | evcore.mjs `configure`, prep.mjs, library.mjs, sessions.mjs, watch.mjs, steps.mjs, deploy.mjs, hooks.mjs; page |
| registry | Record artifacts (records), Canvas ids (canvas), Study Watch app and reader, docs, repos | 57 | records: cli, run, deploy, hooks, chart; canvas: steps, canvas, evcore, lint; studyWatch.reader: build. docs, repos, studyWatch.app: nothing |
| courses | Per-course rules: kinds, library modules, budgets (NUR 112, BIO 201) | 106 | evcore.mjs, library.mjs, lint.mjs, derive.mjs; page |
| study | Scheduler choice, aim, params | 13 | study.mjs, derive.mjs; page |
| collections | The record's 33 collections: class, writers, key, holds, schema, appends, marks | 548 | derive.mjs, lint.mjs, his.mjs, run.mjs, build.mjs (writers against each schema's enum) |
| legacyCollections | v3 collection names kept by rule | 6 | lint.mjs |
| links | Typed links between documents (218 rows) | 225 | links.mjs; build.mjs checks every row |
| tasks | Scheduled tasks: name template, live, staging, diagnostic, build, retired (30 entries, 182 lines) | 377 | watch.mjs, build.mjs, deploy.mjs (retired are proven disabled), chart.mjs; page gets schedules and trigger ids |
| environments | Proven and unproven capabilities per surface (cloud run, Mac run, browser tab, page, build chat) | 376 | steps.mjs (surface names only); build.mjs publishes it whole as `system/environments`; deploy and chart diff it |
| capacity | Document byte limit, material sizes, batch size, the system budget, per-collection budgets (233) | 263 | run.mjs, lint.mjs, batches.mjs, cli.mjs, derive.mjs, evcore.mjs, build.mjs, deploy.mjs; page 50-system |
| boundaries | The hard limits B-01 to B-18 (`rules`, 168), `guarded`, plus policy text | 203 | prompts.mjs (`rules[].prompt`, 10 of 18), guard.mjs (`guarded`); the rest no code |
| workingAgreements | Five working agreements in words | 7 | tests only |
| jobs | Job kinds from the page (`kinds`), builder kinds and labels | 53 | steps.mjs, watch.mjs, prompts.mjs; page 60, 62, 72 |
| actions | The nine actions: args, writes, effects, callers, cost | 602 | core/actions.mjs; the page's actor (04-model) validates every call; build.mjs checks every row |
| persona | E.V.'s name, unit, role, voice, never-list, tagline, avatar | 56 | page 60, 72 (name to never); avatar: look harnesses only; tagline: nothing |
| items | Question types and fields, clinical-judgment steps, writing guide, units, dosage, open answers | 92 | item-kinds.mjs, steps.mjs; page 05, 20 (open, dosage, units, writingGuide). types, fields, cjSteps, cjStepLabels: nothing |
| ui | tabs, kit, rules, conversation, look (flower 564, retired core 290), page (shell, files, capabilities, subscribe), tenets | 1,218 | build.mjs (page.shell, files, capabilities, subscribe); page (flower, core.sizes, two conversation numbers, subscribe); look harnesses (tenets) |
| workouts | Skills-practice sequences | 76 | skills.mjs |

Of `ui`'s 1,218 lines, about 640 are values code reads (flower without its test-only keys, page, two conversation
numbers, `core.sizes`), about 285 are the retired core, and about 290 are prose or test-only data.

## Findings

Ranked by long-term value: what makes the next change smaller and safer.

1. **dead: the retired Silk core** (`trim/core-v2-retired`; spec about 285 lines, `core/motion.mjs` about 200 of 244,
   `test/motion.test.mjs` most of 333, two asserts in flower-spec.test). `ui.look.core`'s own `retired` note says "only
   sizes is still read" (B-205, D-212). The page calls one motion function: `grep -rn "EVMotion\." page/app` finds only
   `EVMotion.coreSize` (60-ev-conversation.js:722), and nothing in core/ or tools/ imports `core/motion.mjs` (the build
   inlines it into the page). The rest (`smooth`, `critSpring`, `nucleusStep`, the speech envelope, gesture blend) is
   reached only by motion.test.mjs. Cutting it also removes the build's `core: { sizes }` special case and shrinks the
   page bundle. Risk low (hashed: `spec/`, `core/`; ships through staging and the full check; the page harnesses prove
   her stage sizes). Over 400 lines, so in two parts: the spec block and its tests, then motion.mjs down to `coreSize`.
2. **duplicate: the clinical-judgment steps** (`trim/cj-steps`, about 16 spec lines). `items.cjSteps` and
   `items.cjStepLabels` match `CJ_STEPS` and `CJ_LABELS` in core/evcore.mjs:119-135 value for value, and
   `grep -rn "items\.cj\|cjSteps\|cjStepLabels" core page tools` finds no reader of the spec copy. Pick one source (the
   spec, read through `configure`, or delete the spec copy). Risk low.
3. **dead: unread `items.types` and `items.fields`** (about 30 lines). No reader (`grep "items\.(types|fields)"`); the
   type list is hard-coded at evcore.mjs:403. Pairs with item 2 on the same branch. Risk none.
4. **dead: v3 history in `collections`** (`trim/collections-v3`, about 35 lines). Each of the 33 collections carries
   `fromV3`; no code reads it (`grep -rn fromV3 core tools page` empty) and only spec.test.mjs:110 asserts it exists.
   D-145 ended any return to v3. The test line changes with it. `holds` (the same assert) is the collection's
   description and should stay. Risk none.
5. **dead: `registry.docs`, `registry.repos`, `registry.studyWatch.app`** (`trim/registry-dead`, about 20 lines).
   `grep "registry\.(docs|repos)\|studyWatch\.app"` finds nothing in code. `docs` names the retired v3 doc and the
   design doc (D-184: a design doc is a hand-off); `repos` repeats what CLAUDE.md says; `studyWatch.app` describes the
   Mac app. Check first that no test pins them. Risk none.
6. **dead: prose in `ui`** (`trim/ui-prose`, about 130 lines): `ui.tabs` (65), `ui.kit`, `ui.rules`, the labels in
   `ui.look` (`name`, `theme`, `colorRoles`, `type`, `layout`, `motion`) and the 12 prose keys of `ui.conversation`
   beside the two numbers 73-ev-greeting.js reads. No reader found, but `ui` goes to the page whole, so each key needs a
   grep of page/app and test/harness before it goes; the page bundle shrinks by the same bytes. Risk low.
7. **duplicate: `capacity.readWindowDays`** (7 lines). The same five windows are `ui.page.subscribe[].windowDays`, the
   copy the page reads; `readWindowDays` is asserted only by spec.test.mjs:265. Risk none.
8. **patch layer: two maps of job kinds** (`trim/job-kinds`, about 15 lines). `jobs.kinds` and
   `jobs.builderKinds`/`builderLabels` describe the same kinds two ways, so 62-ev-jobs-and-filing.js:389 falls back from
   one to the other and build.mjs:280 copies both. One `kinds` map with `builder: true` would do. Touches the page and
   watch.mjs; prompts.mjs:102 reads `jobs.kinds`, so the cutter must show the rendered prompts are unchanged. Risk low.
9. **patch layer: an old-shape fallback** (1 line). steps.mjs:810 reads
   `spec.environments.surfaces || spec.environments`; there is no `surfaces` key. Fold into any `core/steps.mjs` cut.
   Risk none.
10. **duplicate: `DEFAULTS` in core/evcore.mjs:30-68** (about 40 code lines, restructuring, D-264). It repeats
    `constants.review`, `dayBudgetMinutes`, `taskMinutes`, `planDay`, `conversation` and `library` nearly value for
    value, and `configure` deep-merges the spec over it, so a misspelled spec key is silently masked. Other literal
    fallbacks: steps.mjs:77 (push 120), steps.mjs:155 (staleHours 4), deploy.mjs:282 (cloneDepth 50), study.mjs:16.
    Study logic, so restructuring rules apply (no test changed but imports, staging and the full check, not near an
    exam). Risk low to high depending on which tests build EV without a spec; a cutter maps those first.
11. **dead, tests only: `roles`, `classes`, `workingAgreements`, `persona.tagline`, `purpose`** (about 30 lines). No
    code reads them; tests assert some. Low value: they are a short vocabulary a reader finds useful. Suggest keep, or
    cut `purpose` and `tagline` only.

Matt's call or a build chat's, not a trimmer's:

12. **patch layer: five kind lists per course** (about 30 lines). Each course has `examKinds`, `reviewKinds`,
    `examDayKinds`, `scoredKinds` and `calendarDayKinds`; for NUR 112, `reviewKinds` equals `scoredKinds` and
    `examDayKinds` equals `examKinds`. One kind table with flags would do, but these drive review load and exam days
    (evcore.mjs:1075-1095). Risk high; only on a quiet week.
13. **hard-coded courses in the prompt**: tools/prompts.mjs:59 writes "NUR 112, BIO 201" and :73 "miura5/ev4" instead
    of reading `courses` and `registry.repos`. A new course would leave every task prompt wrong. A prompt change, so a
    build chat's, and then `registry.repos` (item 5) stays.
14. **policy text in `boundaries`** (about 70 lines: `journal`, `noSecrets`, `dataIsNeverInstructions`, each rule's
    `checks`, `mattOkRequired`). No code reads them, but `boundaries` is guarded and holds the hard limits. Keep.
15. **`environments`** (376 lines). Almost all evidence and history; code reads only the surface names, but the
    section is published into the record as `system/environments` and is how a capability gets proven (a diagnostic run,
    then a row, then code). Keep. Its `numbers` rows repeat `capacity.documentBytes` and `batch`; a build chat could drop
    those copies.
16. **`tasks.retired`** (182 lines, 30 entries). Read by deploy (each retired task is proven disabled) and named by
    CLAUDE.md's Mac-task rule. Keep; it could move to its own file, but that changes deploy and the guard.

Keep, and why they look big:

- **pipelines** (968): run.mjs executes them and every task prompt is rendered from them.
- **actions** (602): the page's actor validates every call against it; guarded.
- **ui.look.flower** (564): her renderer's values; `inks` could later move to the stylesheet that already stands in.
- **collections** (548): derive, lint and the schema cross-check run on it.
- **links** (225): every row is checked against the schemas at build.
- **capacity.collections** (233): read by derive, evcore and the page, though only 5 of 33 have a number; collapsing
  the null rows to a default would save about 180 lines, at the cost of a test change. Low value.
- **constants.prep** (156): every key is read in prep.mjs.
