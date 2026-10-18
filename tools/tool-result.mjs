#!/usr/bin/env node
// Saves a tool's result exactly as the chat received it, copied from this session's transcript, so a read that the
// tool does not save to a file (list_triggers, for one) still reaches dist/state without being retyped.
//   node tools/tool-result.mjs <tool name or suffix> <out file> [--back N] [--html] [--transcript <file.jsonl>]
// --back 0 (the default) is the most recent result of that tool, 1 the one before, and so on. The result's first
// text block that parses as JSON is written, pretty-printed; with none, the text itself is written. --html keeps
// only the page itself, from its <!doctype html> on (an Artifact read puts header lines before it).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newestTranscript, toolResults, resultBody } from '../core/transcript.mjs';

export { newestTranscript, toolResults, resultBody };

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
