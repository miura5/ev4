// The diagnostic pipeline's steps (spec.pipelines.diagnostic), split from core/steps.mjs, which merges them into its
// tables: the probe-brief material with the named probes it builds, and the probe-result fold. Same contracts as
// core/steps.mjs.
import fs from 'node:fs';
import path from 'node:path';
import EV from './evcore.mjs';

export const AGENT_MATERIAL = {
  /** The probe this diagnostic run answers, and the surfaces the environments registry tracks. */
  'probe-brief'(db, ctx, spec) {
    if (!ctx.input || !ctx.input.probe) return { skip: 'no probe named' };
    const surfaces = Object.keys(spec.environments || {}).filter(k => !k.startsWith('_'));
    const named = probeNamed(spec, ctx.input.probe);
    if (!named) return { probe: ctx.input.probe, surfaces };
    return { probe: ctx.input.probe, surfaces, measures: named.def.measures, groups: probeGroups(named, ctx) };
  },
};

/** The named probe a firing text asks for ('ceilings', or 'Probe: ceilings'), or null for a free-form probe. */
function probeNamed(spec, text) {
  const probes = (spec.pipelines.diagnostic || {}).probes || {};
  const name = String(text || '')
    .trim()
    .replace(/^probe:\s*/i, '')
    .toLowerCase();
  return Object.prototype.hasOwnProperty.call(probes, name) && !name.startsWith('_')
    ? { name, def: probes[name] }
    : null;
}
const PAD = 'E.V. probe padding, not study data. ';
/** One probe document of about `bytes` bytes as JSON: the envelope, its label and padding. */
function probeDoc(ctx, label, bytes) {
  const base = {
    schema: 1,
    writer: 'diagnostic',
    at: ctx.now,
    source: ctx.source,
    release: ctx.release,
    run: ctx.runId,
    label,
    bytes,
    pad: '',
  };
  const room = Math.max(0, bytes - Buffer.byteLength(JSON.stringify(base)));
  base.pad = PAD.repeat(Math.ceil(room / PAD.length)).slice(0, room);
  return base;
}
const kib = n => String(n).padStart(4, '0');
/**
 * The groups of exact calls a named probe makes, each document written to <ctx.dir>/probe/ first (so a call names a
 * file, never inline data). Ids are debug/<run id>-<label>; nothing is created twice and nothing is deleted.
 */
function probeGroups(named, ctx) {
  const dir = path.join(ctx.dir, 'probe');
  const file = (label, bytes) => {
    const f = path.join(dir, label + '.json');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(f, JSON.stringify(probeDoc(ctx, label, bytes)));
    return f;
  };
  return named.def.groups.map(g => {
    const calls = [];
    for (const k of g.documentKiB || []) {
      const label = 'doc-' + kib(k) + 'k';
      calls.push({
        tool: 'ArtifactData',
        args: {
          action: 'set',
          url: ctx.url,
          collection: 'debug',
          doc_id: ctx.runId + '-' + label,
          file_path: file(label, k * 1024),
        },
      });
    }
    // A read call a probe names whole (B-29's cloud-reads); "<record>" is this run's record URL.
    for (const c of g.calls || [])
      calls.push({
        tool: c.tool,
        args: JSON.parse(JSON.stringify(c.args).split('"<record>"').join(JSON.stringify(ctx.url))),
      });
    // A new private page a probe publishes (B-54's page-publish): made up, no study data; the run writes the file it names.
    for (const pg of g.pages || []) {
      const f = path.join(dir, pg.label + '.html');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        f,
        `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${pg.title}</title><style>:root{color-scheme:light dark;--bg:#fff;--ink:#111}@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0b0f17;--ink:#e6eef2}}:root[data-theme="dark"]{--bg:#0b0f17;--ink:#e6eef2}body{margin:0;padding:24px 16px;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,sans-serif}</style></head><body><h1>${pg.title}</h1><p>A made-up page an E.V. diagnostic run (${ctx.runId}) published to learn whether a cloud run can publish a page. It holds no study data.</p></body></html>`
      );
      calls.push({
        tool: 'Artifact',
        args: {
          action: 'publish',
          file_path: f,
          title: pg.title,
          icon: pg.icon || 'page',
          description: 'A made-up page from an E.V. diagnostic run; no study data.',
        },
      });
    }
    for (const b of g.batches || []) {
      const writes = [];
      for (let i = 1; i <= b.writes; i++) {
        const label = `batch-${b.writes}x${kib(b.kib)}k-${String(i).padStart(2, '0')}`;
        writes.push({
          op: 'set',
          collection: 'debug',
          doc_id: ctx.runId + '-' + label,
          file_path: file(label, b.kib * 1024),
        });
      }
      calls.push({ tool: 'ArtifactData', args: { action: 'batch', url: ctx.url, writes } });
    }
    return { name: g.name, rule: g.rule, calls };
  });
}

export const AGENT_FOLDS = {
  /** {findings, proven?, limits?}: the run's ledger entry carries them (a design chat turns them into registry rows). */
  'probe-result'(answer, db, ctx) {
    const numbers = answer.numbers || {};
    const parts = [
      answer.findings,
      ...(answer.proven || []).map(p => 'proven: ' + p),
      ...(answer.limits || []).map(l => 'limit: ' + l),
      ...Object.entries(numbers).map(([k, v]) => `${k}=${v}`),
    ];
    const doc = {
      ...EV.envelope('diagnostic', ctx.source, ctx.now),
      release: ctx.release,
      run: ctx.runId,
      probe: String(ctx.input.probe).slice(0, 500),
      findings: answer.findings,
      proven: answer.proven || [],
      limits: answer.limits || [],
      numbers,
    };
    return {
      writes: [{ op: 'set', collection: 'debug', id: ctx.runId, data: doc }],
      detail: parts.join(' | ').slice(0, 500),
      push: ('Diagnostic: ' + answer.findings).slice(0, 120),
      say: [
        `${(answer.proven || []).length} proven, ${(answer.limits || []).length} limits, ${Object.keys(numbers).length} numbers.`,
      ],
    };
  },
};
