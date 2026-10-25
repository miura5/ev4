# E.V. v4

The engine of E.V., Matt's study partner, rebuilt from its v3 lessons. Start with CLAUDE.md, docs/handover.md and BACKLOG.md; there is no standing design doc (D-318). No personal data lives here.

## Layout

Anything that executes is under `core/`, `scripts/` or `page/` (build tools in `tools/`); anything that describes is under `spec/`; anything that proves is under `test/`. `studywatch/` holds the Mac reader extension and app. `fixtures/` and `dist/` are gitignored.

## Tests

`npm test` runs `node --test test/*.test.mjs`. `test/personal-data.test.mjs` scans everything git would commit for record exports, backups and Study Watch session files and fails if it finds one. A folder of made-up records for tests opts out of the folder-layout rule with a `SYNTHETIC.md` file at its root; its files are still checked by content.
