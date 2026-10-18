// deploy and verify-deploy as pure functions (Operational architecture, "Release: manifest, deploy, verify").
// A build chat cannot be called from code, so both work from files: the manifest the build wrote, and the live
// state the chat saved with the read calls verifyReads() prints. verify() diffs that state against the manifest;
// deployCalls() prints the exact tool calls that make the live state match it.

export const SYSTEM_IDS = ['manifest', 'spec', 'environments'];
// What verify reads from a record: the deployed system documents, plus staging's seed stamp (written by seed-staging).
export const readIds = target => (target === 'staging' ? [...SYSTEM_IDS, 'seed'] : SYSTEM_IDS);
export const ENVELOPE = ['schema', 'writer', 'at', 'source'];
const STAMP = /<meta\s+name=["']ev-release["']\s+content=["']([^"']+)["']/i;

export const artifactUrl = id => `https://claude.ai/artifact/${id}`;
export const pageStamp = html => { const m = (html || '').match(STAMP); return m ? m[1] : null; };
const strip = doc => { const out = { ...doc }; for (const k of ENVELOPE) delete out[k]; return out; };
// Key order is not meaning: compare documents by their canonical JSON.
export function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
const same = (a, b) => canonical(a) === canonical(b);

/** The tasks a target's verify and deploy cover: that target's pipeline tasks, plus the build tasks on staging. */
export function tasksFor(manifest, target) {
  return Object.entries(manifest.tasks).filter(([key, t]) => t.record === target || (target === 'staging' && key.startsWith('build.')));
}

/** The reads a build chat makes and where it saves each result, so verify can diff them. */
export function verifyReads({ manifest, target, stateDir }) {
  const rec = manifest.records[target];
  const reads = [{
    tool: 'mcp__claude-code-remote__list_triggers', args: { limit: 100 },
    save: `${stateDir}/triggers-1.json`,
    note: `Save it with node tools/tool-result.mjs list_triggers ${stateDir}/triggers-1.json (copies the result from this session's transcript; never retype it). When it has a next_cursor, call again with cursor and save triggers-2.json the same way, and so on.`,
  }];
  if (rec.artifact) {
    for (const id of readIds(target)) reads.push({ tool: 'ArtifactData', args: { action: 'get', url: artifactUrl(rec.artifact), collection: 'system', doc_id: id, out_dir: `${stateDir}/record` }, save: `${stateDir}/record/system/${id}.json`, note: 'Saved by the tool; note the version it prints for deploy --version.' });
    const page = manifest.pages[target];
    if (page.artifact) reads.push({ tool: 'Artifact', args: { action: 'read', url: artifactUrl(page.artifact) }, save: `${stateDir}/page.html`, note: `Save it with node tools/tool-result.mjs Artifact ${stateDir}/page.html --html (or copy the file the read names, when it names one).` });
    const published = Object.keys(page.files).slice(1).map(f => f.replace(/^page\/[^/]+\//, ''));
    if (page.artifact && published.length) reads.push({ tool: 'Artifact', args: { action: 'read', url: artifactUrl(page.artifact), paths: published, out_dir: `${stateDir}/page-files` }, save: `${stateDir}/page-files/`, note: 'Saved by the tool, one file per published path. The shell is held by the page read above: publishing wraps it, so the read must contain the built shell verbatim.' });
  }
  return reads;
}

function triggerFields(t) {
  const ds = t.derived_state || {};
  return {
    name: t.name, enabled: t.enabled, schedule: t.cron_expression || null, prompt: typeof ds.prompt === 'string' ? ds.prompt : null,
    // list_triggers does not report the bound device (Oct 18: both Mac tasks ran on the Mac with "Require this
    // computer" on, yet showed no bound_device); attached folders exist only on a task that requires the computer.
    macBound: Boolean(t.bound_device_uuid || t.bound_device || ds.folders_state === 'FOLDERS_STATE_PRESENT'), folders: ds.folders || [],
    push: Boolean(t.notifications && t.notifications.channel && t.notifications.channel.push),
  };
}

/**
 * Diffs saved live state against the manifest. state: {triggers: [list_triggers entries] | null, record: {manifest,
 * spec, environments} (absent docs undefined) | null, pageHtml: string | null, pageFiles: {path: sha256} | null}.
 * build: {pushed: bool}. sha256: the hash function (node's or the page's). Returns {green, lines: [{ok, what, detail}]}.
 */
export function verify({ manifest, target, state, build, dist, sha256, now = new Date().toISOString() }) {
  const lines = [];
  const add = (ok, what, detail = '') => lines.push({ ok, what, detail });
  const rec = manifest.records[target];

  add(!manifest.dirty, 'build is clean', manifest.dirty ? 'dist/manifest.json was built from a dirty tree' : `${manifest.release} at ${manifest.commit.slice(0, 12)}`);
  add(build.pushed, 'build commit is pushed', build.pushed ? '' : `${manifest.commit.slice(0, 12)} is not on origin/main; scheduled runs check out pushed commits only`);

  if (!rec.artifact) add(false, `${target} record exists`, `no ${target} record in spec.registry.records (created in B-12)`);
  else if (!state.record) add(false, `${target} record read`, 'no saved system/* documents; run the reads below');
  else {
    const live = state.record;
    if (!live.manifest) add(false, 'system/manifest deployed', 'absent from the record');
    else {
      for (const k of ['release', 'commit', 'specVersion']) add(live.manifest[k] === manifest[k], `system/manifest ${k}`, live.manifest[k] === manifest[k] ? manifest[k] : `record ${live.manifest[k]}, build ${manifest[k]}`);
      const changed = Object.keys({ ...manifest.files, ...(live.manifest.files || {}) }).filter(f => (live.manifest.files || {})[f] !== manifest.files[f]);
      add(changed.length === 0, 'system/manifest file hashes', changed.length ? `${changed.length} differ: ${changed.slice(0, 5).join(', ')}` : `${Object.keys(manifest.files).length} files`);
      add(live.manifest.dirty === false, 'system/manifest is clean');
    }
    for (const id of ['spec', 'environments']) {
      if (!live[id]) add(false, `system/${id} deployed`, 'absent from the record');
      else add(same(strip(live[id]), strip(dist[id])), `system/${id} matches the build`, same(strip(live[id]), strip(dist[id])) ? '' : 'its content differs from dist/system/' + id + '.json');
    }
    if (target === 'staging') {
      const seed = live.seed;
      if (!seed || !seed.exportedAt) add(false, 'staging seed', 'no system/seed: run seed-staging');
      else {
        const days = Math.max(0, Math.floor((Date.parse(now) - Date.parse(seed.exportedAt)) / 864e5));
        const docs = Object.values(seed.counts || {}).reduce((n, c) => n + c, 0);
        add(true, 'staging seed', `${docs} documents from a ${seed.from || 'live export'} taken ${seed.exportedAt.slice(0, 10)}, ${days} day${days === 1 ? '' : 's'} old`);
      }
    }
  }

  const page = manifest.pages[target];
  if (page.artifact || Object.keys(page.files).length) {
    if (state.pageHtml == null) add(false, `${target} page read`, 'no saved page; run the read below');
    else {
      const stamp = pageStamp(state.pageHtml);
      add(stamp === manifest.release, 'page stamp', stamp === manifest.release ? stamp : `the published page says ${stamp || '(no stamp)'}, the build is ${manifest.release}`);
      if (state.pageFiles) {
        const changed = Object.keys({ ...page.files, ...state.pageFiles }).filter(f => state.pageFiles[f] !== page.files[f]);
        add(changed.length === 0, 'published page files', changed.length ? `${changed.length} differ: ${changed.join(', ')}` : '');
      }
    }
  }

  const tasks = tasksFor(manifest, target);
  if (!state.triggers) add(false, 'scheduled tasks read', 'no saved list_triggers result; run the reads below');
  else for (const [key, t] of tasks) {
    // A task whose pipeline has no steps yet has no prompt in this build: nothing to deploy, so not a difference.
    if (!t.trigger && !t.promptSha256 && t.pipeline) { add(true, `task ${key}`, 'pending: its pipeline has no steps in this build'); continue; }
    if (!t.trigger) { add(false, `task ${key}`, 'not created yet'); continue; }
    const live = state.triggers.find(x => x.id === t.trigger);
    if (!live) { add(false, `task ${key}`, `${t.trigger} not found in the saved task list`); continue; }
    const f = triggerFields(live), diffs = [];
    if (f.name !== t.name) diffs.push(`name "${f.name}", expected "${t.name}"`);
    if (!f.enabled) diffs.push('disabled');
    if (f.schedule !== t.schedule) diffs.push(`schedule ${f.schedule || 'none'}, expected ${t.schedule || 'none'}`);
    if (t.promptSha256 && (f.prompt === null || sha256(f.prompt) !== t.promptSha256)) diffs.push('prompt hash differs from the manifest');
    if (!t.promptSha256 && t.pipeline) diffs.push('no prompt rendered for it in this build (tools/prompts.mjs)');
    if (f.macBound !== t.macBound) diffs.push(t.macBound ? 'not bound to the Mac' : 'bound to a device');
    if (t.macBound && !same(f.folders.slice().sort(), t.folders.slice().sort())) diffs.push(`folders ${JSON.stringify(f.folders)}, expected ${JSON.stringify(t.folders)}`);
    if (f.push !== t.push) diffs.push(`push ${f.push}, expected ${t.push}`);
    add(diffs.length === 0, `task ${key}`, diffs.join('; ') || t.trigger);
  }
  return { green: lines.every(l => l.ok), lines };
}

export function formatVerify(target, result, reads) {
  const bad = result.lines.filter(l => !l.ok).length;
  const out = [`verify-deploy ${target}: ${result.green ? 'GREEN' : `RED (${bad} difference${bad === 1 ? '' : 's'})`}`];
  for (const l of result.lines) out.push(`  ${l.ok ? 'ok ' : 'NO '} ${l.what}${l.detail ? ': ' + l.detail : ''}`);
  if (!result.green && reads && reads.length) {
    out.push('', 'Reads to save, then run verify-deploy again:');
    for (const r of reads) out.push(`  ${r.tool} ${JSON.stringify(r.args)}`, `    -> ${r.save}${r.note ? '  (' + r.note + ')' : ''}`);
  }
  return out.join('\n');
}

/**
 * The calls that make the target match the manifest, in order. versions: {manifest, spec, environments} as the
 * chat's last get printed them (absent: the document does not exist yet). Refuses a dirty or unpushed build, a
 * missing record, live without Matt's OK, and live unless stagingVerify (dist/verify-staging.json) is green at the same
 * commit (B-35). state (optional): the saved verify state, used to skip tasks whose
 * prompt already matches.
 */
export function deployCalls({ manifest, target, distDir, build, versions = {}, mattOk = false, state = null, sha256, stagingVerify = null }) {
  const refusals = [];
  // B-35: the build that goes live has always been through staging: dist/verify-staging.json green at this commit.
  if (target === 'live') {
    const v = stagingVerify;
    if (!v) refusals.push('no dist/verify-staging.json: deploy staging and run verify-deploy staging first');
    else if (v.commit !== manifest.commit) refusals.push(`verify-deploy staging ran at ${String(v.commit).slice(0, 12)}, this build is ${manifest.commit.slice(0, 12)}: deploy staging at this commit first`);
    else if (!v.green) refusals.push(`verify-deploy staging is red at ${manifest.commit.slice(0, 12)}: make it green first`);
  }
  if (manifest.dirty) refusals.push('the build is dirty: commit, push and build again');
  if (!build.pushed) refusals.push(`${manifest.commit.slice(0, 12)} is not pushed to origin/main`);
  if (target === 'live' && !mattOk) refusals.push("a live deploy needs Matt's explicit OK in the chat (then pass --matt-ok)");
  const rec = manifest.records[target];
  if (!rec.artifact) refusals.push(`no ${target} record in spec.registry.records`);
  if (refusals.length) return { ok: false, refusals, calls: [] };

  const calls = []; const skipped = [];
  const writes = SYSTEM_IDS.map(id => {
    const w = { op: 'set', collection: 'system', doc_id: id, file_path: `${distDir}/system/${id}.json` };
    if (versions[id]) w.if_version = versions[id];
    return w;
  });
  calls.push({ step: 'system documents', tool: 'ArtifactData', args: { action: 'batch', url: artifactUrl(rec.artifact), writes } });

  const page = manifest.pages[target];
  const published = state && state.pageFiles && Object.keys(page.files).length && Object.keys({ ...page.files, ...state.pageFiles }).every(f => state.pageFiles[f] === page.files[f]);
  if (published) skipped.push(`${target} page: the published shell and files match this build`);
  if (page.artifact && Object.keys(page.files).length && !published) {
    const [shell, ...rest] = Object.keys(page.files);
    calls.push({ step: 'page', tool: 'Artifact', args: { action: 'publish', url: artifactUrl(page.artifact), file_path: `${distDir}/${shell}`, files: Object.fromEntries(rest.map(f => [f.replace(/^page\/[^/]+\//, ''), `${distDir}/${f}`])), capabilities: page.capabilities } });
  }

  for (const [key, t] of tasksFor(manifest, target)) {
    if (key.startsWith('build.')) continue;
    if (!t.promptSha256) { skipped.push(`${key}: no prompt rendered (tools/prompts.mjs)`); continue; }
    const promptFile = `${distDir}/prompts/${key}.txt`;
    if (!t.trigger) {
      // A Mac-bound task is created only from a chat linked to the Mac with Matt present: printed, marked as such.
      calls.push({ step: `create ${key}${t.macBound ? ' (only from a chat linked to the Mac, with Matt present)' : ''}`, tool: 'mcp__claude-code-remote__create_trigger', args: { name: t.name, prompt: `<the contents of ${promptFile}>`, initiation: 'human_request', ...(t.schedule ? { cron_expression: t.schedule } : {}), notifications: { push: t.push }, requires_local_device: Boolean(t.macBound), ...(t.macBound ? { folders: t.folders } : {}) }, then: `record the returned id as spec.tasks.${key}.trigger, commit, push and build again` });
      continue;
    }
    if (t.macBound) skipped.push(`${key}: Mac-bound; change it only from a chat linked to the Mac, with Matt present`);
    const live = state && state.triggers && state.triggers.find(x => x.id === t.trigger);
    const livePrompt = live && live.derived_state && live.derived_state.prompt;
    if (live && typeof livePrompt === 'string' && sha256(livePrompt) === t.promptSha256) continue;
    if (!t.macBound) calls.push({ step: `update ${key}`, tool: 'mcp__claude-code-remote__update_trigger', args: { trigger_id: t.trigger, prompt: `<the contents of ${promptFile}>` } });
  }
  return { ok: true, refusals: [], calls, skipped };
}

export function formatDeploy(target, result) {
  if (!result.ok) return [`deploy ${target}: REFUSED`, ...result.refusals.map(r => '  ' + r)].join('\n');
  const out = [`deploy ${target}: ${result.calls.length} call${result.calls.length === 1 ? '' : 's'}, in order. Make each exactly as printed, then run verify-deploy ${target}.`];
  result.calls.forEach((c, i) => {
    out.push('', `${i + 1}. ${c.step}: ${c.tool}`, JSON.stringify(c.args, null, 1));
    if (c.then) out.push(`   then ${c.then}`);
  });
  if (result.skipped && result.skipped.length) out.push('', 'Not printed:', ...result.skipped.map(s => '  ' + s));
  return out.join('\n');
}
