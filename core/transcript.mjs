// Reading this session's own transcript: the tool results a chat or a run received, exactly as received. Used to save
// reads a tool does not save to a file (tools/tool-result.mjs), to take document versions from ArtifactData replies
// (run pull), and to audit a run's calls against what its commands printed (run audit).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** The newest *.jsonl under ~/.claude/projects: the transcript of the session running this command. */
export function newestTranscript(home = os.homedir()) {
  const base = path.join(home, '.claude', 'projects');
  if (!fs.existsSync(base)) return null;
  const files = fs.readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory())
    .flatMap(d => fs.readdirSync(path.join(base, d.name)).filter(f => f.endsWith('.jsonl')).map(f => path.join(base, d.name, f)));
  return files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || null;
}

/** All results of tools whose name equals or ends with `tool` (every tool when `tool` is '*'), oldest first, as
 *  {id, name, input, texts, isError}. */
export function toolResults(jsonl, tool) {
  const uses = new Map(), out = [];
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue;
    let row; try { row = JSON.parse(line); } catch { continue; }
    const content = row && row.message && row.message.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (b.type === 'tool_use' && (tool === '*' || b.name === tool || String(b.name).endsWith('__' + tool) || String(b.name).endsWith(tool))) uses.set(b.id, b);
      else if (b.type === 'tool_result' && uses.has(b.tool_use_id)) {
        const c = b.content, texts = typeof c === 'string' ? [c] : (c || []).filter(x => x.type === 'text').map(x => x.text);
        const u = uses.get(b.tool_use_id);
        out.push({ id: u.id, name: u.name, input: u.input, texts, isError: !!b.is_error });
      }
    }
  }
  return out;
}

/** The text to save for one result: its first JSON text block, pretty-printed, else the joined text. */
export function resultBody(r, { html = false } = {}) {
  if (html) {
    const text = r.texts.join('\n'), i = text.search(/<!doctype html/i);
    if (i < 0) throw new Error('no <!doctype html> in that result');
    return text.slice(i).replace(/\s+$/, '');
  }
  for (const t of r.texts) { try { return JSON.stringify(JSON.parse(t), null, 1); } catch { /* not JSON */ } }
  return r.texts.join('\n');
}
