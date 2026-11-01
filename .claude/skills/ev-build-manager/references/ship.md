# Ship staging and ship live

`ship` is a checklist: it checks the rules (`chart/rules.json`), prints the reads and calls to make, and verifies.
Make every call and read it prints, exactly as printed, then run it again, until it says GREEN. It records the
deploy, which CHANGELOG.md then carries. Never retype a result: save reads to the files it names.

**Save ship's full output to a file** (`node tools/chart.mjs ship staging > <scratchpad>/ship.txt 2>&1`) and work from
that file: re-running ship after it has printed its calls asks for the reads again.

## Dispatching workflows

`gh workflow run` fails here (GraphQL is blocked); dispatch through the REST API:

- Full suite: `gh api -X POST repos/miura5/ev4/actions/workflows/checks.yml/dispatches -f ref=main -f
  "inputs[ref]=<sha>"`.
- Deploys: `gh api -X POST repos/miura5/ev4/actions/workflows/<pwa-staging|pwa-live>.yml/dispatches -f ref=main -f
  "inputs[commit]=<40-char sha>" -f "inputs[release]=<release>" [-f "inputs[release_at]=<sha>"]`, with the inputs ship
  prints.
- Find the run with `gh api repos/miura5/ev4/actions/runs?per_page=5` and watch it step by step (SKILL.md, Checks).

## Staging

1. Main is pushed, its GitHub npm test and smoke are green, and the batch's full suite (checks.yml, dispatched as
   above) has passed.
2. `node tools/chart.mjs ship staging` (add `--done <id> --commit <sha>` when staging is the task's last proof).
3. Make the ArtifactData reads it prints and save them where it says; make each write it prints with the version it
   names.
4. Dispatch pwa-staging.yml as above, with the commit and release inputs it prints.
5. When the run finishes: `node tools/pwa-app.mjs readback staging --out <the file it names> --wait 15`.
6. `node tools/chart.mjs ship staging` again; repeat 3 to 6 for whatever it still prints, until GREEN.
7. `node core/cli.mjs verify-deploy staging` agrees.

A third staging deploy in one release needs a line to Matt first.

## Live (only on Matt's word)

His "ship <sha>" in the chat, or his Ship it tap (a builder run's `ship live --from-job <id>`).

1. `node tools/chart.mjs ship live --matt-ok`. It refuses what `chart/rules.json` forbids: R-02 (staging GREEN at the
   same commit), R-03 (no running study session), R-04 (Matt's OK).
2. R-03, the running-sessions read: empty `dist/state/live/running` first, make the query it prints, then
   `node tools/tool-result.mjs ArtifactData dist/state/live/running.txt`.
3. Every ship live tags a new release, which then needs one ship staging at the same commit; then ship live again.
4. Make the live record calls it prints (the live-guard hook passes them only while `dist/live-ok` is fresh).
5. Dispatch pwa-live.yml as above. The deploy waits at the GitHub `live` environment for Matt's Approve; tell him in
   one line.
6. After it finishes: `node tools/pwa-app.mjs readback live --out <the file it names>`, then `ship live --matt-ok`
   again until GREEN (it records the deploy; tags.yml pushes the tag).

Rollback is the rollback skill (`.claude/skills/rollback/SKILL.md`), on Matt's explicit OK only.
