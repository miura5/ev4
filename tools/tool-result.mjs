#!/usr/bin/env node
// Saves a tool's result exactly as the chat received it, copied from this session's transcript, so a read that the
// tool does not save to a file (list_triggers, for one) still reaches dist/state without being retyped.
//   node tools/tool-result.mjs <tool name or suffix> <out file> [--back N] [--html] [--transcript <file.jsonl>]
// --back 0 (the default) is the most recent result of that tool, 1 the one before, and so on. The result's first
// text block that parses as JSON is written, pretty-printed; with none, the text itself is written. --html keeps
// only the page itself, from its <!doctype html> on (an Artifact read puts header lines before it).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The newest *.jsonl under ~/.claude/projects: the transcript of the session running this command. */
export function newestTranscript(home = os.homedir()) {
  const base = path.join(home, '.claude', 'projects');
  if (!fs.existsSync(base)) return null;
  const files = fs.readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory())
    .flatMap(d => fs.readdirSync(path.join(base, d.name)).filter(f => f.endsWith('.jsonl')).map(f => path.join(base, d.name, f)));
  return files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || null;
}

/** All results of tools whose name equals or ends with `tool`, oldest first, as {name, input, texts}. */
export function toolResults(jsonl, tool) {
  const uses = new Map(), out = [];
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue;
    let row; try { row = JSON.parse(line); } catch { continue; }
    const content = row && row.message && row.message.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (b.type === 'tool_use' && (b.name === tool || String(b.name).endsWith('__' + tool) || String(b.name).endsWith(tool))) uses.set(b.id, b);
      else if (b.type === 'tool_result' && uses.has(b.tool_use_id)) {
        const c = b.content, texts = typeof c === 'string' ? [c] : (c || []).filter(x => x.type === 'text').map(x => x.text);
        const u = uses.get(b.tool_use_id);
        out.push({ name: u.name, input: u.input, texts, isError: !!b.is_error });
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), opt = k => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : null; };
  const html = args.includes('--html'); if (html) args.splice(args.indexOf('--html'), 1);
  const back = Number(opt('--back') || 0), file = opt('--transcript') || newestTranscript();
  const [tool, out] = args;
  if (!tool || !out) { console.error('usage: tool-result.mjs <tool> <out file> [--back N] [--transcript f]'); process.exit(2); }
  if (!file) { console.error('no session transcript found under ~/.claude/projects'); process.exit(1); }
  const all = toolResults(fs.readFileSync(file, 'utf8'), tool), r = all[all.length - 1 - back];
  if (!r) { console.error(`no result of ${tool} in ${file} (${all.length} found)`); process.exit(1); }
  if (r.isError) { console.error(`that ${tool} call failed; not saved`); process.exit(1); }
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, resultBody(r, { html }));
  console.log(`saved ${r.name} ${JSON.stringify(r.input)} -> ${out}`);
}
