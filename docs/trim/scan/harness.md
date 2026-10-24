# Scan: the page harnesses (D-264)

Written by an overnight trimmer scan run on Oct 24, 2026, at origin/main a9b9c40, for `docs/trim-brief.md`, "Scan
runs". It changes no code. The area is `test/harness/` (15 files, 11,772 lines), and how `tools/check.mjs` runs them
and how long each one takes. Two read-only helpers split `run.cjs` between them (lines 1 to 2762 with `captions.cjs`;
lines 2763 to 5303 with the rest), and their key claims were re-checked by grep before they were written here.

**How check time was measured.** It comes from the newest nightly run, 39963980973 (Oct 23 13:46Z, green at d003e2e),
read from its job log. `check.mjs` prints `== <step>: ok (<n> s)` after each step.

## Map

### How they run

- `npm run check` (`tools/check.mjs`) runs npm test, then the build, then seven harnesses one after another:
  shell, run, captions, prep, core, greet and look (`HARNESSES`, check.mjs:27). It stops at the first one that fails.
  Each harness takes a record folder or `synthetic`, and a screenshots folder.
- `--touched` runs only the harnesses whose paths changed since the last staging deploy (`harnessesFor`, check.mjs:76).
  A path it doesn't know runs all of them.
- `smoke.cjs` is not one of check's steps. It runs only through `npm run smoke` and `.github/workflows/smoke.yml`
  (B-199), and it is a subset of run.cjs by design.
- `nightly.yml` runs the full check once a night (B-151). Before the check starts, `npx playwright install --with-deps
  chromium` takes 8 minutes (13:46:31Z to 13:54:33Z).

### The harnesses

| File | Lines | Checks in the last nightly | Time (s) | Fixed sleeps | What it proves | Depends on |
| --- | --- | --- | --- | --- | --- | --- |
| shell.cjs | 627 | 77 | 95 | 25 | The built shell at phone and desktop: boot, tabs, staging stamp, sidebar and pane, right panel, Preferences, folds (B-15, B-223, B-224, B-228) | panel, png |
| run.cjs | 5,303 | 398 PASS lines (320 `ok(` calls) | 196 | 251 | Most of the page's behavior, tab by tab (B-16's port of v3's 151 checks, and every task since) | paint, synthetic.cjs |
| captions.cjs | 2,297 | 167 | **314** | 85 | Her lines, surfaces, folds, skills run, breakpoints, reduced motion, jank (B-77, B-78, B-112, B-114) | paint, quarantine, tenets |
| prep.cjs | 615 | 66 | 70 | 23 | The night-before pack check, the morning bag check, Today and greeting sync (B-104) | none extra |
| core.cjs | 395 | 69 | 131 | 11 | Her 2D flower: moods, gestures, frame budget. It runs alone because it times frames | quarantine |
| greet.cjs | 371 | 72 | 102 | 2 | The model-written greeting, its fallback, the reopen (B-129, D-167) | none extra |
| look.cjs | 1,078 | 498 | 263 | 37 | Every view at Matt's sizes, with screenshots, tenets, contrast and layout (B-101, B-113) | views, tenets, png, contrast |
| smoke.cjs | 414 | n/a (not in check) | about 10 | 2 | The two-minute subset (B-199). It has the only polling `until()` helper | paint |
| paint, panel, png, quarantine, tenets, views, contrast | 672 | n/a | n/a | 0 | Shared helpers. Every one has a requirer (grep `require('./<name>`); `panel` is used only by shell.cjs:7 and test/panel.test.mjs | |

**Total check time:** 20 min 45 s. That is npm test (74 s) plus 1,171 s of harnesses. The nightly job takes 29
minutes in all, with the 8-minute browser install.

**Fixed sleeps:** 436 `waitForTimeout` calls in all, about 250 s written out as literal waits. A wait inside a loop over
sizes or schemes runs more than once.

### run.cjs, by section

| Lines | Section |
| --- | --- |
| 1-19 | Header, requires, release, argv (`[record dir \| synthetic] [shots dir]`; no other modes) |
| 20-153 | `load()` and seed normalisation (weekly, the review set copied from a real export at 108-141, today's talk dropped) |
| 154-366 | Planted sets and data (practice, dosage, B-191 nav, B-193 source, library, calendar), `servePdfjs` |
| 368-526 | System, watchdog, jobs, lint, retro and builder seeds |
| 527-1125 | `workLineChecks` (B-227), `practiceNav` (B-191), `buildAskChecks` (B-180) |
| 1126-1180 | Page plumbing: spec, stub, skeleton, `openPage`, `send`, `msgs`, `ok` |
| 1181-1499 | The phone and desktop loop's shared checks; the desktop pass ends with `continue` at 1499 |
| 1500-2618 | (phone from here) Captions, chat and jobs, Claude errors, today's list |
| 2619-3053 | Uploads and library, Study (review, practice) |
| 3054-3579 | Plan and Progress, Record, System |
| 3580-4196 | Visitor and staging, sessions and skills (B-18), the B-212 panel, the shared page (B-54), workouts (B-52) |
| 4198-4863 | A study session on a fake clock |
| 4865-5293 | Your turn (B-182), Ask me (B-163), the job-finished notice (B-215) |
| 5294-5303 | Report and exit (its own pass and fail count, not `quarantine.cjs` as captions and core use) |

### captions.cjs, by section

| Lines | Section |
| --- | --- |
| 1-46 | Header, `load()`, seed |
| 47-264 | The planted day, `openPage`, `ok` and helpers (view, send, atNow, pull, word timing) |
| 265-411 | The artboard renderer and its numbers |
| 412-1225 | The phone and desktop pass: greeting, reveal, Back to now, pull, surfaces, review fold, chips, layout, Try again |
| 1226-1502 | Skills run (B-82), File it fallback |
| 1503-1847 | Check fold (B-122), open answers (B-75) |
| 1848-2065 | Short heights (B-112), breakpoints (B-114), reduced motion |
| 2066-2297 | Surfaces at 390, 735 and 1280 (B-78), jank at 1150 (B-248, B-249), results |

## Findings

Ranked by value for the long term: what makes the next change smaller and safer. All of it is test code. None of
it is in the deployed build (`tools/build.mjs` HASHED covers `core/`, `scripts/`, `page/` and `spec/`), so nothing
here changes what Matt sees. A cut here is proven by the full check, since the harnesses are the check.

### 1. duplicate: the same setup is copied into eight harnesses (`trim/harness-common`)

- **What is copied:** `load()` is word for word the same in run, shell, look, captions, prep, core, greet and smoke
  (run.cjs:20-30 and shell.cjs:26-36 differ by nothing). So are `ORIGIN`, `TYPES`, `skeleton`, `stub`,
  `results` and `ok` (7 matching top-level definitions in each of those 8 files), and `reEsc` and `RELEASE`
  (run.cjs:14,16, shell.cjs:13,15, look.cjs:14,16).
- **Close variants:** `openPage` exists in 5 harnesses (run:1137, captions:133, core:53, greet:143, prep:120), and
  `send` in 2 (run:1161, captions:199). Inside run.cjs, the Google Fonts route is written out 12 times (3593 to 5159)
  and the pageerror listener 11 times, where `openPage` could do both. The "no sideways scroll" and "no page errors"
  checks are written separately in every harness.
- **The cut:** one shared module beside `paint.cjs` and `views.cjs` that these files require. It changes no check.
  - Size: about 20 to 60 lines out of each of 8 files, so a few hundred lines net.
  - Risk to studying: none.
  - It is restructuring under D-264, not new machinery: it moves code that exists into one place.
  - It goes first because every later harness change gets smaller.
- **What must stay:** the seeds stay in each harness, because each plants its own day.

### 2. patch layer: fixed sleeps instead of waits (`trim/harness-waits`)

- **The count:** 436 `waitForTimeout` calls, about 250 s written out (counts above). captions.cjs is the slowest step
  at 314 s.
  - It sends a message and then waits a fixed 4,500 ms, written out inline 5 times (:824, :1355, :2110, :2151,
    :2235), with one-offs of 9,000 (:451), 7,500 (:577) and 4,000 (:1019) ms. It already has a `send()` helper (:199)
    with no wait.
  - Seven `waitForFunction(...).catch(() => {})` calls are followed by a fixed sleep anyway (for example :1975-1987,
    then 1,200 ms). run.cjs has 6 swallowed catches.
  - run.cjs sleeps a fixed 1.5 to 3.5 s after `openPage` 10 times (3646, 3888, 4038, 4766, 4882, 4926, 5033, 5083,
    5162, 5227), where a ready wait would do.
- **Who already polls:** smoke.cjs has the only polling helper (`until()`, smoke.cjs:77, used 10 times). None of the
  other harnesses has one.
- **The cut:** one wait-until helper, in the shared module from finding 1, in place of the stacked sleeps. Take it
  harness by harness, captions first.
  - Size: lines roughly even, but check minutes down. It should be measured on the nightly, since the 250 s of
    literal sleeps is an upper bound.
  - Risk to studying: none.
  - Risk to the check: low. A wait that is too tight makes a flake, so each part needs two green full checks.

### 3. split: run.cjs does twelve jobs in one 5,300-line file (`trim/harness-run-split`)

- **Why split it:** run.cjs is the biggest file in the repository. It is the one most page tasks edit. Its sections
  already follow the tabs (map above), and 527-1125 are already separate functions.
- **The cut:** split it into a seed module (about 520 lines) and one module per section. Keep one entry file, so
  `check.mjs` still runs `run`.
  - Do it in parts under the 400-line budget: the seed first, then the functions at 527-1125, then the tab sections.
  - If entry names change, `check.mjs`'s `HARNESSES` and `PARTS` follow.
  - Take it after finding 1, so the modules share one setup.
  - Size: lines move, they aren't removed.
  - Risk to studying: none.
  - Risk to the check: low. The PASS count (398) must match before and after.

### 4. duplicate: checks that prove the same thing twice (`trim/harness-repeats`)

These are worth taking one at a time, keeping the stricter copy of each:

| Same proof | Locations |
| --- | --- |
| Five tabs and System | run.cjs:1253 and shell.cjs:116 (both count `#top .tabs .tab` to 5 and check `#tab-system`) |
| Each tab opens its own panel | shell.cjs:141 and smoke.cjs:159 (smoke by design) |
| A reply with cards opens one surface, none under her line | run.cjs:1512 and captions.cjs:864. captions.cjs:2112 is a near copy of :864 |
| Her step with a surface open | run.cjs:1522 and captions.cjs:878 |
| Tapping her or the brand returns to now | run.cjs:1836 and captions.cjs:673 |
| Exactly three greeting chips | run.cjs:1355 (at most) with run.cjs:1360 (at least), and captions.cjs:434 |
| Idea kinds and Make it a weak spot | run.cjs:1413 (desktop), run.cjs:3305-3317 and look.cjs:1041 |
| An idea's menu waits until its row opens (B-111) | run.cjs:3323 and look.cjs:1026 |
| Plan is a tab, hidden until chosen (D-249) | run.cjs:3055 and look.cjs:353 |
| Mark solid | run.cjs:3241-3248 and look.cjs:893 (partial) |
| Skills run (B-82): no card under her line, End in the bar, the list toggle, End brings the summary back | captions.cjs:1357/1367/1393/1417 and run.cjs:3734-3927/3791/3781/3804 |

- **Kept by design:** smoke.cjs repeats run.cjs on purpose (B-199), for example the paint check at smoke.cjs:330 and
  run.cjs:3047, and the Your-turn reply at smoke.cjs:376 and run.cjs:4991. Those stay.
- **Size:** about 100 to 150 lines across files.
- **Risk to studying:** none.
- **What the cutter must check:** for each pair, that the copy that stays covers both schemes and sizes the dropped
  one did.

### 5. dead: code nothing reaches, and checks that can't fail (`trim/harness-dead`)

All of these are in run.cjs.

- **Unused definitions:** `todayDoc` (:1158) is never called. `liveWorker` (:1156) is never read. Each name appears
  once in the file.
- **Arms that never run:** the four `scheme === 'phone' ? … : { width: 1280 … }` desktop arms at :3182, :3395,
  :3421 and :3463. The desktop pass leaves the loop with `continue` at :1499 (inside `if (scheme === 'desktop')`,
  :1404), so from :1500 on the scheme is always `phone`.
- **Checks that can't fail:** run.cjs:1257-1258 assert that `.dock` and `header.top` are absent. Neither exists
  anywhere in the page (no hit in `page/index.src.html` or `page/app/*.js`; the header is `header.mh`).
  The `.dot-count` in the no-badges guard (:5268) names a class the page never had. These parts of the asserts can
  go; the five-tabs check around them stays.
- **Size:** about 15 lines.
- **Risk to studying:** none.

### 6. patch layer: stale comments and measures nothing asserts (`trim/harness-stale`, with finding 5)

- **Stale breakpoint text:** captions.cjs:5-6 and 1054-1055 still describe D-159's wrap at 1023 and 1024 px. The
  breakpoint test now checks the details panel from 1200 px (captions.cjs:1989, B-210).
- **Measured, never asserted:** the breakpoint section measures `iconTabs` and `statusLine` (in the 1917-1999
  section) but asserts only the side column and notes (:1990). Those two measures can go. Turning them into checks
  would be new checks, which belongs to a build chat.
- **Stale percentage:** run.cjs:4290 says her core is at "the session step (66%)" (D-122). The check under it tests
  70%, as D-213 amended.
- **Size:** about 10 lines.
- **Risk to studying:** none.

### 7. check time: `--touched` runs every harness for a helper change (`trim/touched-helpers`)

- **The gap:** `harnessesFor` maps only `views.cjs` and `contrast.cjs` to their harness (check.mjs:84). A change to
  `panel`, `paint`, `png`, `tenets` or `quarantine` falls through to all seven harnesses (check.mjs:87), about 20
  minutes, when only the 1 to 3 that require it need to run.
- **The cut:** a few entries in an existing map, not a new tool.
- **Size:** about 5 lines.
- **Risk to studying:** none.
- **Value:** low, because helper changes are rare.

### 8. check time: the nightly installs its browser every night (note for a build chat)

- **The cost:** the browser install takes 8 of the nightly's 29 minutes. Caching it would be a change to
  `.github/workflows/nightly.yml` that adds a step, so it is listed for a build chat, not as a trim.
- **Value:** low, since the repository is public and its Actions minutes are free.

### Keep: looks big but earns its place

- **look.cjs:** 498 checks and one screenshot per view per size. R-06's full check is built on it.
- **core.cjs running alone:** it measures frame times, so nothing may run beside it.
- **The review-set copy at run.cjs:108-141:** it is idle on the synthetic record but needed when the check runs with
  `--record` on a real export.
- **The "v3 already filed" session check (run.cjs:3622-3670):** it is still fed by `test/data/synthetic.cjs:58`.
- **smoke.cjs's overlap with run.cjs:** by design (B-199).
- **The seven small helpers:** each one has a requirer.
- **Retired features:** no check names a retired or superseded decision. Every D-id named in the harnesses is
  accepted (D-228 and D-229 are proposed), and every B-id is done or still open (B-27 in progress, B-70 and B-71
  blocked; run.cjs:3445 only reads their evidence line).
