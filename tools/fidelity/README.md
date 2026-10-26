# Fidelity: the built page against the v4 demo (D-312)

A snapshot of the approved demo, now the 'E.V. demo v4 + Notes' canvas (https://claude.ai/artifact/26TPNoqZBmPkEN5SmtJF9k,
D-327, made-up data only; the earlier v4 demo's boards are unchanged in it), and the scripts the fidelity review uses
to compare it with the built page. `demo/project/AppNotes.dc.html` is the new whole app in the L-frame (Notes and E.V.'s
bottom strip); `Main.dc.html` stays the old demo's whole app; `canvas.json` names every board. Screenshots go to $FIDELITY_OUT (default
/tmp/fidelity).

- `node tools/fidelity/demo-all.cjs`: every demo board at 1280x900 and 390x844, and the Notes boards (AppNotes,
  NotesList, NoteEditor, NoteStyleMenu, NoteStudyPopup, AppTodayEV, NoteStates) at 1280, 1706 and 2560, with geometry
  in report.json.
- `node tools/fidelity/crawl.cjs demo|built [width] [starts]`: clicks every control two clicks deep from each start.
  The demo starts by default at AppNotes and NoteEditor (style menu, link popover, E.V.'s strip and pop-up, history,
  minimize); pass `Main` for the old demo. The built page starts at app, notes and note; the Notes starts are skipped
  while the page has no Notes tab.
- `node tools/fidelity/demo-wide.cjs`: the boards at 1706 and 2560 wide.
- `node tools/fidelity/demo-prefs.cjs`: the Preferences popover open.
- `node tools/build.mjs && node tools/fidelity/built.cjs`: each built view at the same sizes, on the synthetic record,
  with Notes (its list and the first note opened) once the page has a Notes tab; `SIZES` sets the viewports.
- `node tools/fidelity/built-states.cjs`, `built-progress.cjs`: opened states (a task, the week, a picked bar, the filter).

A view task in the fidelity sprint is done when its built screenshots, read side by side with its board's, show the
same frame, parts and proportions at 1280, 1706, 2560 and 390, apart from the hand-off's build corrections.
