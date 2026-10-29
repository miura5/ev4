# UI polish reference (D-392 to D-395)

The passed UI polish design, kept as the permanent reference for tasks B-539 to B-572. The design doc is
https://claude.ai/artifact/9w83U8c79EjxijPXqs9xKi; this folder is its working demo, copied from the design chat's
round 5 so it outlives that chat.

| Path | What it is |
| --- | --- |
| `after/<view>-light.html`, `-dark.html` | The mock-up of each view (conv, today, today-wco, study, notes, progress, record) |
| `after/<view>-<width>-<theme>.png` | Each mock-up at 1280x800 and 390x844, light and dark (today also at 360) |
| `after/prototype.html` | The interactive Today prototype (tick, fold, E.V. sheet) |
| `after/motion-*.html`, `after/p4-*.png`, `p5-*.png` | The motion spec and the prototype's motion frames |
| `r4.css`, `ds/` | The proposed tokens and components the mock-ups use |
| `index.html` | The list served on staging at `/reference` |

The L-shaped frame (sidebar plus bottom strip, with the main window as a floating inset panel) is part of the design.

Text is staging practice data; one Record row (a workout entry) was replaced with a synthetic session.

## Opening it

- Locally: open `docs/design/ui-polish/index.html` (or any `after/*.html`) in a browser, or serve the folder with
  `npx serve docs/design/ui-polish` and visit it. Fonts load from Google Fonts.
- On staging: the app's `/reference` (built by `tools/build-pwa.mjs` from `STAGING_REFERENCE` in `tools/build.mjs`;
  live never has it).

## How builders use it (D-396)

The reference is guidance, not a 1:1 gate. Build through Proprietary toward the reference; a task is done when it looks
right on staging at 1280; side-by-side matching and inaccuracy fixes come after release.
