# E.V. 5 carry-over ledger

What v5 takes from ev4. One row per item; the designer adds rows with each revision. Kinds: carry (as is), edit
(ported, changed), new, drop. Source is a finding id, a decision, or an ev4 path.

| Item | Kind | Source | Why | Rev |
| --- | --- | --- | --- | --- |
| The record: one write path, generated backlog, decisions, changelog | carry | ev4 tools/chart.mjs | it kept the history trustworthy | r1 |
| D1 data, backups, nightly export, same Worker host | carry | ev4 pwa/, core/d1backup.mjs | Matt's data must continue unbroken | r1 |
| Hard limits and Matt-decides-live | carry | ev4 CLAUDE.md; D-425 for deletes | unchanged product rules | r1 |
| Colour tokens, dark and light | edit | page/theme.js | values kept; names trimmed for kit.css | r1 |
| Proprietary components | edit | page/ds/components | rebuilt in kit/, one folder each with story and test | r1 |
| Study kit: ladder meter, row, flip card, mode card, typed answer, tags, row menu | edit | skills-practice-proto ds/study.css | components only; its theme dropped | r1 |
| One commands registry shared by Matt, E.V. and the schedule | new | iteration 3 Layers | E.V.'s tools and buttons drifted apart | r1 |
| One job runtime and Activity | new | iteration 3 Layers, B-688 | jobs had three runtimes and no single home | r1 |
| Carousel, stat boxes, Study kit theme | drop | iteration 2 review | added noise; lists and plain numbers instead | r1 |
| Numbered global-scope page scripts | drop | page/app/00–91 | replaced by areas/ modules | r1 |
