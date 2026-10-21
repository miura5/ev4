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
export const pageStamp = html => {
  const m = (html || '').match(STAMP);
  return m ? m[1] : null;
};
const strip = doc => {
  const out = { ...doc };
  for (const k of ENVELOPE) delete out[k];
  return out;
};
// Key order is not meaning: compare documents by their canonical JSON.
export function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object')
    return (
      '{' +
      Object.keys(v)
        .sort()
        .map(k => JSON.stringify(k) + ':' + canonical(v[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(v);
}
const same = (a, b) => canonical(a) === canonical(b);

/**
 * B-63 (D-114): what a deploy carries, as one hash: the release, specVersion, every file hash (the page's included),
 * every task's prompt hash and the spec. Two builds with the same content hash deploy the same thing, whatever their
 * commits.
 */
export function contentHash(manifest, spec, sha256) {
  const prompts = Object.fromEntries(Object.entries(manifest.tasks || {}).map(([k, t]) => [k, t.promptSha256 || null]));
  const pages = Object.fromEntries(Object.entries(manifest.pages || {}).map(([k, p]) => [k, p.files || {}]));
  return sha256(
    canonical({
      release: manifest.release,
      specVersion: manifest.specVersion,
      files: manifest.files,
      prompts,
      pages,
      spec: spec ? strip(spec) : null,
    })
  );
}

// B-28: a page's capability declaration, as the artifact service stores it, compared with the build's as data: an mcp
// server is matched by name and its tools as a set; every other capability by its canonical JSON.
const serverMap = c => Object.fromEntries(((c && c.mcp && c.mcp.servers) || []).map(s => [s.server, s]));
export function capabilityDiffs(stored, built) {
  const diffs = [],
    st = stored || {},
    bu = built || {};
  for (const k of [...new Set([...Object.keys(st), ...Object.keys(bu)])].sort()) {
    if (!(k in bu)) {
      diffs.push(`${k}: stored, not in the build`);
      continue;
    }
    if (!(k in st)) {
      diffs.push(`${k}: in the build, not stored`);
      continue;
    }
    if (k !== 'mcp') {
      if (!same(st[k], bu[k])) diffs.push(`${k}: differs`);
      continue;
    }
    const a = serverMap(st),
      b = serverMap(bu);
    for (const name of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      if (!b[name]) {
        diffs.push(`mcp ${name}: stored, not in the build`);
        continue;
      }
      if (!a[name]) {
        diffs.push(`mcp ${name}: in the build, not stored`);
        continue;
      }
      const ta = new Set(a[name].tools || []),
        tb = new Set(b[name].tools || []);
      const lacks = [...tb].filter(t => !ta.has(t)),
        extra = [...ta].filter(t => !tb.has(t));
      if (lacks.length) diffs.push(`mcp ${name}: stored without ${lacks.join(', ')}`);
      if (extra.length) diffs.push(`mcp ${name}: stored with ${extra.join(', ')}, not in the build`);
      const rest = o => {
        const { server, tools, ...r } = o;
        return r;
      };
      if (!same(rest(a[name]), rest(b[name]))) diffs.push(`mcp ${name}: settings differ`);
    }
  }
  return diffs;
}
/** The host: tools (a local MCP server on Matt's Mac) the build declares that the stored declaration lacks: only a
 *  publish from the Claude desktop app on that Mac can add them (Oct 18: a cloud publish adding them answered 422). */
export function hostToolsToAdd(stored, built) {
  const a = serverMap(stored),
    out = [];
  for (const [name, s] of Object.entries(serverMap(built)))
    if (name.startsWith('host:'))
      for (const t of s.tools || []) if (!(a[name] && (a[name].tools || []).includes(t))) out.push(`${name} ${t}`);
  return out;
}
const hostServers = c => Object.keys(serverMap(c)).filter(n => n.startsWith('host:'));
/** spec.tasks.retired, from the built system/spec (envelope and all). */
const retiredOf = dist =>
  dist && dist.spec && dist.spec.tasks && Array.isArray(dist.spec.tasks.retired) ? dist.spec.tasks.retired : [];

/** The tasks a target's verify and deploy cover: that target's pipeline tasks, plus the build tasks on staging. */
export function tasksFor(manifest, target) {
  return Object.entries(manifest.tasks).filter(
    ([key, t]) => t.record === target || (target === 'staging' && key.startsWith('build.'))
  );
}

/** The reads a build chat makes and where it saves each result, so verify can diff them. */
export function verifyReads({ manifest, target, stateDir }) {
  const rec = manifest.records[target];
  const reads = [
    {
      tool: 'mcp__claude-code-remote__list_triggers',
      args: { limit: 100, enabled: true },
      save: `${stateDir}/triggers-1.json`,
      note: `Enabled tasks only: a task absent from it is disabled or spent. Save it with node tools/tool-result.mjs list_triggers ${stateDir}/triggers-1.json (copies the result from this session's transcript; never retype it). When it has a next_cursor, call again with cursor and save triggers-2.json the same way, and so on; remove pages left from an earlier, longer read.`,
    },
  ];
  if (rec.artifact) {
    for (const id of readIds(target))
      reads.push({
        tool: 'ArtifactData',
        args: {
          action: 'get',
          url: artifactUrl(rec.artifact),
          collection: 'system',
          doc_id: id,
          out_dir: `${stateDir}/record`,
        },
        save: `${stateDir}/record/system/${id}.json`,
        note: 'Saved by the tool; note the version it prints for deploy --version.',
      });
    const page = manifest.pages[target];
    if (page.artifact)
      reads.push({
        tool: 'Artifact',
        args: { action: 'read', url: artifactUrl(page.artifact) },
        save: `${stateDir}/page.html`,
        note: `Save it with node tools/tool-result.mjs Artifact ${stateDir}/page.html --html (or copy the file the read names, when it names one), and its stored capability declaration with node tools/tool-result.mjs Artifact ${stateDir}/page-declaration.json --declaration.`,
      });
    const published = Object.keys(page.files)
      .slice(1)
      .map(f => f.replace(/^page\/[^/]+\//, ''));
    if (page.artifact && published.length)
      reads.push({
        tool: 'Artifact',
        args: { action: 'read', url: artifactUrl(page.artifact), paths: published, out_dir: `${stateDir}/page-files` },
        save: `${stateDir}/page-files/`,
        note: 'Saved by the tool, one file per published path. The shell is held by the page read above: publishing wraps it, so the read must contain the built shell verbatim.',
      });
  }
  return reads;
}

function triggerFields(t) {
  const ds = t.derived_state || {};
  return {
    name: t.name,
    enabled: t.enabled,
    schedule: t.cron_expression || null,
    prompt: typeof ds.prompt === 'string' ? ds.prompt : null,
    // list_triggers does not report the bound device (Oct 18: both Mac tasks ran on the Mac with "Require this
    // computer" on, yet showed no bound_device); attached folders exist only on a task that requires the computer.
    macBound: Boolean(t.bound_device_uuid || t.bound_device || ds.folders_state === 'FOLDERS_STATE_PRESENT'),
    folders: ds.folders || [],
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

  add(
    !manifest.dirty,
    'build is clean',
    manifest.dirty
      ? 'dist/manifest.json was built from a dirty tree'
      : `${manifest.release} at ${manifest.commit.slice(0, 12)}`
  );
  add(
    build.pushed,
    'build commit is pushed',
    build.pushed
      ? ''
      : `${manifest.commit.slice(0, 12)} is not on origin/main; scheduled runs check out pushed commits only`
  );

  if (!rec.artifact)
    add(false, `${target} record exists`, `no ${target} record in spec.registry.records (created in B-12)`);
  else if (!state.record) add(false, `${target} record read`, 'no saved system/* documents; run the reads below');
  else {
    const live = state.record;
    if (!live.manifest) add(false, 'system/manifest deployed', 'absent from the record');
    else {
      for (const k of ['release', 'specVersion'])
        add(
          live.manifest[k] === manifest[k],
          `system/manifest ${k}`,
          live.manifest[k] === manifest[k] ? manifest[k] : `record ${live.manifest[k]}, build ${manifest[k]}`
        );
      const changed = Object.keys({ ...manifest.files, ...(live.manifest.files || {}) }).filter(
        f => (live.manifest.files || {})[f] !== manifest.files[f]
      );
      // B-63 (D-114): content, not commit. An older deployed commit is green when it is an ancestor of this build and
      // everything it carries is the same (files, prompts, spec, environments): the commits between changed notes only.
      if (live.manifest.commit === manifest.commit) add(true, 'system/manifest commit', manifest.commit);
      else {
        const behind = typeof build.behind === 'function' ? build.behind(live.manifest.commit) : null;
        const prompts = Object.keys({ ...manifest.tasks, ...(live.manifest.tasks || {}) }).filter(
          k => ((live.manifest.tasks || {})[k] || {}).promptSha256 !== (manifest.tasks[k] || {}).promptSha256
        );
        const sameDocs = ['spec', 'environments'].every(id => live[id] && same(strip(live[id]), strip(dist[id])));
        const content =
          !changed.length &&
          !prompts.length &&
          sameDocs &&
          live.manifest.release === manifest.release &&
          live.manifest.specVersion === manifest.specVersion;
        add(
          behind != null && content,
          'system/manifest commit',
          behind == null
            ? `record ${live.manifest.commit}, build ${manifest.commit}${typeof build.behind === 'function' ? ' (not an ancestor of this build)' : ''}`
            : content
              ? `deployed ${live.manifest.commit.slice(0, 7)}, ${behind} notes-only commit${behind === 1 ? '' : 's'} behind`
              : `record ${live.manifest.commit.slice(0, 7)} is ${behind} commit${behind === 1 ? '' : 's'} behind and its content differs${prompts.length ? ` (prompts: ${prompts.slice(0, 3).join(', ')})` : ''}`
        );
      }
      // B-110: every scheduled run checks the deployed commit out of a clone of main only spec.constants.runs.cloneDepth
      // deep, so record commits can push it out of reach. D-170 (B-132): the gate then checks the same content at the
      // clone's head and goes on, so the distance is a note, never a red; only a commit absent from origin/main is.
      if (typeof build.behindMain === 'function') {
        const R = (((dist && dist.spec) || {}).constants || {}).runs || {};
        const depth = R.cloneDepth || 50;
        const n = build.behindMain(live.manifest.commit);
        add(
          n != null,
          "deployed commit within the runs' clone",
          n == null
            ? `${live.manifest.commit.slice(0, 7)} is not on origin/main`
            : `${n} commit${n === 1 ? '' : 's'} behind origin/main; runs clone ${depth} deep` +
                (n >= depth ? "; past it, the gate checks the same content at the clone's head (D-170)" : '')
        );
      }
      add(
        changed.length === 0,
        'system/manifest file hashes',
        changed.length
          ? `${changed.length} differ: ${changed.slice(0, 5).join(', ')}`
          : `${Object.keys(manifest.files).length} files`
      );
      add(live.manifest.dirty === false, 'system/manifest is clean');
    }
    for (const id of ['spec', 'environments']) {
      if (!live[id]) add(false, `system/${id} deployed`, 'absent from the record');
      else
        add(
          same(strip(live[id]), strip(dist[id])),
          `system/${id} matches the build`,
          same(strip(live[id]), strip(dist[id])) ? '' : 'its content differs from dist/system/' + id + '.json'
        );
    }
    if (target === 'staging') {
      const seed = live.seed;
      if (!seed || !seed.exportedAt) add(false, 'staging seed', 'no system/seed: run seed-staging');
      else {
        const days = Math.max(0, Math.floor((Date.parse(now) - Date.parse(seed.exportedAt)) / 864e5));
        const docs = Object.values(seed.counts || {}).reduce((n, c) => n + c, 0);
        add(
          true,
          'staging seed',
          `${docs} documents from a ${seed.from || 'live export'} taken ${seed.exportedAt.slice(0, 10)}, ${days} day${days === 1 ? '' : 's'} old`
        );
      }
    }
  }

  const page = manifest.pages[target];
  if (page.artifact || Object.keys(page.files).length) {
    if (state.pageHtml == null) add(false, `${target} page read`, 'no saved page; run the read below');
    else {
      const stamp = pageStamp(state.pageHtml);
      add(
        stamp === manifest.release,
        'page stamp',
        stamp === manifest.release
          ? stamp
          : `the published page says ${stamp || '(no stamp)'}, the build is ${manifest.release}`
      );
      if (state.pageFiles) {
        const changed = Object.keys({ ...page.files, ...state.pageFiles }).filter(
          f => state.pageFiles[f] !== page.files[f]
        );
        add(
          changed.length === 0,
          'published page files',
          changed.length ? `${changed.length} differ: ${changed.join(', ')}` : ''
        );
      }
      // B-28: the capability declaration the artifact service holds, against the build's (manifest.pages.<target>).
      if (page.capabilities) {
        if (state.pageDeclaration == null)
          add(
            false,
            'page capability declaration',
            "not saved: save the page read's <artifact-stored-declaration> (tool-result --declaration)"
          );
        else {
          const d = capabilityDiffs(state.pageDeclaration, page.capabilities),
            adds = hostToolsToAdd(state.pageDeclaration, page.capabilities);
          add(
            d.length === 0,
            'page capability declaration',
            d.length
              ? d.join('; ') +
                  (adds.length ? ' (adding host: tools takes a publish from the Claude desktop app on the Mac)' : '')
              : Object.keys(page.capabilities).sort().join(', ')
          );
        }
      }
    }
  }

  const tasks = tasksFor(manifest, target);
  if (!state.triggers) add(false, 'scheduled tasks read', 'no saved list_triggers result; run the reads below');
  else
    for (const [key, t] of tasks) {
      // A task whose pipeline has no steps yet has no prompt in this build: nothing to deploy, so not a difference.
      if (!t.trigger && !t.promptSha256 && t.pipeline) {
        add(true, `task ${key}`, 'pending: its pipeline has no steps in this build');
        continue;
      }
      if (!t.trigger) {
        add(false, `task ${key}`, 'not created yet');
        continue;
      }
      const live = state.triggers.find(x => x.id === t.trigger);
      if (!live) {
        add(
          false,
          `task ${key}`,
          `${t.trigger} not found in the saved task list (disabled, spent or gone: the read lists enabled tasks only)`
        );
        continue;
      }
      const f = triggerFields(live),
        diffs = [];
      if (f.name !== t.name) diffs.push(`name "${f.name}", expected "${t.name}"`);
      if (!f.enabled) diffs.push('disabled');
      if (f.schedule !== t.schedule) diffs.push(`schedule ${f.schedule || 'none'}, expected ${t.schedule || 'none'}`);
      if (t.promptSha256 && (f.prompt === null || sha256(f.prompt) !== t.promptSha256))
        diffs.push('prompt hash differs from the manifest');
      if (!t.promptSha256 && t.pipeline) diffs.push('no prompt rendered for it in this build (tools/prompts.mjs)');
      if (f.macBound !== t.macBound) diffs.push(t.macBound ? 'not bound to the Mac' : 'bound to a device');
      if (t.macBound && !same(f.folders.slice().sort(), t.folders.slice().sort()))
        diffs.push(`folders ${JSON.stringify(f.folders)}, expected ${JSON.stringify(t.folders)}`);
      if (f.push !== t.push) diffs.push(`push ${f.push}, expected ${t.push}`);
      add(diffs.length === 0, `task ${key}`, diffs.join('; ') || t.trigger);
    }

  // B-28: every retired task stays disabled (kept, never deleted). The saved read lists enabled tasks only, so a
  // retired id found in it is enabled; one absent is disabled or a spent one-shot.
  const retired = retiredOf(dist);
  if (retired.length) {
    if (!state.triggers) add(false, 'retired tasks disabled', 'no saved list_triggers result; run the reads below');
    else {
      const on = retired.filter(r => {
        const t = state.triggers.find(x => x.id === r.trigger);
        return t && t.enabled !== false;
      });
      add(
        on.length === 0,
        'retired tasks disabled',
        on.length
          ? on.map(r => `${r.name} (${r.trigger}) is enabled`).join('; ')
          : `${retired.length} retired, none enabled`
      );
    }
  }
  return { green: lines.every(l => l.ok), lines };
}

export function formatVerify(target, result, reads) {
  const bad = result.lines.filter(l => !l.ok).length;
  const out = [`verify-deploy ${target}: ${result.green ? 'GREEN' : `RED (${bad} difference${bad === 1 ? '' : 's'})`}`];
  for (const l of result.lines) out.push(`  ${l.ok ? 'ok ' : 'NO '} ${l.what}${l.detail ? ': ' + l.detail : ''}`);
  if (!result.green && reads && reads.length) {
    out.push('', 'Reads to save, then run verify-deploy again:');
    for (const r of reads)
      out.push(`  ${r.tool} ${JSON.stringify(r.args)}`, `    -> ${r.save}${r.note ? '  (' + r.note + ')' : ''}`);
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
/** B-87: the sessions a deploy would interrupt: active or ending, with activity in the last 45 minutes (an abandoned
 * session left active does not block deploys forever). */
export function liveSessions(running, nowMs) {
  const t = v => {
    const n = Date.parse(v);
    return Number.isFinite(n) ? n : null;
  };
  return ((running && running.sessions) || [])
    .filter(s => ['active', 'ending'].includes(s.status))
    .map(s => {
      const times = [
        t(s.startedAt),
        t(s.driver && s.driver.at),
        ...Object.entries(s.events || {}).map(
          ([k, e]) =>
            t(e && e.at) ||
            t(String(k).replace(/^[a-z-]+-(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)(\d\d).*$/, '$1-$2-$3T$4:$5:$6Z'))
        ),
      ].filter(x => x != null);
      return {
        id: s.id,
        topic: s.topic || s.id,
        kind: s.kind || 'note',
        startedAt: s.startedAt,
        lastMs: times.length ? Math.max(...times) : null,
      };
    })
    .filter(s => s.lastMs != null && nowMs - s.lastMs < 45 * 60e3);
}
export const RUNNING_READ = (stateDir, url) =>
  `read the live record's running sessions first: ArtifactData query on ${url} collection "sessions" with query {"where": [["status", "in", ["active", "ending"]]], "limit": 20} and out_dir ${stateDir}/running (empty that folder first), then: node tools/tool-result.mjs ArtifactData ${stateDir}/running.txt`;

export function deployCalls({
  manifest,
  target,
  distDir,
  build,
  versions = {},
  mattOk = false,
  state = null,
  sha256,
  stagingVerify = null,
  duringSession = false,
  now = Date.now(),
  stateDir = null,
}) {
  const refusals = [];
  // B-87 (Matt, Oct 19): a live deploy can reload his page, so it waits while a study session or skills run is going.
  if (target === 'live' && !duringSession) {
    const r = state && state.running;
    const url = artifactUrl((manifest.records.live || {}).artifact || '');
    if (!r || now - r.readAt > 15 * 60e3)
      refusals.push(
        RUNNING_READ(stateDir || `${distDir}/state/live`, url) +
          (r ? ` (the saved read is ${Math.round((now - r.readAt) / 60e3)} min old)` : '')
      );
    else
      for (const s of liveSessions(r, now))
        refusals.push(
          `a ${s.kind === 'skill' ? 'skills run' : 'study session'} is running on live ("${String(s.topic).slice(0, 60)}", last activity ${Math.round((now - s.lastMs) / 60e3)} min ago): deploy after it ends, or pass --during-session with Matt's explicit OK`
        );
  }
  // B-35: the build that goes live has always been through staging: dist/verify-staging.json green at this commit.
  if (target === 'live') {
    const v = stagingVerify;
    if (!v) refusals.push('no dist/verify-staging.json: deploy staging and run verify-deploy staging first');
    // B-63: the same content passes even at another commit (a notes-only commit since); a verify saved before content
    // hashes existed is held to the commit.
    else if (v.contentHash ? v.contentHash !== (build.contentHash || null) : v.commit !== manifest.commit)
      refusals.push(
        v.contentHash
          ? `verify-deploy staging ran on other content (at ${String(v.commit).slice(0, 12)}): deploy staging with this build's content first`
          : `verify-deploy staging ran at ${String(v.commit).slice(0, 12)}, this build is ${manifest.commit.slice(0, 12)}: deploy staging at this commit first`
      );
    else if (!v.green)
      refusals.push(`verify-deploy staging is red at ${manifest.commit.slice(0, 12)}: make it green first`);
  }
  if (manifest.dirty) refusals.push('the build is dirty: commit, push and build again');
  if (!build.pushed) refusals.push(`${manifest.commit.slice(0, 12)} is not pushed to origin/main`);
  if (target === 'live' && !mattOk)
    refusals.push("a live deploy needs Matt's explicit OK in the chat (then pass --matt-ok)");
  const rec = manifest.records[target];
  if (!rec.artifact) refusals.push(`no ${target} record in spec.registry.records`);
  if (refusals.length) return { ok: false, refusals, calls: [] };

  const calls = [];
  const skipped = [];
  const writes = SYSTEM_IDS.map(id => {
    const w = { op: 'set', collection: 'system', doc_id: id, file_path: `${distDir}/system/${id}.json` };
    if (versions[id]) w.if_version = versions[id];
    return w;
  });
  calls.push({
    step: 'system documents',
    tool: 'ArtifactData',
    args: { action: 'batch', url: artifactUrl(rec.artifact), writes },
  });

  const page = manifest.pages[target];
  const declared = state && state.pageDeclaration;
  const declarationOk = !declared || !page.capabilities || capabilityDiffs(declared, page.capabilities).length === 0;
  const published =
    state &&
    state.pageFiles &&
    Object.keys(page.files).length &&
    Object.keys({ ...page.files, ...state.pageFiles }).every(f => state.pageFiles[f] === page.files[f]) &&
    declarationOk;
  if (published) skipped.push(`${target} page: the published shell, files and capability declaration match this build`);
  if (page.artifact && Object.keys(page.files).length && !published) {
    const [shell, ...rest] = Object.keys(page.files);
    // B-28: a host: server's tools are added only by a publish from the Claude desktop app on the Mac that runs it.
    const adds = declared
      ? hostToolsToAdd(declared, page.capabilities)
      : hostServers(page.capabilities).map(n => n + ' (stored declaration not saved)');
    const where = adds.length
      ? ` (from the Claude desktop app on the Mac${target === 'live' ? ", with Matt's OK" : ''}: a cloud session cannot add ${adds.join(', ')})`
      : '';
    calls.push({
      step: 'page' + where,
      tool: 'Artifact',
      args: {
        action: 'publish',
        url: artifactUrl(page.artifact),
        file_path: `${distDir}/${shell}`,
        files: Object.fromEntries(rest.map(f => [f.replace(/^page\/[^/]+\//, ''), `${distDir}/${f}`])),
        capabilities: page.capabilities,
      },
    });
    if (adds.length && declared)
      skipped.push(
        `${target} page from a cloud session: the same publish with capabilities exactly as stored (state/${target}/page-declaration.json) ships the files; verify-deploy stays red on the declaration until the desktop-app publish`
      );
  }

  for (const [key, t] of tasksFor(manifest, target)) {
    if (key.startsWith('build.')) continue;
    if (!t.promptSha256) {
      skipped.push(`${key}: no prompt rendered (tools/prompts.mjs)`);
      continue;
    }
    const promptFile = `${distDir}/prompts/${key}.txt`;
    if (!t.trigger) {
      // A Mac-bound task is created only from a chat linked to the Mac with Matt present: printed, marked as such.
      calls.push({
        step: `create ${key}${t.macBound ? ' (only from a chat linked to the Mac, with Matt present)' : ''}`,
        tool: 'mcp__claude-code-remote__create_trigger',
        args: {
          name: t.name,
          prompt: `<the contents of ${promptFile}>`,
          initiation: 'human_request',
          ...(t.schedule ? { cron_expression: t.schedule } : {}),
          notifications: { push: t.push },
          requires_local_device: Boolean(t.macBound),
          ...(t.macBound ? { folders: t.folders } : {}),
        },
        then: `record the returned id as spec.tasks.${key}.trigger, commit, push and build again`,
      });
      continue;
    }
    const live = state && state.triggers && state.triggers.find(x => x.id === t.trigger);
    const livePrompt = live && live.derived_state && live.derived_state.prompt;
    const promptSame = live && typeof livePrompt === 'string' && sha256(livePrompt) === t.promptSha256;
    // B-149: a task's name carries the minor version, so a release renames it. A name changes freely from the
    // cloud, a Mac-bound task's too, but changing a Mac-bound task at all needs Matt's explicit OK in a build chat.
    const rename = live && live.name !== t.name ? { name: t.name } : {};
    if (t.macBound) {
      if (!promptSame)
        skipped.push(`${key}: Mac-bound; its prompt changes only from a chat linked to the Mac, with Matt present`);
      if (rename.name)
        calls.push({
          step: `rename ${key} (Mac-bound: the name alone, without the prompt, and only on Matt's explicit OK)`,
          tool: 'mcp__claude-code-remote__update_trigger',
          args: { trigger_id: t.trigger, ...rename },
        });
      continue;
    }
    if (promptSame && !rename.name) continue;
    calls.push({
      step: `update ${key}`,
      tool: 'mcp__claude-code-remote__update_trigger',
      args: { trigger_id: t.trigger, ...rename, ...(promptSame ? {} : { prompt: `<the contents of ${promptFile}>` }) },
    });
  }
  return { ok: true, refusals: [], calls, skipped };
}

export function formatDeploy(target, result) {
  if (!result.ok) return [`deploy ${target}: REFUSED`, ...result.refusals.map(r => '  ' + r)].join('\n');
  const out = [
    `deploy ${target}: ${result.calls.length} call${result.calls.length === 1 ? '' : 's'}, in order. Make each exactly as printed, then run verify-deploy ${target}.`,
  ];
  result.calls.forEach((c, i) => {
    out.push('', `${i + 1}. ${c.step}: ${c.tool}`, JSON.stringify(c.args, null, 1));
    if (c.then) out.push(`   then ${c.then}`);
  });
  if (result.skipped && result.skipped.length) out.push('', 'Not printed:', ...result.skipped.map(s => '  ' + s));
  return out.join('\n');
}
