#!/usr/bin/env node
// E.V. Study Watch reader: a read-only local MCP server (stdio) that lets E.V. Home, opened in the Claude
// desktop app, read the two files E.V. needs from Matt's Study Watch folder:
//   context.json        written by E.V.'s evening run (objectives and active weak spots)
//   live/latest.json    written by Study Watch in reader mode (his latest school note)
// It never writes or deletes anything, never returns file names or other files, and reads nothing else.
// No dependencies.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '0.1.0';
const NAME = 'ev-study-watch-reader';
const FOLDER = process.env.EV_STUDY_WATCH_DIR || path.join(os.homedir(), 'Documents', 'E.V. Study Watch');
const FILES = { context: 'context.json', latest: path.join('live', 'latest.json') };
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_CHARS = 100000;
// B-06: only Matt's named school folders, never Journal, personal or E.V.'s own folder. Study Watch filters
// first; the reader checks again so a misconfigured app can't widen what E.V. Home sees.
const WATCHED = ['NUR 112', 'BIO 201'];
const EXCLUDED = ['journal', 'personal', 'e.v.', 'recently deleted'];
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const TOOLS = [
  {
    name: 'status',
    title: 'Study Watch reader status',
    description: 'Whether the E.V. Study Watch folder is reachable, when E.V. last wrote context.json, and which school note Study Watch saved last (name and times only, no note text).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { title: 'Study Watch reader status', ...READ_ONLY },
  },
  {
    name: 'latest_note',
    title: 'Latest school note',
    description: 'The school note Study Watch saved last (NUR 112 or BIO 201 only): id, name, folder, modified time and plain text. Pass sinceModifiedAt (ISO time from the previous call) to get unchanged:true without the text when nothing new was written. Notes tagged #graded come back as graded:true with no text.',
    inputSchema: { type: 'object', properties: { sinceModifiedAt: { type: 'string', description: 'ISO time of the last version you already have' } }, additionalProperties: false },
    annotations: { title: 'Latest school note', ...READ_ONLY },
  },
];

class ToolError extends Error {}

/** Reads one allowlisted file inside FOLDER. Refuses symlinks and anything that resolves outside the folder. */
function readAllowed(rel) {
  const root = fs.realpathSync(FOLDER);
  const full = path.join(root, rel);
  let st;
  try { st = fs.lstatSync(full); } catch { return null; }
  if (st.isSymbolicLink() || !st.isFile()) return null;
  const real = fs.realpathSync(full);
  if (path.relative(root, real).startsWith('..')) return null;
  if (st.size > MAX_FILE_BYTES) throw new ToolError(`${rel} is larger than ${MAX_FILE_BYTES} bytes`);
  return { text: fs.readFileSync(real, 'utf8'), mtime: st.mtime };
}
function readJson(rel) {
  const f = readAllowed(rel);
  if (!f) return null;
  try { return { data: JSON.parse(f.text), mtime: f.mtime }; } catch { throw new ToolError(`${rel} is not valid JSON`); }
}
/** 'ok', 'missing', or 'denied' (macOS has not allowed the Claude app to read Documents). */
function folderAccess() {
  try { if (!fs.statSync(FOLDER).isDirectory()) return 'missing'; fs.readdirSync(FOLDER); return 'ok'; }
  catch (e) { return e && (e.code === 'EPERM' || e.code === 'EACCES') ? 'denied' : 'missing'; }
}
const DENIED = 'macOS has not allowed the Claude app to read your Documents folder. Allow it in System Settings > Privacy & Security > Files and Folders > Claude.';
function folderFound() { const a = folderAccess(); if (a === 'denied') throw new ToolError(DENIED); return a === 'ok'; }

/** B-06 check on a note's folder path ("2026/2026 Fall/NUR 112/Week 8"). */
export function allowedFolder(folder) {
  const parts = String(folder || '').split('/').map(s => s.trim()).filter(Boolean);
  if (!parts.some(p => WATCHED.includes(p))) return false;
  return !parts.some(p => EXCLUDED.includes(p.toLowerCase()));
}

function status() {
  if (!folderFound()) return { reader: VERSION, folderFound: false, context: null, latestNote: null };
  const ctx = readJson(FILES.context);
  const latest = readJson(FILES.latest);
  const n = latest && latest.data && latest.data.note;
  return {
    reader: VERSION,
    folderFound: true,
    context: ctx ? { found: true, updatedAt: ctx.data.updatedAt || null, nextExam: (ctx.data.nextExam && ctx.data.nextExam.id) || null } : { found: false },
    latestNote: latest
      ? { found: true, writtenAt: latest.data.writtenAt || null, appVersion: latest.data.appVersion || null, name: n && allowedFolder(n.folder) ? n.name || null : null, modifiedAt: (n && n.modifiedAt) || null, ageSeconds: Math.round((Date.now() - latest.mtime.getTime()) / 1000) }
      : { found: false },
  };
}

function latestNote(args = {}) {
  if (!folderFound()) throw new ToolError('The E.V. Study Watch folder was not found in Documents.');
  const latest = readJson(FILES.latest);
  if (!latest) return { found: false, hint: 'Study Watch has not saved a note yet. It needs reader mode (version 0.4 or later) and a school note edited recently.' };
  const d = latest.data || {}, n = d.note || {};
  if (!n.id || !allowedFolder(n.folder)) return { found: false, refused: true, hint: 'The saved note is not in NUR 112 or BIO 201, so E.V. will not read it.' };
  const head = { found: true, writtenAt: d.writtenAt || null, appVersion: d.appVersion || null, note: { id: String(n.id), name: String(n.name || ''), folder: String(n.folder), modifiedAt: n.modifiedAt || null } };
  const text = String(n.text || '');
  if (d.graded || /#graded\b/i.test(text)) return { ...head, graded: true };
  if (args.sinceModifiedAt && n.modifiedAt && Date.parse(n.modifiedAt) <= Date.parse(args.sinceModifiedAt)) return { ...head, unchanged: true };
  const truncated = text.length > MAX_TEXT_CHARS;
  return { ...head, note: { ...head.note, chars: text.length, text: truncated ? text.slice(0, MAX_TEXT_CHARS) : text, truncated } };
}

function callTool(name, args) {
  if (name === 'status') return status();
  if (name === 'latest_note') return latestNote(args || {});
  throw new ToolError(`Unknown tool: ${name}`);
}

// ---------------------------------------------------------------- JSON-RPC over stdio (newline-delimited)
function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
function reply(id, result) { send({ jsonrpc: '2.0', id, result }); }
function fail(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }

export function handle(msg) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return fail(msg && msg.id != null ? msg.id : null, -32600, 'Invalid request');
  const { id, method, params } = msg;
  if (id === undefined || id === null) return; // notifications (initialized, cancelled) need no answer
  switch (method) {
    case 'initialize': {
      const asked = params && params.protocolVersion;
      return reply(id, {
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: NAME, title: 'E.V. Study Watch reader', version: VERSION },
        instructions: 'Read-only. Reads only context.json and live/latest.json in Documents/E.V. Study Watch.',
      });
    }
    case 'ping': return reply(id, {});
    case 'tools/list': return reply(id, { tools: TOOLS });
    case 'tools/call': {
      const name = params && params.name;
      try {
        const out = callTool(name, params && params.arguments);
        return reply(id, { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out });
      } catch (e) {
        const text = e instanceof ToolError ? e.message : 'The reader hit an unexpected error.';
        if (!(e instanceof ToolError)) process.stderr.write(`[${NAME}] ${e && e.stack || e}\n`);
        return reply(id, { content: [{ type: 'text', text }], isError: true });
      }
    }
    default: return fail(id, -32601, `Method not found: ${method}`);
  }
}

// Start only when run directly (the install path has spaces, so compare real file paths, not URLs).
const real = p => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch { fail(null, -32700, 'Parse error'); continue; }
      handle(msg);
    }
  });
  process.stdin.on('end', () => process.exit(0));
  process.stderr.write(`[${NAME}] ${VERSION} reading ${FOLDER}\n`);
}
