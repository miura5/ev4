# The canvas

## Boards, in order

The Dark page holds the originals; the Light page holds one small wrapper per original that shows it with
`theme="light"`, so each design exists once.

1. **Gallery** (`Main.dc.html`): every token and component, rendered from `kit/kit.css`. First on the page, and the
   first file edited in any revision that changes a look.
2. **Diagnosis**: from `diagnosis.md`, grouped by severity, each item with its finding id. One or two boards.
3. **Skeleton**: the repo tree and the checks that hold it.
4. **Layers**: commands, domain, jobs, data, and the job contract.
5. **Layout**: the shell's regions and the folder each one comes from.
6. **UI screens**: one board per screen (Today, Ask E.V., Library, Notes, Progress, Activity, ⌘K, Detail).
7. **Chain**: one feature traced from the UI back to the skeleton.
8. **Ledger and questions**: the ledger's current rows (carry, edit, new, drop) and the open questions for Matt.
   Rendered from `ledger.md` and the handover; it's how Matt sees state without reading files.

Each board's header carries a small revision tag (r1, r2…) that the handover lists. A new board gets a frame entry
in `canvas.json`, a wrapper on the Light page, and a row in the handover.

## Files and publishing

- Work in `docs/design/ev5/canvas/` (it holds `project/`). Publish with `root` set to that folder.
- Boards link `kit/kit.css` relatively and the Google Fonts line; nothing else styles them.
- A board's theme comes from its `theme` prop; the root is `<div class="ev …" data-theme="{{theme}}">`.
- Send only the changed files; send `canvas.json` only when boards are added, moved or resized.
- After publishing, record the new version id in the handover.

## Fit check (before every publish)

The first version of this canvas shipped with boards 128 px wider than their frames. Check every changed board:

1. Build a plain HTML copy of the board (its root `div` with `{{theme}}` replaced) beside a copy of `kit.css`.
2. Serve the folder on localhost and open it in the browser pane at the frame's width.
3. Measure: the root's width and height equal the frame; no element's right or bottom passes the root; no clipped
   overflow. Repeat with `data-theme="light"`.
4. Look at one screenshot of each changed board. Then stop the server.

## Feedback channels

- Matt's chat messages and his comments on the canvas are both asks. Read comments at session start and answer each
  one on the canvas when it's handled.
- A change Matt makes on the canvas by hand is kept: merge it into the source files, and note it in the ledger if it
  changes what carries over.
