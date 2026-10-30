# Lane plan (B-507 to B-514)

Written Oct 29 at main 9fab416 by the lane planner. Read-only plan: nothing here is filed; the build manager records
the proposed decision and the three task edits at the end.

A scaffold commit this afternoon splits Proprietary into one file per component, pattern and view stylesheet. Then
C1 and C2 build the two component batches side by side, landing by Fri Oct 30. The pilot P follows, then Today, Study
and Notes+Record run in three lanes, then the E.V. window. Harness selectors move in a separate test lane T that owns
every harness file, so no view lane edits run.cjs.

## Phases

| Phase | Lanes at once | Starts when | Target | Staging ship (build manager) |
| --- | --- | --- | --- | --- |
| 0 Scaffold | S (one builder, about 45 min) | now | Thu Oct 29 afternoon | none (rides with phase 1) |
| 1 Components | C1 (B-507), C2 (B-508), beside the flashcards and bugs tracks | S on main | Fri Oct 30 | one, `--done B-507 B-508` |
| 2 Pilot | P (B-509), test lane T | phase 1 on staging GREEN | Sat Oct 31 | one, `--done B-509` |
| 3 Views | V1 (B-510), V2 (B-511), V3 (B-512, B-513), T | P on staging GREEN | Sun Nov 1 to Mon Nov 2, staging only (Matt's exam) | one, `--done B-510 B-511 B-512 B-513` |
| 4 E.V. window | E (B-514), T | V1 to V3 on staging GREEN | Tue Nov 3 | one, `--done B-514` |

Never more than four builders at once (D-385). T is the test agent (Roles), counted with the test and review agents
D-385 allows beside the builders. V2 starts only when the flashcards track has left 20-study.js, 21-study-plan.js and
22-flashcards.js.

## 1. File layout: one file per component

D-386's single page/app/01-ui.js and page/ds/components.css would put C1 and C2 in the same two files all day, and one
patterns.css and views.css would do the same to V1 to V3. The split keeps D-386's namespace (DS), the layer order
(D-373) and the budget (summed over the files); only the files multiply.

```
page/app/01-ui.js                  DS: the table of the 16 names and the shared root helper dsRoot(); no component code
page/app/01-ui-NN-<name>.js        one component each (dsButton ... dsMessage), declarations only
page/ds/components/NN-<name>.css   one block each; NN is B-504's list order (01-button ... 16-message)
page/ds/patterns/<name>.css        shell, week, runner, plan-card, thread, note-page, triage
page/ds/views/<view>.css           system, progress, today, study, notes, record, ev: layout only, tokens only
page/app/89-gallery-NN-<name>.js   staging only: galDs<Name>(), that component's state cells for the Gallery
```

**Load order.** The build joins page/app in name order into one closure, and `01-ui-NN` sorts before `01-ui.js`
(`-` sorts before `.`). So DS is not built by assignment from the component files. Each component is a hoisted
function declaration, and 01-ui.js builds `const DS = { button: typeof dsButton === 'function' ? dsButton : undefined,
... }`. Component files hold declarations only, with no load-time DOM work. B-228's test keeps every name unique.

### The scaffold commit (one builder, before the lanes)

Message: `B-507: scaffold Proprietary's lane files (lane plan)`. Contents:

1. **tools/build.mjs.** The components, patterns and views layers each read a folder (page/ds/components/*.css,
   page/ds/patterns/*.css, page/ds/views/*.css) in name order, each file under its `/* ---- path */` header. Gallery.css
   stays last in views and staging-only. STAGING_ONLY becomes a rule: page/ds/gallery.css and page/app/89-gallery*.js.
2. **page/app/01-ui.js** (about 60 lines). A header naming D-374, D-386 and D-387, then `dsRoot(tag, ui, o, cls)`, which
   every component uses for its root. It sets the class to cls plus o.cls (so the old class rides along), data-ui,
   data-key from o.key, data-kind, data-size and data-tone from o, and custom properties from o.vars only. Then the DS
   table of the 16 names.
3. **48 header-only files.** These are page/app/01-ui-01-button.js to 16-message.js, page/ds/components/01-button.css
   to 16-message.css, and page/app/89-gallery-01-button.js to 16-message.js. Each has a one-line header naming its
   lane. The lane that owns a file fills it.
4. **page/app/89-gallery.js.** galComponents shows `galDs<Name>()`'s cells once DS has that component. Until then it
   shows galToday as now. The slot reads data-state "proprietary".
5. **tools/check.mjs harnessesFor.** page/ds/{components,patterns,views}/*.css map like page/ds/*.css, and
   page/app/01-ui-*.js and 89-gallery-*.js map to components, run and look rather than every harness. Each gets one
   case in test/check-touched.test.mjs.
6. **Tests.** test/gallery.test.mjs takes the STAGING_ONLY rule and strips every Gallery part from live.
   test/build.test.mjs holds D-386's budget summed over the split files: 01-ui*.js at most 900 lines,
   components/*.css at most 900 and patterns/*.css at most 500.
7. **tools/pixdiff.cjs** (about 100 lines). It builds a base ref in a temporary worktree and builds HEAD. It shoots
   every tab and segment (views.cjs) on the synthetic record at 390x844 and 1280x800 in light and dark, compares them
   with png.cjs, prints the changed pixels per shot and writes the diff images. Every lane's "pixel diff near zero" is
   this tool's output against the commit the lane started from.

The scaffold is done when npm test and smoke are GREEN, components.cjs is GREEN (16 slots, all "today") and pixdiff
shows 0 changed pixels against main.

## 2. Lanes

| Lane | Tasks and parts | Owns (only this lane edits) | May touch narrowly | Order inside the lane |
| --- | --- | --- | --- | --- |
| C1 | B-507: Button, Badge, Chip, Segmented, Line, Fold, Card, Notice, Toast; the kit delegation | 01-ui-01 to 09, components/01 to 09, 89-gallery-01 to 09, page/app/01-kit.js | components.cjs: only its button, badge and line queries (about lines 125 to 135) | 1. Button, Badge and Chip, pushed together first (C2 uses them). 2. Card, Notice, Fold. 3. Segmented, Line, Toast. 4. Last and alone: btn(), badge(), chip(), row(), empty() and toast() delegate to DS |
| C2 | B-508: Sheet, Popover, Field, Choice, Meter, Presence, Message | 01-ui-10 to 16, components/10 to 16, 89-gallery-10 to 16 | components.cjs: appends one Sheet block at its end. 01-kit.js: the one stat() line, only after C1's delegation is on main | 1. Meter, Presence, Choice, Field (need nothing from C1). 2. Popover, Sheet, Message (after C1's first push). 3. Last: stat() delegates to DS.meter |
| P | B-509: System, Progress | 30-progress.js, 50-system.js, views/system.css, views/progress.css | page/styles.css: deletes only rules scoped to these two views | Progress, then System; one view per commit |
| V1 | B-510: Today | 10-today.js, views/today.css, patterns/week.css | page/styles.css: Today-scoped rules only | The day list, then Week, then the rest |
| V2 | B-511: Study | 20-study.js, 21-study-plan.js, 22-flashcards.js, 05-question-runner.js, views/study.css, patterns/runner.css, plan-card.css, triage.css | page/styles.css: Study-scoped rules only | Plan card, then flashcards and the runner, then Triage; the three dialogs become Sheet last |
| V3 | B-512 Notes; B-513 Record, New, forms | 25-notes.js, 40-record.js, 80-new.js, 91-forms.js, views/notes.css, views/record.css, patterns/note-page.css | page/styles.css: their own rules only | Notes (B-512) first, then Record, New and the forms (B-513) |
| E | B-514: the E.V. window | 60- to 75-ev-*.js, 02-navigation.js, 90-render.js, views/ev.css, patterns/thread.css, patterns/shell.css | page/styles.css: its own rules only | Thread with Presence and Message, then the composer Field, then cards and captions, then Sheet |
| T | The selector half of B-509 to B-514 | Every test/harness/*.cjs except components.cjs, and the test/*.test.mjs files that read page source (page, layout, look, notes, notes-editor, interface-motion, tenets, cards) | none | Trails each view lane by one push |

**Frozen in phases 2 to 4.** These files are frozen: 01-ui*.js, components/*.css, 01-kit.js, page/theme.js,
page/ds/tokens.css, 00-boot.js, 03-connect.js and 04-model.js. 02-navigation.js and 90-render.js are frozen until E.
A view lane that needs a change there sends one line to the build manager, who lends that file to that lane for one
commit.

### Definition of done, every lane

- **Pixel diff.** Run pixdiff against the lane's start commit. It shows 0 changed pixels at 390 and 1280, in light and
  dark, on every view, not just the lane's own. The only exceptions are the listed accessibility fixes, each named
  with its diff image.
- **Gallery (C1 and C2).** Each component shows in the Gallery in every state in B-504's table, its slot reading
  data-state "proprietary". components.cjs is GREEN at 390 and 1280 in light and dark: 44 px taps, 4.5:1 text, row
  heights, a visible focus ring.
- **Tests.** npm test and smoke are GREEN, and so are the harnesses check.mjs maps to the lane's files:
  - C lanes: components. The delegation commits (C1's last, C2's stat()) touch 01-kit.js, which maps to every
    harness, so each runs them all.
  - P: run and look.
  - V1: run, prep and look.
  - V2: run and look.
  - V3: shell, run, notes and look.
  - E: all of them.
- **The note.** The lane's last note reads "npm test N pass, 0 fail at <sha>" from the tree it pushed, then "built;
  awaiting staging". The build manager marks the task done with `ship staging --done`.
- **View lanes.** Every root keeps the old class as a second class (o.cls). Every item that shows a record passes
  `key` (a task, note, spot or card), so data-key is there for T.
- **Extra proofs by task:**
  - B-508: Sheet's focus return and safe-area foot, proved at 390 by C2's components.cjs block. The one check on
    Matt's phone goes on the release card.
  - B-511: each former dialog opens, closes by Esc and by the backdrop, and returns focus.
  - B-514: the composer stays in view with the keyboard open at 390.

### Selectors each lane's markup frees (D-387; T moves them)

- **C1 and C2:** none in the view harnesses. The Gallery harness keeps its class exception. C1 points components.cjs's
  `[data-slot="line"] .li` and its badge and button queries at the DS markup.
- **P:** System and Progress in run.cjs (the 3054 to 3579 block), look.cjs, and smoke's tab pass.
- **V1:** Today's list in run.cjs (inside 1500 to 2618), Today in prep.cjs, and smoke's check-off.
- **V2:** run.cjs 2619 to 3053 (review, practice) and plan, and smoke's review answer.
- **V3:** notes.cjs (about 210 pins), Record in run.cjs, and the Notes tab count in shell.cjs.
- **E:** captions.cjs (about 150 pins), greet.cjs, frame.cjs, core.cjs, the greeting sync in prep.cjs, run.cjs 1500
  to 2618 and 3580 to 5293, and smoke's Your-turn reply.

### The three Gallery notes

None of the three is a look change: each fails D-383 or WCAG 2.2 AA. So D-376 lets them land now, in the component,
never in a view.

| Note | Fails | Lane and fix | Pixels |
| --- | --- | --- | --- |
| Row ticks 22 px on the phone | D-383's 44 px tap | C1, in Line: the tick's hit area grows to 44 px; the drawn tick stays 22 px | none, so no exception |
| Warn chip 3.6:1 in light | 4.5:1 for text (WCAG 1.4.3, D-383) | C1, in Chip: a component-local ink token pointing at an existing darker ink token (no raw value, D-380) | C1's one listed exception, with a before and after crop on the card |
| Stat label 4.19:1 in dark | 4.5:1 for text | C2, in Meter's stat kind, the same way; it reaches the views when stat() delegates | C2's one listed exception, with a crop on the card |

Any other look gap a lane notices goes on B-516's list, not into the lane.

## 3. Selector migration: the test lane

- **Two test agents from phase 3, file-disjoint.** T-a owns run.cjs, smoke.cjs, look.cjs and shell.cjs. T-b owns
  notes.cjs, prep.cjs, captions.cjs, greet.cjs, frame.cjs, core.cjs, paint.cjs and panel.cjs. One T is enough in
  phase 2. Together they own every pin of the about 1,590, so view lanes never meet in run.cjs.
- **Why it is safe.** Old classes ride along one release (D-387), so a view lane's move breaks no selector. T moves
  that view's selectors after the lane's push, onto data-ui, data-key, role and name, and the shell's ids.
- **One exception.** A view lane whose change breaks a check, such as Study's dialogs becoming a native dialog, fixes
  only those lines in its own commit and names them to T.
- **When a view task is done.** Both pushes are on main, the view lane's and T's selector move for that view, and
  staging is GREEN.
- **T's proof per view.** A grep it prints in its note shows no visual class, data-kind, data-size or data-tone left
  for that view in its files, with the pin count before and after, and its harnesses are GREEN.

## 4. Merge and release rhythm

- **Main only.** Each builder works in its own worktree on main and runs `git pull --rebase origin main` before every
  push: no merge commits, never a force push.
- **Small commits.** One component, pattern or view per commit, task id first, the session's attribution lines last.
- **Push only green.** Before a push: npm test, smoke, the lane's mapped harnesses and pixdiff.
- **Rebase conflicts.** In a file the lane owns, it resolves the conflict. In a file it does not own, it aborts the
  rebase and tells the build manager. In page/styles.css, two lanes' deletions merge as both deletions. A conflict
  there means two lanes touched one shared rule: keep the rule; B-515 deletes shared rules.
- **The Chart.** Lanes write only through chart.mjs (`log <id> --note`), with a note at each milestone. A refused
  push is a race: rerun it. Lanes never mark done, never log decisions, never deploy.
- **Red main.** The smoke workflow runs on every push, and the build manager reads main every 4 minutes. The lane
  whose commit turned it red fixes forward within 30 minutes, or reverts its own commit with git revert. The other
  lanes keep working but hold their pushes until main is green. Nobody fixes another lane's file.
- **Staging.** Only the build manager runs ship staging, once per phase (the Phases table). Each ship gets one real
  look with every course, one whole-diff code review and one 20-minute click-through (D-366). Live only on Matt's
  word, never around his Sunday exam.

## Risks

1. **The kit delegation (C1's last commit) changes every view at once.** It is the riskiest commit. It goes alone,
   after a full pixdiff over every view and all harnesses. If it diffs, C1 fixes the component, not the view.
2. **Hoisting.** A component file that runs code at load would read DS or kit consts before they exist. The rule is
   declarations only, and the scaffold's DS table makes a missing function show as undefined, not a crash.
3. **Tracks overlapping V2.** The flashcards track (20, 21, 22) and the bugs track (weak spots, B-499) share V2's
   files. The build manager fires V2 only when they are done or have moved elsewhere.
4. **page/styles.css is ordered by task, not by view.** View lanes delete only rules scoped to their view, and
   shared rules wait for B-515. That leaves more dead CSS until then, but no collisions.
5. **Budget after the split.** Sixteen files hide the total. The scaffold's budget test sums them, and Line, Sheet
   and Field are the ones likely to run long.
6. **The Gallery's patterns section keeps today's version until B-515.** Patterns are not components (D-383 covers
   components only).
7. **Calendar.** The components and views need the whole Fri to Mon window. If phase 1 slips past Fri night, the
   pilot moves to Sun and the views to Mon and Tue, staging only. The build manager tells Matt in two lines (D-366).

## For the build manager to record (the planner writes no Chart)

- **Decision proposed (supersedes D-386's file naming only).** Proprietary's components are one file each:
  page/app/01-ui.js holds DS and dsRoot. page/app/01-ui-NN-<name>.js and page/ds/components/NN-<name>.css hold one
  component each, in B-504's order. Patterns and view CSS are one file each under page/ds/patterns/ and
  page/ds/views/, joined by the build into their layers. D-386's budget counts the sum. Why: four parallel lanes
  without shared files (D-385).
- **Task edits.** B-508 depends on B-506 and the scaffold, not on B-507. B-508's title names the split files, not
  02-ui.js. B-507's title says Notice, not Empty.
