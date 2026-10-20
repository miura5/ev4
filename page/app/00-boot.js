// E.V. Home page logic (published beside the shell as app.js). The shell loads it after core.js and spec.json, checks
// the owner and subscribes to the record; this file owns everything the page shows and does. Ported from v3's page
// (ev-core page/ev-home.src.html) onto v4's documents: answers in answers/<setId>, the page's hand edits in Edit
// documents replaced whole (dayedits, dateedits, planedits, materialedits), envelopes on everything it creates,
// appended maps keyed <writer>-<time>, nothing derived stored. Rules stay in E.V. core.
//   EVApp.boot({spec, db, use, record, say}) -> {changed(key, value), lost(key, error)}
(function () {
  'use strict';
  const VERSION = 'v4.0.0';

  function boot({ spec, db, use, say }) {
    const EV_SPEC = spec;
    const EV_BUILD = VERSION;
    const E = window.EVCore;
    E.configure(spec);
