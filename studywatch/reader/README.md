# E.V. Study Watch reader

A read-only local connector (MCP server, stdio, no dependencies) for the Claude desktop app. It lets
E.V. Home, opened in the desktop app, read these in `~/Documents/E.V. Study Watch`:

- `context.json`: written by E.V.'s evening run (objectives and active weak spots).
- `live/latest.json`: Matt's latest NUR 112 or BIO 201 note, written by Study Watch in reader mode (0.4+).
- `sessions/<date>-<HHMM>-<note>.json`: Study Watch session files (v2), which the page files when it opens.

Tools (v2, 0.3.0): `status`, `latest_note` (with the note's `file`, `title` and `line`, D-131), `list_sessions` (ids, sizes, sha256, modified times; no contents) and
`read_session` (one session's findings exactly as E.V.'s filing reads them: never the note text or the cards), all
annotated read-only. It never writes or deletes, never returns
other files or file names, refuses symlinks, skips notes tagged `#graded`, and re-checks B-06 (only NUR 112
or BIO 201 folders; never Journal, personal or E.V.).

The page reaches it as the host server `host:ev-study-watch-reader` (the `mcp` capability; owner only, inside
the Claude desktop app).

## Build and install

```
npx @anthropic-ai/mcpb pack studywatch/reader dist/ev-study-watch-reader.mcpb
```

Matt installs the file in the Claude desktop app: Settings > Extensions > Advanced settings >
Install Extension (replacing the version before it). Tests: `test/reader.test.mjs`.
