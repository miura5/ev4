# E.V. Study Watch reader

A read-only local connector (MCP server, stdio, no dependencies) for the Claude desktop app. It lets
E.V. Home, opened in the desktop app, read two files in `~/Documents/E.V. Study Watch`:

- `context.json`: written by E.V.'s evening run (objectives and active weak spots).
- `live/latest.json`: Matt's latest NUR 112 or BIO 201 note, written by Study Watch in reader mode (0.4+).

Tools: `status` and `latest_note`, both annotated read-only. It never writes or deletes, never returns
other files or file names, refuses symlinks, skips notes tagged `#graded`, and re-checks B-06 (only NUR 112
or BIO 201 folders; never Journal, personal or E.V.).

The page reaches it as the host server `host:ev-study-watch-reader` (the `mcp` capability; owner only, inside
the Claude desktop app).

## Build and install

```
npx @anthropic-ai/mcpb pack studywatch/reader dist/ev-study-watch-reader.mcpb
```

Matt installs the file in the Claude desktop app: Settings > Extensions > Advanced settings >
Install Extension. Tests: `test/reader.test.mjs`.
