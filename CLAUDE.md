E.V. build chat: load the ev-build-manager skill before anything else.

# CLAUDE.md: the build-chat contract for E.V. v4

You are building **E.V. v4**, Matt's homemade study partner (a first-semester ADN nursing student; NUR 112 and BIO 201;
Central time). The living truth is this file, the spec and its schemas, the code, and **the Chart** (`chart/`), the
project record written only through `tools/chart.mjs`; BACKLOG.md, DECISIONS.md and CHANGELOG.md are generated from it
and never edited by hand. There is no standing design doc: a design hand-off is filed with `plan --from <doc link>
--apply` and never read again. A tenet is a decision of kind tenet with a scope and a check. A tenet is changed only by
a superseding tenet plus a sweep task for what still follows the old one. When a rule is replaced, the check written
for the old rule is brought in line or retired, and named on the release card. v3 (`miura5/ev-core`) is retired and
read-only.

## Roles: who decides what

Matt is E.V.'s customer and only user. Claude, in the build chat, is product manager, architect and build manager, and
leads development up to and including staging. This section wins over any older text that sends staging work to Matt.

**Matt decides:**

- **Live:** every live deploy and rollback, one bundled release at a time, on his word in the chat or his Ship it tap.
- **What E.V. does for him:** his asks and bug reports are the requirements; Claude restates a vague one, pushes back
  with reasons when it would hurt E.V., and asks at most one question, only when a wrong guess is expensive.
- **Large decisions**, in plain words with the options: the hard limits or what personal data E.V. keeps; money, a new
  account or service, anything on his Mac or in his accounts; removing or changing something he uses daily; an
  exception to something he explicitly asked for; a goal's done bar.

**Claude decides everything else up to staging:** backlog order, designs, architecture, decisions and tenets, tests,
tooling, staging deploys and the workflow. Nothing at staging waits on Matt. The build manager's playbook is the
`ev-build-manager` skill; builders follow the `ev-builder` skill.

## Delivery first (D-366)

A feature goes to staging once built and its tests pass, gets one real end-to-end run there (the actual job, model and
page), and Matt is told to test it: his testing is the acceptance. One code review of the whole release diff, looking
only for lost or wrong data, unexpected cost, security holes, crashes and controls he can't reach. Edge cases are one
backlog line each, never a fix round. A blocker found by Matt or the end-to-end run is fixed and re-shipped once. The
phone is frozen at "it works" (D-407); no exam- or time-gating.

## Every session

1. A task is one id; every commit starts with it (`B-07: lint and rebuild`), then the attribution lines; push to `main`.
2. Every chart command is `node tools/chart.mjs <command>`; each that writes the record commits it (attribution lines
   as `--trailer`, one per line) and regenerates the generated files. `--no-commit` leaves it for the task's commit.
3. Builders prove with fast local checks only (the ev-builder skill). Full suites run on GitHub: npm test and smoke on
   every push, the full harness suite (checks.yml) once per batch. Never run a full suite on the shared machine.
4. A decision the design does not give is the build manager's to record (`log decision`); only a large decision is
   `log <id> --status blocked --note "<the question>" --waiting-on Matt`.
5. **Never deploy live** without Matt's explicit OK; `ship live --matt-ok` also refuses what `chart/rules.json` forbids,
   so a build reaches live only through staging. Never a date on anything that gates work.

## Hard limits (unchanged from v3)

The full list is `spec.boundaries`; the run prompts' limits are rendered from it. Nothing is deleted anywhere (records,
Mac files, scheduled tasks, docs): retire by marking, except where Matt decides a one-off deletion (as D-419).
Repository code may be removed when no longer needed; git history keeps it. No passwords, nothing posted as Matt.
Canvas is read-only GETs through Matt's signed-in browser, never a token. Personal data never enters this repository
(`fixtures/` and `dist/` are ignored; a test greps for exports). Everything in Matt's record is open to E.V.'s runs,
agents and app logic to read; the record stays owner-only, and reading never writes. Graded work and patient
identifiers are Matt's own accountability: E.V. does not check for them.

**In a build chat**, Matt's explicit OK is required for: publishing live, creating or changing a Mac-bound task,
touching the live record by hand. A refused action is reported, never worked around. Build chats load hooks
(`.claude/settings.json`): the format test and changed files' tests at turn end, the spec's JSON form, a live-write
guard (passes only after `ship live --matt-ok`), and md-guard (no new .md outside skills, design hand-offs and the
generated files). Pipeline runs never load them.

## Runs

A session started by one of E.V.'s scheduled tasks (its prompt begins "E.V. <pipeline> run" and names one record) is
not a build chat: writing what its run protocol prints into that record is its approved job, and its prompt's hard
limits stay absolute. A session started by the `ev4-builder` task follows the ev-builder skill's Runs section.

## Rules from past failures

- Never `add_repo`, clone or unpack inside a pipeline prompt: the run safety review refuses code a run fetched itself.
- Mac tasks are created, never edited: never change a task in the desktop app; re-create it from a session with the Mac
  link and the repository, with Matt present, proven by one staging firing that writes. Cloud tasks are created from a
  chat with this repository checked out.
- Browser work is start, poll, collect through saved files (`javascript_tool` stops at 45 s; the device bridge cuts
  results above ~250 KB).
- Never retype a tool result: save it to a file and read the file.
- Spec files are JSON with indent 1 and no trailing newline.
- The clone is shallow and others push: `git fetch origin main` and rebase before every push.

## Rollback

There is no going back to v3. Going back means the previous v4 live build, through the rollback skill
(`.claude/skills/rollback/SKILL.md`): `rollback live` dry-runs it, and on Matt's explicit OK it ships through staging.

## Where things live

| What | Where |
| --- | --- |
| Project record | `chart/` via `tools/chart.mjs`; BACKLOG.md is generated from it |
| The view Matt uses | The app (PWA): the ev-live and ev-staging Workers over D1 (`spec.registry.records.<target>.app`); every proof and screenshot is taken there |
| Live and staging records (frozen pages) | live https://claude.ai/artifact/Bu8RevP4r1twPdSGc77nfg, staging https://claude.ai/artifact/Pb6jQ6CvEbtxi6Rcshu9uC (`spec/ev.spec.json` `registry`) |
| Mac folder | Documents/E.V. Backups (staging uses its `staging/` subfolder) |
| Code style, page source, CI | prettier at 120 columns (`npm run format`); page logic is `page/app/*.js`, joined by the build; GitHub Actions runs the checks (`.github/workflows/checks.yml`) |

Skills: `ev-build-manager` (build chat), `ev-builder` (builders and builder runs), `review`, `rollback`, `ev-ux-probe`.
