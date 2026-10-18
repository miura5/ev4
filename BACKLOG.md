# E.V. v4 build backlog

The sequence every build session follows. Full definitions of done are in the Build plan tab of E.V. Foundation
v4; this file is the live status board. Status: `open` · `in progress` · `blocked` · `done`. A task opens when
every id in Depends is `done`. Edit only the Status and Notes columns; commit every change.

| Id | Task | Depends | Milestone | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| B-00 | Repository skeleton: layout, package.json, .gitignore, personal-data grep test, CLAUDE.md | — | M0 | done | Layout dirs, package.json (node:test + playwright), tools/personal-data.mjs + its test; npm test 8/8, red on a planted export in the tree |
| B-01 | Spec v4 skeleton: collection map (class, writer, key, schema file), tasks, environments seeded from Oct 17, capacity, boundaries and working agreements ported from ev-core | B-00 | M0 | done | spec/ev.spec.json 4.0.0 + test/spec.test.mjs (15 checks). For the design chat: live evening-cloud pushes and evening-mac doesn't; restore-drill's monthly slot left to B-22; per-collection budgets null until B-14 |
| B-02 | Schema registry: a JSON Schema per collection, validate.mjs, fixture validation | B-01 | M0 | done | 28 schemas in spec/schemas, core/validate.mjs (2020-12 subset, refuses unsupported keywords), synthetic record in test/data/record; planted invalid writes refused by field. For the design chat: where Matt's exam score lives (v3's page wrote exams.score onto a Fact it didn't create) |
| B-03 | Build and manifest: tools/build.mjs writes dist/manifest.json; dirty detection | B-01 | M0 | done | tools/build.mjs: dist/manifest.json + system/{manifest,spec,environments}; fails on a spec/schema disagreement or a core VERSION mismatch; promptSha256 null until prompts.mjs (B-09), page files and capabilities empty until B-15 |
| B-04 | deploy printer and verify-deploy | B-03 | M0 gate | done | core/deploy.mjs + core/cli.mjs: verify-deploy prints the reads to save and diffs them (red with nothing deployed); planted wrong prompt hash and stale page stamp both reported; deploy refuses dirty, unpushed, no record, live without --matt-ok. Staging stays red until B-12 creates the record |
| B-05 | Core port from ev-core with every test; derived not stored; dayView over dayedits; liveDates over dateedits; answers in their own document | B-02 | M1 | done | All 40 v3 core tests ported + 6 for the split documents (46 green); core writes validate against the schemas. For the design chat: Canvas re-dates update dates Facts in place (v3 rule kept) and a hand-entered date with a canvasId gets canvas-sync writes; page sessions update status/pending in place |
| B-06 | migrate v3 and verify-migration (zero mismatches on a v3 export; idempotent) | B-05 | M1 gate | in progress | Oct 18. v3 export taken read-only from the live record with Matt's OK (journal not read) into fixtures/v3-export, this session's workspace only |
| B-07 | lint and rebuild | B-05 | M1 | open | |
| B-08 | Run protocol in the CLI: run <pipeline> start, pull, compute, apply, end, --audit | B-05 | M2 | open | |
| B-09 | Pipelines morning, evening-cloud, weekly as step lists; prompts.mjs v4 | B-08 | M2 | open | |
| B-10 | worker with jobs and jobresults | B-08 | M2 | open | |
| B-11 | watchdog and health/current | B-08 | M2 | open | |
| B-12 | seed-staging and system/seed; the v4 staging artifact (record + placeholder page) | B-06 | M2 | open | Creating the staging artifact is allowed unattended; it is not the live record |
| B-13 | Create the cloud staging tasks from a chat with this repository; fire each | B-09, B-10, B-11, B-12 | M2 gate | open | |
| B-14 | Diagnostics: document size, batch and page-tool ceilings; environments rows with run ids | B-13 | M2 | open | |
| B-15 | Page shell and published files; publish flow in deploy | B-05 | M3 | open | |
| B-16 | Conversation parity: tools, cards, memory, sessions, list and calendar edits, library, attachments | B-15 | M3 | open | |
| B-17 | Tab parity and the System health panel | B-15 | M3 | open | |
| B-18 | New features: skills practice mode, readiness audit, grounded explanations, session filing from the page (reader stubbed) | B-16 | M3 | open | |
| B-19 | Staging page published; soak; Matt's phone and desktop check | B-16, B-17, B-18 | M3 gate | open | Needs Matt |
| B-20 | Reader v2: list_sessions, read_session; Matt rebuilds the extension | B-00 | M4 | done | Reader 0.2.0 installed by Matt; from this build chat status, list_sessions (1 session) and read_session answered from the desktop app with findings only |
| B-21 | evening-mac: Canvas scripts as files, backup and mirror, the staging/ folder; Mac-bound staging task from a Mac-linked chat | B-09, B-20 | M4 | open | Needs Matt for the task |
| B-22 | restore-drill task | B-12, B-21 | M4 gate | open | Needs Matt |
| B-23 | Parity: v3 and v4 cores on the same seed nightly; a week of identical output | B-13, B-21 | M5 gate | open | |
| B-24 | Cutover: migrate live, live tasks, live page, v3 tasks disabled and kept, ev-core archived | B-23 | M6 gate | open | Matt's explicit OK |
