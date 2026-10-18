// E.V. read-only Canvas fetch: collect a part started earlier. While it runs, says so; when it is done, returns its
// result padded past the browser tool's inline limit, so the tool saves it to a file and nothing is ever retyped
// (`node core/cli.mjs unwrap <that file> --to <json>`). Printed by `node core/cli.mjs canvas-script poll --of <part>`.
(() => {
  const P = /*@PARAMS*/null;
  const j = (window.__evCanvas || {})[P.part];
  if (!j) return 'not started: run the ' + P.part + ' script first';
  if (j.status === 'running') return 'still running (' + Math.round((Date.now() - j.startedAt) / 1000) + ' s' + (j.at ? ', at ' + j.at : '') + '): poll again in a little while';
  return JSON.stringify({ result: j.status === 'done' ? j.out : { failed: j.error, errors: [j.error] }, _pad: '.'.repeat(90000) });
})()
