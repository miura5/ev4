CREATE TABLE IF NOT EXISTS docs (
  c TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  at INTEGER NOT NULL,
  v INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (c, id)
);
CREATE INDEX IF NOT EXISTS docs_at ON docs (at);
-- B-418 (D-339): /api/claude's token use per clock hour (day: the Central date), for the hourly and daily ceilings.
CREATE TABLE IF NOT EXISTS claude_usage (
  hour INTEGER PRIMARY KEY,
  day TEXT NOT NULL,
  tokens INTEGER NOT NULL DEFAULT 0,
  calls INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS claude_usage_day ON claude_usage (day);
-- B-418: the last read-along read of each note (h: its text's length and hash), for new-text-only and one per 75 s.
CREATE TABLE IF NOT EXISTS claude_reads (
  note TEXT PRIMARY KEY,
  h TEXT NOT NULL,
  at INTEGER NOT NULL
);

-- B-435 (D-349): settings changed without a release (the Claude ceilings: claude.hourTokens, claude.dayTokens).
CREATE TABLE IF NOT EXISTS claude_settings (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL,
  at INTEGER NOT NULL
);
