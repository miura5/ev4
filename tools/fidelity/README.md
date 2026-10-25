# Fidelity: the built page against the v4 demo (D-312)

A snapshot of the approved v4 demo (https://claude.ai/artifact/HvuXFf9B6yTyjwSTiBtJoT, made-up data only) and the
scripts the fidelity review used to compare it with the built page. Screenshots go to $FIDELITY_OUT (default
/tmp/fidelity).

- `node tools/fidelity/demo-all.cjs`: every demo board at 1280x900 and 390x844, with geometry in report.json.
- `node tools/fidelity/demo-wide.cjs`: the boards at 1706 and 2560 wide.
- `node tools/fidelity/demo-prefs.cjs`: the Preferences popover open.
- `node tools/build.mjs && node tools/fidelity/built.cjs`: each built view at the same sizes, on the synthetic record.
- `node tools/fidelity/built-states.cjs`, `built-progress.cjs`: opened states (a task, the week, a picked bar, the filter).

A view task in the fidelity sprint is done when its built screenshots, read side by side with its board's, show the
same frame, parts and proportions at 1280, 1706, 2560 and 390, apart from the hand-off's build corrections.
