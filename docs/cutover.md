# The PWA cutover (B-319, B-320): the runbook

E.V.'s home moves from the claude.ai live page to the app on the ev-live Worker, and D1 becomes her only live record
(D-297, D-306, D-307). This page lists every call in order: who makes it, and the read-back that proves it. The build
manager (the managing chat) runs every command. Matt does only what is marked **Matt**: his OK in the chat, his
approvals in GitHub, two settings in his accounts, and the folder approvals on his Mac.

It rests on D-320 (the token's home), D-330 (the live Worker and its secrets) and D-331 (the safeguards and switches).
Nothing in it deletes anything. The repository is public, so no token, key or document is ever printed, pasted into
the chat or committed.

## What the sitting changes for Matt

- Before step 7, nothing he uses changes. The ev-live Worker exists but nothing points at it.
- From step 7: the claude.ai live page shows "This page is read-only now: E.V. lives in the app." and saves nothing.
  He uses the app on his Mac and iPhone. The scheduled runs write the app's record, and the nightly backup goes to
  Documents/E.V. Backups.

## Before the sitting (build manager; no Matt)

1. B-320's preparation is on main (this page, pwa-live.yml, the guard, the read-only flag, D-307's lint), and
   `npm test` is green.
2. Staging is GREEN at main's build commit (`node tools/chart.mjs ship staging`), and no other release is waiting for
   his word.
3. Pick the window. The copy (step 6) and the switch (step 7) go back to back with no live run between them, so a
   run's write can't land in the old record after the export. The live runs are watchdog at :55 every 3 hours from
   22:55, morning at 4:25, evening-cloud at 20:15 and evening-mac at 20:20 (Central; `brief` lists the next 24
   hours). For example, start step 6 at 10:56 and finish step 7 before 13:55. Matt doesn't use the claude.ai page
   during the window.

## 0. Probe the dispatch guard (build manager)

The live-guard hook now also reads Bash (D-331). Hooks load when a session starts, so this runs in the managing
chat, not in a subagent:

    echo "probe: gh workflow run pwa-live.yml -f commit=0000000"

- **Proof:** the hook refuses it ("Refused: a dispatch of the live app's workflow ..."), and nothing is dispatched.
  Mark the row in `spec.environments["build-chat"].unproven` proven, with this session's id, and move it to
  `proven`.
- If it is not refused, go on anyway: GitHub's live environment still waits for Matt's approval. Say so on the card.

## 1. GitHub: the live environment's secrets (Matt, about 5 minutes)

**Matt**, in Terminal on his Mac (gh signed in as himself), from any folder:

    gh secret set LIVE_CLOUDFLARE_API_TOKEN --env live --repo miura5/ev4
    gh secret set LIVE_CLOUDFLARE_ACCOUNT_ID --env live --repo miura5/ev4

- Each one asks for its value and doesn't show it. The account ID is the same one staging uses (Cloudflare dashboard,
  right column of Workers & Pages).
- The API token can be the staging one, or a new one from Cloudflare (My Profile, API Tokens, Create Token). A new
  one needs the "Edit Cloudflare Workers" template plus Account D1 Edit and Workers R2 Storage Edit.

Then the app's token, made on his Mac so it's never in a chat:

    openssl rand -hex 32 > ~/Documents/ev-live-token.txt
    gh secret set EV_LIVE_TOKEN --env live --repo miura5/ev4 < ~/Documents/ev-live-token.txt

- He keeps the file until step 5, then puts the token in his password manager (he types it once into the app on
  each device, D-301) and moves the file to the Trash himself.
- In GitHub (Settings, Environments, live) he checks: Required reviewers is himself, and Deployment branches is
  "Selected branches: main".

**Proof:** `gh secret list --env live --repo miura5/ev4` on his Mac lists the three names and no values. The
workflow's first step checks them again.

## 2. The ev-live Worker's release (build manager)

1. Turn the live app on: in `spec/ev.spec.json`, set `registry.records.live.app.ready` to `true`. Commit it as
   "B-320: the live app on (ev-live in ship live)", with the session's trailers, and push.
2. `node tools/chart.mjs ship staging`. Make every call and read it prints until GREEN. The staging app is unchanged;
   this records the commit.
3. `node tools/chart.mjs ship live --matt-ok` once, **only after Matt's OK** (step 3). This tags the release and stops:
   "tagged v4.x.y ... ship staging, then ship live again". Then `ship staging` again until GREEN.
4. The full check at the tag (R-06; the workflow's gate reads a nightly run, ship live reads either):

       gh workflow run nightly.yml --ref v4.x.y

   Wait for it green, about 30 minutes: `gh run list --workflow nightly.yml --limit 1`.

## 3. Matt's OK for the first live release (Matt: one line in the chat)

The build manager writes one release card: what changes for him (nothing visible; the Worker is made), the commit,
staging GREEN, the nightly green.

**Matt:** "OK, ship <commit> live."

## 4. Ship live with the Worker (build manager, then Matt in GitHub)

    node tools/chart.mjs ship live --matt-ok

- It reads first (the running-session read, R-03), then writes dist/live-ok for this commit and prints the calls:
  the system documents, the claude.ai live page (unchanged, still writable) and the app's dispatch:

      gh workflow run pwa-live.yml --repo miura5/ev4 --ref main -f commit=<the commit>

- Make the calls in order. The hook lets the dispatch through only because dist/live-ok names that commit.
- **Matt:** in GitHub, Actions, pwa-live, the newest run, "Review deployments", tick live, Approve. Its gate job has
  already passed by then: the commit is on main, the app is on, staging GREEN (R-02) and the nightly green (R-06).
- The run creates the ev-live D1 with the schema only (empty; never seeded), the ev-live-exports bucket, the ev-live
  Worker, its EV_TOKEN, and the ev-live-scratch Worker and D1. It checks 401 without the token, 401 with a wrong one
  and 200 with it, with no collections yet, and reads back the build hash.
- **Proof:** `ship live --matt-ok` again, with its reads (it waits for the run), says GREEN, including
  `app live workflow run`, `app live Worker build` and `app live files`. Then it records the deploy.

## 5. The Claude key and the live record's system/worker (Matt, then build manager)

**Matt**, Cloudflare dashboard: Workers & Pages, ev-live, Settings, Variables and Secrets, Add. Type Secret, name
`ANTHROPIC_API_KEY`, value his Claude API key (D-299: the $5 monthly cap in the Anthropic Console stays), then Deploy.

- **Proof:** the next pwa-live run shows "ANTHROPIC_API_KEY is set on ev-live", with no warning.

**Matt** connects ~/Documents to this chat for the token file. The build manager copies it into the session without
showing it, then:

    node tools/pwa-live.mjs worker-doc --token-file <the staged file> --out <scratchpad>/live/system/worker.json

- It prints the address and the token's length, never the token.
- Then, still under dist/live-ok from step 4 (2 hours; if it has expired, Matt's OK again and `deploy live --matt-ok`):

      ArtifactData {"action":"set","url":"https://claude.ai/artifact/Bu8RevP4r1twPdSGc77nfg","collection":"system","doc_id":"worker","file_path":"<scratchpad>/live/system/worker.json"}

- **Proof:** `ArtifactData get system/worker` with out_dir `<scratchpad>/rb`, then:

      node tools/pwa-live.mjs reach --worker <scratchpad>/rb/system/worker.json

  It prints the ev-live address and "0 collections (an empty D1)": the run API answered with the token from the
  record.

**Matt** then saves the token in his password manager and moves ~/Documents/ev-live-token.txt to the Trash.

## 6. The one-time copy (B-319; build manager, in the window)

Matt's OK in step 3 covers this commit: dist/live-ok names its build commit, which the copy accepts. If it has
expired, he says OK again, then run `node core/cli.mjs deploy live --matt-ok`.

    D=<scratchpad>/live-copy
    node tools/pwa-copy.mjs export-calls $D --record live      # make every ArtifactData call it prints
    node tools/pwa-copy.mjs export-done $D                     # until it says exported N documents
    node tools/pwa-copy.mjs import $D                          # into ev-live; refuses unless the D1 is empty
    node tools/pwa-copy.mjs verify $D                          # GREEN: counts and SHA-256 per collection

- The export stays in the scratchpad, never in the repository; `git status` shows nothing from it.
- **Proof:** verify GREEN, and `npm test` (the personal-data test) is green. Log B-319 done with the counts.
- If import stops part way, `import $D --resume`, then verify.

## 7. The cutover commit and its release (build manager; Matt's OK)

1. `node tools/pwa-live.mjs cutover --apply`. It prints and writes the cutover spec:
   - `registry.records.live.readOnly` true: the claude.ai live page refuses writes (D-306);
   - `registry.records.live.d1` true: D-307's lint is on for live (tools/d307.mjs, in npm test);
   - `registry.records.live.runs`: every live pipeline on the ev-live Worker, token from system/worker;
   - `tasks.live.evening-mac` re-pointed at Documents/E.V. Backups with no trigger, `tasks.live.restore-drill` added,
     and the old evening-mac listed in `tasks.retired`.
2. `npm test` green, including test/d307.test.mjs on the real spec now. Commit "B-320: the cutover (read-only page,
   live on D1)" and push.
3. `ship staging` until GREEN, the nightly at the new tag (as step 2), then the release card.
4. **Matt:** "OK, ship <commit> live."
5. `node tools/chart.mjs ship live --matt-ok`. Make every call it prints:
   - the system documents and the read-only claude.ai live page;
   - `update_trigger` for the five cloud tasks (morning, evening-cloud, weekly, worker, watchdog);
   - the pwa-live dispatch, which **Matt** approves in GitHub as in step 4;
   - two `create_trigger` calls for the Mac tasks, only from the chat linked to the Mac with Matt present (step 8).
6. **Proof:** `ship live` again says GREEN for the record, the page and the cloud tasks. The page proof is its files
   equal to the build, so its spec.json carries `readOnly: true`. Then open the claude.ai live page: the banner shows,
   the composer and New are gone, and a tick says "Couldn't save: This page is read-only now".

## 8. The two live Mac tasks (Matt at his Mac)

From the managing chat linked to his Mac, with **Matt** present:

1. Make the two `create_trigger` calls ship printed: live evening-mac and live restore-drill, each with the folder
   /Users/peachfritter/Documents/E.V. Backups only.
2. **Matt:** in the Claude desktop app, approve each new task's folder access (E.V. Backups). Until he does, a Mac
   task writes nothing.
3. Disable the old live evening-mac (its id is in `tasks.retired`) with `update_trigger` enabled false. It is kept,
   never deleted.
4. Record the two new ids as `spec.tasks.live.<key>.trigger`, commit "B-320: record the live Mac task ids", push,
   `ship staging`, then `ship live --matt-ok` on Matt's OK. That is the system/spec write only: the prompts are
   unchanged.
5. **Proof:** fire each once (fire_trigger). evening-mac writes runs/evening-mac-<id> to the ev-live D1, and the
   nightly backup lands in E.V. Backups/backup/. The drill writes runs/restore-drill-<id> with counts and SHA-256
   matching. Read both back:

       node tools/pwa-live.mjs run --worker <scratchpad>/rb/system/worker.json --id <runs id>

## 9. The app on his devices (Matt)

- **Mac:** open https://ev-live.peppercheese1.workers.dev in Safari, type the token once, then File, Add to Dock.
- **iPhone:** open it in Safari, type the token once, then Share, Add to Home Screen.
- **Proof:** the app shows his record: today's items, his exams, his last session. It shows no made-up data.

## 10. B-320's last proofs (build manager)

- Each live pipeline's runs/<id> read back from the ev-live D1 after its next firing (or a fire_trigger now), with
  `node tools/pwa-live.mjs run --worker <saved system/worker> --id <id>`: morning, evening-cloud, evening-mac, weekly,
  worker, watchdog and the restore drill.
- `node core/cli.mjs verify-deploy live` is GREEN. Its "retired tasks disabled" line covers the old evening-mac.
- B-315's per-record ArtifactData target is gone for live: test/d307.test.mjs passes on the real spec, with
  `records.live.d1` true.
- Then `log B-320 --status done`, and rewrite docs/handover.md.

## Rollback

- **Before step 7** (only the Worker exists): nothing Matt uses has changed. Leave ev-live as it is (nothing is
  deleted). If needed, set `app.ready` false so ship live leaves the app out.
- **After step 7, before Matt writes in the app:** the rollback skill (`node tools/chart.mjs rollback live`, a dry
  run, then on his OK `--matt-ok --apply`, ship staging, ship live) restores the previous live build. The claude.ai
  page becomes writable again and the cloud tasks go back to the artifact (update_trigger). From the Mac chat with
  Matt: re-enable the old live evening-mac (update_trigger enabled true) and disable the two new Mac tasks. Nothing
  is deleted.
- **After Matt has written in the app:** a rollback leaves what he wrote in the ev-live D1. It is backed up nightly
  to R2 and his Mac, but it isn't in the claude.ai record: D-307 allows no sync, and no reverse copy exists. Going
  back then is a large decision for Matt, with that loss named, before anything is run.
- The ev-live Worker, its D1, the exports bucket and the scratch pair are never deleted. The live D1 keeps Time
  Travel and the nightly R2 export (D-302).

## Known limits at this commit

- The workflow's gate reads R-06 from a nightly run only. A full check run here (dist/check-full.json) satisfies ship
  live, but the workflow can't see it, so the nightly runs at the tag (step 2.4).
- R-03 (no study session running) is checked by ship live before it prints the dispatch, not by the workflow.
- A dispatch by run id or a re-run of an old pwa-live run (`gh run rerun`) is not recognised by the hook. GitHub's
  live environment approval still holds it.
