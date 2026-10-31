# Ship staging and ship live

`ship` is a checklist: it checks the rules (`chart/rules.json`), prints the reads and calls to make, and verifies.
Make every call and read it prints, exactly as printed, then run it again, until it says GREEN. It records the
deploy, which CHANGELOG.md then carries. Never retype a result: save reads to the files it names.

## Staging

1. Main is pushed and its GitHub npm test and smoke are green; the batch's full suite on GitHub
   (`gh workflow run nightly.yml`) has passed.
2. `node tools/chart.mjs ship staging` (add `--done <id> --commit <sha>` when staging is the task's last proof).
3. Make the ArtifactData reads it prints (the staging record's system documents, with their versions) and save them
   where it says; make each write it prints with the version it names.
4. Dispatch the app: `gh workflow run pwa-staging.yml -f commit=<the build commit it prints>`.
5. When the run finishes: `node tools/pwa-app.mjs readback staging --out <the file it names> --wait 15`.
6. `node tools/chart.mjs ship staging` again; repeat 3 to 6 for whatever it still prints, until GREEN.
7. `node core/cli.mjs verify-deploy staging` agrees.

A third staging deploy in one release needs a line to Matt first (D-366).

## Live (only on Matt's word, R-04)

His "ship <sha>" in the chat, or his Ship it tap (a builder run's `ship live --from-job <id>`, D-198).

1. `node tools/chart.mjs ship live --matt-ok`. It refuses what `chart/rules.json` forbids: R-02 (staging GREEN at the
   same commit), R-03 (no running study session), R-04 (Matt's OK).
2. R-03: make the running-sessions read it prints (the live Worker's D1 sessions) and save it where it says.
3. If it tags a new release and asks staging to carry it, ship staging once at that commit, then ship live again.
4. Make the live record calls it prints (the live-guard hook passes them only while `dist/live-ok` is fresh).
5. `gh workflow run pwa-live.yml -f commit=<the 40-character commit it prints>`. The run waits at the GitHub `live`
   environment for Matt's Approve; tell him in one line.
6. After it finishes: `node tools/pwa-app.mjs readback live --out <the file it names>`, then `ship live --matt-ok`
   again until GREEN (it records the deploy; tags.yml pushes the tag).

Rollback is the rollback skill (`.claude/skills/rollback/SKILL.md`), on Matt's explicit OK only.
