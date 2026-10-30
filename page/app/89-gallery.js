    // ------------------------------------------------------------ the Gallery (B-506, D-371, D-383): staging only
    // Proprietary's reference page, built from this same app.js and styles.css: the tuner and its recipe, every colour
    // token in both modes at the three contrasts with its ratio, the type ramp at text size 1 and 1.25, the space, radius,
    // elevation and motion scales, a slot for each of the 16 components (B-504) with today's kit helpers in their states
    // until B-507 and B-508 fill them (each component's own cells in page/app/89-gallery-NN-<name>.js, D-388), and the
    // patterns on made-up data. Its address is /gallery on staging (the app's own page, signed in as staging always is;
    // tools/build-pwa.mjs writes it), or ?gallery and #gallery on the app; it opens over the app. The build leaves every
    // page/app/89-gallery*.js and page/ds/gallery.css out of live's app.js and styles.css (STAGING_ONLY), and live has
    // no /gallery, so live has no Gallery at all. test/harness/components.cjs is its harness. Nothing here reads or
    // writes the record: every row it shows is made up below.
    const GALLERY = { open: false, root: null, recipe: null, contrast: 60, mode: null, was: null, inert: null };
    const GAL_PATH = /\/gallery(\.html)?$/;
    const galleryAsked = () =>
      EV_SPEC.target === 'staging' &&
      (GAL_PATH.test(location.pathname) || /[?&]gallery\b/.test(location.search) || location.hash === '#gallery');
    // The colour tokens the generator writes, each with the ground it is read on and the floor it holds (D-273).
    const GAL_INK = [
      ['--text', '--surface', 4.5, 'Primary ink'],
      ['--quiet', '--surface', 4.5, 'Secondary ink'],
      ['--faint', '--chrome', 4.6, 'Tertiary ink, on chrome'],
      ['--faint', '--surface', 4.6, 'Tertiary ink, on surface'],
      ['--focus', '--surface', 3, 'Focus ring'],
      ['--her', '--surface', 3, 'Ember, her accent'],
      ['--her2', '--surface', 3, 'Ember, second'],
      ['--on-her', '--her', 4.5, 'Ink on Ember'],
      ['--av1', '--surface', 3, 'Her solid face'],
      ['--av2', '--surface', 3, 'Her halftone face'],
      ['--quiet', '--raise', 4.5, 'Secondary ink, on a raised band'],
      ['--quiet', '--sel', 4.5, 'Secondary ink, on the selected row'],
      // B-540 (D-395): each coded colour with the kinds it marks (tokens.css --kind-*)
      ['--ok', '--surface', 3, 'Coded: done, right; kind Class, Workout'],
      ['--warn', '--surface', 3, 'Coded: almost, attention; kind Skills prep'],
      ['--bad', '--surface', 3, 'Coded: urgent, wrong; kind Graded'],
      ['--info', '--surface', 3, 'Coded: information; kind Learn, Reading'],
      ['--violet', '--surface', 3, 'Coded: study; kind Practice, Session, Flashcards'],
      ['--teal', '--surface', 3, 'Kind Review, Quiz'],
      ['--slate', '--surface', 3, 'Kind Note'],
    ];
    const GAL_GROUND = [
      ['--bg', 'Canvas'],
      ['--chrome', 'Recessed chrome'],
      ['--surface', 'Raised surface'],
      ['--raise', 'Raised band, group'],
      ['--hover', 'Hover fill'],
      ['--sel', 'Selected, pressed'],
      ['--line', 'Quiet divider'],
      ['--line2', 'Control border'],
    ];
    // The 18 components (B-504's final list, and B-515's Table and Chart): each slot's name, the batch that builds it, its states and what it is, in
    // plain words.
    const GAL_COMPONENTS = [
      ['button', 'Button', 'B-507', 'rest, hover, pressed, focus, disabled, busy', 'What you tap to do one thing.'],
      [
        'badge',
        'Badge',
        'B-507',
        'neutral and five coded tones, course',
        'A small label that says what kind or what state a row is.',
      ],
      [
        'chip',
        'Chip',
        'B-507',
        'rest, hover, pressed, on, disabled',
        'A small tap-able word, like a filter or a quick ask.',
      ],
      [
        'segmented',
        'Segmented',
        'B-507',
        'selected, focus, scrolls on overflow',
        'A row of choices where exactly one is picked.',
      ],
      [
        'line',
        'Line',
        'B-507',
        'rest, hover, pressed, open, done, urgent, disabled, dragging',
        'One row in a list: a task, a note, a weak spot.',
      ],
      ['fold', 'Fold', 'B-507', 'closed, open', 'A heading that opens to show more beneath it.'],
      ['card', 'Card', 'B-507', 'plain, quiet, fold', 'A box that holds one thing on a screen.'],
      [
        'notice',
        'Notice',
        'B-507',
        'empty, info, working, failed',
        'The line that shows when a list is empty, busy or failed.',
      ],
      [
        'toast',
        'Toast',
        'B-507',
        'shows, hides after 2.6 s, with Undo',
        'A short message that shows after you do something, then goes.',
      ],
      [
        'sheet',
        'Sheet',
        'B-508',
        'opening, open, closing; sheet and confirm',
        'A panel that slides up for a form or a confirm.',
      ],
      ['popover', 'Popover', 'B-508', 'open, closed, light dismiss', 'A small menu that opens beside its button.'],
      [
        'field',
        'Field',
        'B-508',
        'rest, focus, invalid, disabled, saving, saved',
        'A box you type in, with its label and any error.',
      ],
      [
        'choice',
        'Choice',
        'B-508',
        'rest, selected, correct, wrong, revealed, disabled',
        'The answer options in a quiz or flashcard.',
      ],
      ['meter', 'Meter', 'B-508', 'empty, partial, complete', 'A bar or number that shows progress.'],
      [
        'presence',
        'Presence',
        'B-508',
        'idle, thinking, speaking, quiet, loading',
        'E.V. herself, idle, thinking or speaking.',
      ],
      [
        'message',
        'Message',
        'B-508',
        'pending, streaming, sent, failed',
        'One line in the conversation, hers or yours.',
      ],
      [
        'table',
        'Table',
        'B-515',
        'rest, checked right and wrong',
        'A small grid of rows and columns, like a matrix question.',
      ],
      ['chart', 'Chart', 'B-515', 'bars, empty days', 'A row of bars, like the week chart E.V. shows.'],
    ];
    // D-388: each component's own state cells, galDs<Name>() in page/app/89-gallery-NN-<name>.js, filled by the lane that
    // builds the component; a slot shows them once DS has that component, and today's kit helpers until then.
    const GAL_DS = {
      button: typeof galDsButton === 'function' ? galDsButton : undefined,
      badge: typeof galDsBadge === 'function' ? galDsBadge : undefined,
      chip: typeof galDsChip === 'function' ? galDsChip : undefined,
      segmented: typeof galDsSegmented === 'function' ? galDsSegmented : undefined,
      line: typeof galDsLine === 'function' ? galDsLine : undefined,
      fold: typeof galDsFold === 'function' ? galDsFold : undefined,
      card: typeof galDsCard === 'function' ? galDsCard : undefined,
      notice: typeof galDsNotice === 'function' ? galDsNotice : undefined,
      toast: typeof galDsToast === 'function' ? galDsToast : undefined,
      sheet: typeof galDsSheet === 'function' ? galDsSheet : undefined,
      popover: typeof galDsPopover === 'function' ? galDsPopover : undefined,
      field: typeof galDsField === 'function' ? galDsField : undefined,
      choice: typeof galDsChoice === 'function' ? galDsChoice : undefined,
      meter: typeof galDsMeter === 'function' ? galDsMeter : undefined,
      presence: typeof galDsPresence === 'function' ? galDsPresence : undefined,
      message: typeof galDsMessage === 'function' ? galDsMessage : undefined,
      // table: shown as today's version (galToday): its 20 px radios are under the 44 px target until Study moves
      chart: typeof galDsChart === 'function' ? galDsChart : undefined,
    };
    const GAL_ICO = 'M5 12l5 5 9-10';
    function galIcon(d = GAL_ICO) {
      const ns = 'http://www.w3.org/2000/svg';
      const s = document.createElementNS(ns, 'svg');
      s.setAttribute('viewBox', '0 0 24 24');
      s.setAttribute('aria-hidden', 'true');
      const p = document.createElementNS(ns, 'path');
      p.setAttribute('d', d);
      s.append(p);
      return s;
    }
    // The Gallery's own headings: role=heading on a div, so legacy's h1 to h4 sizes (which win over the views layer)
    // leave the page's own type alone; today's components keep their real headings.
    function galHead(level, cls, text) {
      const h = el('div', cls, text);
      h.setAttribute('role', 'heading');
      h.setAttribute('aria-level', String(level));
      return h;
    }
    function galSec(id, title, lead) {
      const s = el('section', 'gal-sec');
      s.dataset.galSec = id;
      s.setAttribute('aria-labelledby', 'gal-h-' + id);
      const h = galHead(2, 'gal-h', title);
      h.id = 'gal-h-' + id;
      s.append(h);
      if (lead) s.append(el('p', 'gal-lead', lead));
      return s;
    }
    // A switch of today's kind (the B-285 seg): one picked option, named by aria-pressed.
    function galSeg(label, opts, picked, onPick) {
      const g = el('div', 'seg');
      g.setAttribute('role', 'group');
      g.setAttribute('aria-label', label);
      for (const o of opts) {
        const b = el('button', null, String(o));
        b.type = 'button';
        b.setAttribute('aria-pressed', String(o === picked));
        if (onPick) b.addEventListener('click', () => onPick(o));
        g.append(b);
      }
      return g;
    }
    function galCell(state, node) {
      const c = el('div', 'gal-cell');
      c.append(node, el('span', 'gal-state', state));
      return c;
    }
    // ---- Inputs and the tuner
    // The tuner's inputs, painted on the whole page; a slider repaints only Colour, so the drag keeps its thumb.
    function galTheme(all = true) {
      EVTheme.apply(document, GALLERY.contrast, null, GALLERY.recipe);
      if (GALLERY.mode) document.documentElement.setAttribute('data-theme', GALLERY.mode);
      if (all) return galPaint();
      const old = GALLERY.root && GALLERY.root.querySelector('[data-gal-sec="colour"]');
      if (old) old.replaceWith(galColour());
    }
    function galTuner() {
      const s = galSec(
        'tuner',
        'Inputs',
        'Inputs: the few settings every colour is made from; move one and this page follows, nothing is saved.'
      );
      const r = EVTheme.recipeOf(GALLERY.recipe);
      const grid = el('div', 'gal-tuner');
      const slider = (label, path, min, max, step) => {
        const w = el('label', 'gal-knob');
        const [k1, k2] = path;
        const v = el('span', 'gal-val', String(r[k1][k2]));
        const i = el('input', 'gal-range');
        Object.assign(i, { type: 'range', min, max, step, value: r[k1][k2] });
        i.addEventListener('input', () => {
          r[k1][k2] = Number(i.value);
          GALLERY.recipe = EVTheme.recipeOf(r);
          v.textContent = i.value;
          galTheme(false);
        });
        w.append(el('span', 'gal-knob-l', label), i, v);
        return w;
      };
      grid.append(
        slider('Base hue', ['base', 'h'], 0, 360, 1),
        slider('Base chroma', ['base', 'c'], 0, 12, 0.1),
        slider('Accent hue', ['accent', 'h'], 0, 360, 1),
        slider('Accent chroma', ['accent', 'c'], 20, 80, 1)
      );
      const sw = el('div', 'gal-row');
      sw.append(
        galSeg('Contrast', EVTheme.CONTRASTS, GALLERY.contrast, c => {
          GALLERY.contrast = c;
          galTheme();
        }),
        galSeg('Mode', ['Light', 'Dark'], galMode() === 'light' ? 'Light' : 'Dark', m => {
          GALLERY.mode = m.toLowerCase();
          galTheme();
        })
      );
      const out = el('pre', 'gal-recipe');
      out.setAttribute('aria-label', 'Recipe');
      out.hidden = true;
      const acts = el('div', 'gal-row');
      acts.append(
        btn('Export recipe', () => {
          const json = JSON.stringify(
            { ...EVTheme.recipeOf(GALLERY.recipe), contrast: GALLERY.contrast, mode: galMode() },
            null,
            1
          );
          out.textContent = json;
          out.hidden = false;
          try {
            navigator.clipboard.writeText(json).catch(() => {});
          } catch (e) {
            /* no clipboard here: the recipe still shows */
          }
        }),
        btn(
          'Back to Ember',
          () => {
            GALLERY.recipe = null;
            GALLERY.contrast = 60;
            galTheme();
          },
          { cls: 'btn ghost' }
        )
      );
      s.append(grid, sw, acts, out);
      return s;
    }
    const galMode = () =>
      GALLERY.mode ||
      document.documentElement.getAttribute('data-theme') ||
      (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    // ---- Colour
    function galColour() {
      const s = galSec(
        'colour',
        'Colour',
        'Colour: every colour E.V. uses, light and dark at each contrast, with how readable each is (below means under its floor).'
      );
      for (const mode of ['light', 'dark']) {
        const sets = EVTheme.CONTRASTS.map(c => EVTheme.vars(EVTheme.genTheme(mode, c, GALLERY.recipe)));
        const t = el('div', 'gal-colours');
        t.setAttribute('role', 'table');
        t.setAttribute('aria-label', 'Colour, ' + mode);
        const head = el('div', 'gal-crow gal-chead');
        head.setAttribute('role', 'row');
        head.append(el('span', 'gal-cname', mode === 'light' ? 'Light' : 'Dark'));
        for (const c of EVTheme.CONTRASTS) head.append(el('span', 'gal-cval', String(c)));
        t.append(head);
        const line = (name, note, cells) => {
          const r = el('div', 'gal-crow');
          r.setAttribute('role', 'row');
          const n = el('span', 'gal-cname');
          n.append(el('code', null, name), el('span', 'gal-cnote', note));
          r.append(n, ...cells);
          t.append(r);
        };
        const cell = (fill, text) => {
          const c = el('span', 'gal-cval');
          const sw = el('i', 'gal-sw');
          sw.style.setProperty('--sw', fill);
          c.append(sw, el('span', null, text));
          return c;
        };
        for (const [name, note] of GAL_GROUND)
          line(
            name,
            note,
            sets.map(v => {
              const r = EVTheme.cratio(v['--text'], v[name]);
              return cell(v[name], v[name] + ' · text ' + r.toFixed(1));
            })
          );
        for (const [name, on, floor, note] of GAL_INK)
          line(
            name,
            note + ' (on ' + on + ', ' + floor + ':1)',
            sets.map(v => {
              const r = EVTheme.cratio(v[name], v[on]);
              return cell(v[name], v[name] + ' · ' + r.toFixed(1) + (r < floor ? ' below' : ''));
            })
          );
        for (const name of ['--wash-1', '--wash-2', '--wash-3', '--wash-4', '--ok-wash', '--warn-wash', '--bad-wash'])
          line(
            name,
            'wash',
            sets.map(v => cell(v[name], v[name].replace(/^rgba\(\d+,\d+,\d+,/, 'alpha ').replace(')', '')))
          );
        s.append(t);
      }
      return s;
    }
    // ---- Type, space, radii, elevation, motion
    function galType() {
      const s = galSec(
        'type',
        'Type',
        'Type: the seven text sizes, at normal and larger text, so headings and notes read in order.'
      );
      const cols = el('div', 'gal-two');
      for (const k of [1, 1.25]) {
        const c = el('div', 'gal-ramp');
        c.style.setProperty('--gal-k', String(k));
        c.append(galHead(3, 'gal-sub', 'Text size ' + k));
        for (let i = 7; i >= 1; i--) {
          const r = el('div', 'gal-ramp-row');
          const t = el('span', 'gal-ramp-t', i >= 6 ? 'Pharmacology review' : 'Fluid and electrolyte balance');
          t.style.setProperty('--gal-fs', 'var(--fs-' + i + ')');
          r.append(el('code', 'gal-ramp-n', '--fs-' + i), t);
          c.append(r);
        }
        cols.append(c);
      }
      s.append(cols);
      return s;
    }
    function galScales() {
      const s = galSec(
        'space',
        'Space, corners and lift',
        'Spacing: the few distances, corners and shadows everything is laid out with, so screens line up.'
      );
      const ruler = el('div', 'gal-ruler');
      for (const n of ['0_5', '1', '1_5', '2', '3', '4', '5', '6', '8', '12', '16']) {
        const r = el('div', 'gal-rule');
        const b = el('i', 'gal-bar');
        b.style.setProperty('--gal-w', 'var(--sp-' + n + ')');
        r.append(el('code', null, '--sp-' + n + ' · ' + galDur('--sp-' + n)), b);
        ruler.append(r);
      }
      const radii = el('div', 'gal-tiles');
      for (const n of ['xs', 'sm', 'md', 'lg', 'xl', 'pill', 'round']) {
        const t = el('div', 'gal-tile gal-radius');
        t.style.setProperty('--gal-r', 'var(--r-' + n + ')');
        t.append(el('code', null, '--r-' + n));
        radii.append(t);
      }
      const lift = el('div', 'gal-tiles');
      ['flat', 'raised', 'popover, menu', 'sheet, dialog'].forEach((w, i) => {
        const t = el('div', 'gal-tile gal-lift');
        t.style.setProperty('--gal-e', 'var(--elev-' + i + ')');
        t.append(el('code', null, '--elev-' + i), el('span', 'gal-cnote', w));
        lift.append(t);
      });
      s.append(
        galHead(3, 'gal-sub', 'Space'),
        ruler,
        galHead(3, 'gal-sub', 'Corners'),
        radii,
        galHead(3, 'gal-sub', 'Lift'),
        lift
      );
      return s;
    }
    function galMotion() {
      const s = galSec(
        'motion',
        'Motion',
        'Motion: how long things take to move, kept short and calm; Reduced motion stops them all.'
      );
      const list = el('div', 'gal-motion');
      const rows = [
        ['--dur-1', '--ease-out', 'Press feedback'],
        ['--dur-2', '--ease-out', 'Hover and colour'],
        ['--dur-3', '--ease-in', 'Fold close, exits'],
        ['--dur-4', '--ease-out', 'Fold open, sheet enter'],
        ['--dur-5', '--ease-std', 'Her presence, the success pulse'],
        ['--dur-4', '--ease-std', 'A move'],
      ];
      for (const [d, e, w] of rows) {
        const r = el('div', 'gal-mrow');
        const track = el('div', 'gal-track');
        const dot = el('i', 'gal-dot');
        track.style.setProperty('--gal-d', 'var(' + d + ')');
        track.style.setProperty('--gal-e', 'var(' + e + ')');
        track.append(dot);
        const name = el('span', 'gal-cname');
        name.append(el('code', null, d + ' · ' + e), el('span', 'gal-cnote', w + ' · ' + galDur(d)));
        const play = btn('Play', () => track.classList.toggle('on'), { cls: 'btn neutral sm' });
        play.setAttribute('aria-label', 'Play ' + d + ' with ' + e);
        r.append(name, track, play);
        list.append(r);
      }
      const reduce = document.documentElement.getAttribute('data-motion') === 'reduce';
      const sw = galSeg('Reduced motion', ['Off', 'On'], reduce ? 'On' : 'Off', v => {
        if (v === 'On') document.documentElement.setAttribute('data-motion', 'reduce');
        else document.documentElement.removeAttribute('data-motion');
        galPaint();
      });
      s.append(list, sw);
      return s;
    }
    const galDur = d => getComputedStyle(document.documentElement).getPropertyValue(d).trim();
    // ---- Components: a slot for each of the 16, today's kit helpers in their states until B-507 and B-508
    function galToday(ui) {
      const cells = [];
      const ico = galIcon();
      if (ui === 'button') {
        const pressed = btn('Pressed', null, { cls: 'btn neutral' });
        pressed.setAttribute('aria-pressed', 'true');
        cells.push(
          galCell('primary', btn('Start session', null, { primary: true })),
          galCell('neutral', btn('Course', null)),
          galCell('ghost', btn('Not now', null, { cls: 'quiet' })),
          galCell('tint', btn('Study', null, { cls: 'violet' })),
          galCell('small', btn('Small', null, { cls: 'btn neutral sm' })),
          galCell('pressed', pressed),
          galCell('disabled', btn('Disabled', null, { disabled: true }))
        );
        const icon = el('button', 'btn icon');
        icon.type = 'button';
        icon.setAttribute('aria-label', 'Done');
        icon.append(ico);
        cells.push(galCell('icon', icon));
        for (const c of ['green', 'yellow', 'red', 'blue', 'violet']) {
          const b = el('button', 'btn tint x-' + c);
          b.type = 'button';
          b.append(galIcon(), document.createTextNode(c[0].toUpperCase() + c.slice(1)));
          cells.push(galCell('tint ' + c, b));
        }
      } else if (ui === 'badge') {
        for (const [t, v] of [
          ['Graded', ''],
          ['Solid', 'ok'],
          ['Almost', 'warn'],
          ['Due tomorrow', 'bad'],
          ['Info', 'info'],
          ['Study', 'plum'],
          ['Quiet', 'quiet'],
        ])
          cells.push(galCell(v || 'neutral', badge(t, v)));
        cells.push(galCell('proposed', el('span', 'badge proposed', 'Proposed')));
      } else if (ui === 'chip') {
        for (const [t, v] of [
          ['NUR 112', ''],
          ['Ember', 'accent'],
          ['Attention', 'warn'],
          ['Info', 'info'],
        ])
          cells.push(galCell(v || 'rest', chip(t, v)));
      } else if (ui === 'segmented') {
        cells.push(galCell('selected', galSeg('Views', ['Objectives', 'Plan', 'Weak spots'], 'Objectives')));
        cells.push(galCell('two', galSeg('Period', ['Week', 'Month'], 'Month')));
      } else if (ui === 'line') {
        // the component set's row (B-285): 32 px from 600 px, 44 px on the phone (C-1)
        const list = el('div', 'cs-list');
        for (const [nm, t, v, at] of [
          ['Fluid and electrolyte balance', 'Solid', 'x-green', '9:00'],
          ['IV rates and drop factors', 'Almost', 'x-yellow', '9:30'],
          ['Fundamentals exam', 'Due tomorrow', 'x-red', '10:00'],
          ['Sodium and potassium review', 'Proposed', 'proposed', '10:45'],
          ['ATI Engage: Nutrition', 'Graded', '', '11:30'],
          ['A long name that has to give way to its badge and its time on a narrow phone', 'Info', 'x-blue', '12:15'],
          ['Pathophysiology reading', 'Study', 'x-violet', '1:00'],
        ]) {
          const li = el('div', 'li');
          li.append(el('span', 'nm', nm), el('span', 'badge' + (v ? ' ' + v : ''), t), el('span', 't', at));
          li.append(btn('Open', null, { cls: 'btn ghost sm hov' }));
          list.append(li);
        }
        cells.push(galCell('set rows', list));
        const ul = el('ul', 'list');
        ul.append(
          row({ lead: '9:00', title: 'Read chapter 12', detail: 'NUR 112 · 25 min', chips: [['Due today', 'bad']] }),
          row({
            title: 'Practice dosage set',
            detail: 'BIO 201',
            check: { checked: false, label: 'Practice dosage set', onChange: () => {} },
          }),
          row({
            title: 'Ticked off',
            cls: 'done',
            check: { checked: true, label: 'Ticked off', onChange: () => {} },
          }),
          row({ title: 'With an action', action: btn('Open', null, { cls: 'quiet' }) })
        );
        cells.push(galCell("today's row()", ul));
        // B-545: the flat check at rest, checked and focused
        for (const [label, on, focus] of [
          ['check rest', false, false],
          ['check checked', true, false],
          ['check focus', false, true],
        ]) {
          const w = el('span', 'check');
          const c = el('input', 'tick');
          c.type = 'checkbox';
          c.checked = on;
          c.setAttribute('aria-label', label);
          if (focus) c.dataset.state = 'focus';
          w.append(c);
          cells.push(galCell(label, w));
        }
      } else if (ui === 'card') {
        const c = el('div', 'ui-card');
        c.append(el('h3', null, 'Readiness'), el('p', 'meta', 'A card holds one thing, one level deep.'));
        cells.push(galCell('plain', c));
      } else if (ui === 'notice') {
        const ul = el('ul', 'list');
        ul.append(empty('Nothing due today.'));
        cells.push(galCell('empty', ul));
      } else if (ui === 'toast') {
        const stage = el('div', 'gal-stage');
        const t = el('div', 'toast', 'Saved. It shows on Today.');
        t.setAttribute('role', 'status');
        stage.append(t);
        cells.push(galCell('shows', stage));
      } else if (ui === 'field') {
        const f = el('form', 'field');
        f.addEventListener('submit', e => e.preventDefault());
        const i = el('input');
        Object.assign(i, { type: 'text', placeholder: 'Ask E.V., or tell it something to log' });
        i.setAttribute('aria-label', 'Message E.V.');
        const send = el('button', 'btn primary icon send');
        send.type = 'submit';
        send.setAttribute('aria-label', 'Send');
        send.append(galIcon('M12 19V5M5 12l7-7 7 7'));
        f.append(i, send);
        cells.push(galCell('composer', f));
      } else if (ui === 'choice') {
        const ch = { options: ['Hyponatremia', 'Hyperkalemia', 'Hypocalcemia'], correct: 0 };
        cells.push(
          galCell(
            'rest',
            mcBlock(ch, null, () => {})
          )
        );
        cells.push(
          galCell(
            'correct',
            mcBlock(ch, 0, () => {})
          )
        );
        cells.push(
          galCell(
            'wrong, revealed',
            mcBlock(ch, 2, () => {})
          )
        );
      } else if (ui === 'meter') {
        for (const [v, cls, label] of [
          [60, '', 'Done'],
          [35, ' x-yellow', 'Almost'],
        ]) {
          const p = el('div', 'pbar' + cls);
          p.setAttribute('role', 'progressbar');
          p.setAttribute('aria-label', label);
          p.setAttribute('aria-valuenow', String(v));
          const i = el('i');
          i.style.setProperty('width', v + '%');
          p.append(i);
          cells.push(galCell(label.toLowerCase() + ' ' + v + '%', p));
        }
        cells.push(galCell('stat', stat('12', 'cards due')));
      } else if (ui === 'message') cells.push(galCell('hers, his', galThread(false)));
      else if (ui === 'table' && typeof galDsTable === 'function') cells.push(...galDsTable());
      return cells;
    }
    function galComponents() {
      const s = galSec(
        'components',
        'Components',
        'Components: the 18 building blocks every screen is made of, each in its states; until a block is rebuilt, today’s version shows.'
      );
      const grid = el('div', 'gal-comps');
      for (const [ui, name, batch, states, plain] of GAL_COMPONENTS) {
        const c = el('section', 'gal-comp');
        c.dataset.slot = ui;
        c.setAttribute('aria-label', name);
        const h = el('div', 'gal-comp-h');
        h.append(
          galHead(3, 'gal-sub', name),
          el('p', 'gal-lead', plain),
          el('span', 'gal-cnote', batch + ' · ' + states)
        );
        c.append(h);
        const ds = typeof DS !== 'undefined' && DS && typeof DS[ui] === 'function' && typeof GAL_DS[ui] === 'function';
        const cells = ds ? GAL_DS[ui]() : galToday(ui);
        const body = el('div', 'gal-cells');
        if (cells.length) body.append(...cells);
        else body.append(el('p', 'gal-cnote', ds ? '' : 'Arrives with ' + batch + '; nothing like it today.'));
        c.dataset.state = ds ? 'proprietary' : cells.length ? 'today' : 'empty';
        c.append(body);
        grid.append(c);
      }
      s.append(grid);
      return s;
    }
    // ---- Patterns on made-up data
    function galThread(withEmpty) {
      const t = el('div', 'gal-thread');
      const msg = (who, text) => {
        const m = el('div', 'msg ' + who);
        if (who === 'ev') m.append(el('span', 'av-slot'));
        const body = el('div', 'msg-body');
        const b = el('div', 'bubble');
        b.append(el('p', null, text));
        body.append(b);
        m.append(body);
        return m;
      };
      t.append(
        msg(
          'ev',
          'Morning. Fundamentals is Thursday: two objectives are still Almost. Twenty minutes on IV rates first?'
        ),
        msg(
          'matt',
          'Yes, but quiz me on the drop factors and the conversion between macro and micro drip sets as well'
        ),
        msg('ev', 'Set. Eight questions, the drop factors first.')
      );
      if (withEmpty) t.append(el('p', 'empty', 'Nothing yet today.'));
      return t;
    }
    function galPatterns() {
      const s = galSec(
        'patterns',
        'Patterns',
        'Patterns: the blocks put together as E.V.’s screens use them, on made-up study data, long titles and empty days included.'
      );
      const today = el('div', 'ui-card gal-pat');
      today.append(el('h3', null, 'Today'));
      const ul = el('ul', 'list');
      ul.append(
        row({
          lead: '8:00',
          title: 'Pharmacology: anticoagulants and the antidotes for each, with the labs to watch',
          chips: [['Due today', 'bad']],
        }),
        row({
          lead: '9:30',
          title: 'IV rates and drop factors',
          detail: 'NUR 112 · 25 min',
          chips: [['Almost', 'warn']],
        }),
        row({
          lead: '11:00',
          title: 'Cell membrane transport',
          detail: 'BIO 201',
          cls: 'done',
          check: { checked: true, label: 'Cell membrane transport', onChange: () => {} },
        }),
        empty('Nothing else today.')
      );
      today.append(ul);
      const card = el('div', 'ui-card gal-pat');
      card.append(el('h3', null, 'Flashcard'));
      const front = el('div', 'fc-card');
      front.append(el('div', 'fc-q', 'Heparin antidote'));
      const back = el('div', 'fc-card shown');
      back.append(el('div', 'fc-q', 'Heparin antidote'), el('div', 'fc-a', 'Protamine sulfate'));
      card.append(galCell('front', front), galCell('back', back));
      const quiz = el('div', 'ui-card gal-pat');
      quiz.append(el('h3', null, 'Quiz question'), el('p', 'gal-q', 'Serum sodium of 128 mEq/L is'));
      const ch = { options: ['Hyponatremia', 'Normal', 'Hypernatremia'], correct: 0 };
      quiz.append(
        galCell(
          'unanswered',
          mcBlock(ch, null, () => {})
        ),
        galCell(
          'right',
          mcBlock(ch, 0, () => {})
        ),
        galCell(
          'wrong',
          mcBlock(ch, 1, () => {})
        )
      );
      const week = el('div', 'ui-card gal-pat');
      week.append(el('h3', null, 'Plan week'));
      for (const [day, items] of [
        ['Mon 2 Nov', [['Fluids and electrolytes', 'NUR 112 · 40 min']]],
        ['Tue 3 Nov', [['Cellular respiration, glycolysis to the electron transport chain', 'BIO 201 · 30 min']]],
        ['Wed 4 Nov', []],
      ]) {
        week.append(galHead(4, 'gal-day', day));
        const l = el('ul', 'list');
        if (items.length) for (const [t, d] of items) l.append(row({ title: t, detail: d }));
        else l.append(empty('Rest day.'));
        week.append(l);
      }
      const thread = el('div', 'ui-card gal-pat');
      thread.append(el('h3', null, 'Thread'), galThread(true));
      const grid = el('div', 'gal-pats');
      grid.dataset.state = 'today'; // built from today's helpers until the patterns layer lands
      grid.append(today, card, quiz, week, thread);
      s.append(grid);
      return s;
    }
    // ---- The page
    function galPaint() {
      if (!GALLERY.open || !GALLERY.root) return;
      const y = GALLERY.root.scrollTop;
      const head = el('header', 'gal-top');
      const title = el('div', 'gal-title');
      title.append(
        galHead(1, 'gal-name', 'Proprietary'),
        el('span', 'gal-cnote', 'The Gallery · staging · ' + EV_BUILD)
      );
      head.append(title, btn('Close', galClose, { cls: 'btn neutral sm' }));
      const main = el('main', 'gal-main');
      main.append(galTuner(), galColour(), galType(), galScales(), galMotion(), galComponents(), galPatterns());
      GALLERY.root.replaceChildren(head, main);
      GALLERY.root.scrollTop = y;
    }
    const galStored = () => {
      try {
        return localStorage.getItem('ev.contrast');
      } catch (e) {
        return null;
      }
    };
    function galOpen() {
      if (GALLERY.open || EV_SPEC.target !== 'staging' || !window.EVTheme) return;
      GALLERY.open = true;
      const root = document.documentElement;
      GALLERY.was = { theme: root.getAttribute('data-theme'), motion: root.getAttribute('data-motion') };
      GALLERY.mode = null;
      GALLERY.contrast = EVTheme.contrastOf(galStored());
      const g = el('div', 'gal');
      g.id = 'gallery';
      g.setAttribute('role', 'region');
      g.setAttribute('aria-label', 'The Gallery');
      // the app under it takes no focus or taps while the Gallery is open (Tab stays on the Gallery)
      GALLERY.inert = [...document.body.children].filter(x => !x.inert);
      GALLERY.inert.forEach(x => (x.inert = true));
      document.body.append(g);
      GALLERY.root = g;
      document.body.classList.add('gallery-on');
      galPaint();
    }
    function galClose() {
      if (!GALLERY.open) return;
      GALLERY.open = false;
      const root = document.documentElement;
      for (const [a, v] of [
        ['data-theme', GALLERY.was.theme],
        ['data-motion', GALLERY.was.motion],
      ])
        if (v == null) root.removeAttribute(a);
        else root.setAttribute(a, v);
      GALLERY.recipe = null;
      EVTheme.apply(document, galStored()); // this device's own contrast, as the page had it
      (GALLERY.inert || []).forEach(x => (x.inert = false));
      GALLERY.inert = null;
      if (GALLERY.root) GALLERY.root.remove();
      GALLERY.root = null;
      document.body.classList.remove('gallery-on');
      try {
        if (galleryAsked())
          window.history.replaceState(window.history.state, '', location.pathname.replace(GAL_PATH, '/'));
      } catch (e) {
        /* a sandboxed frame may refuse; the address then stays */
      }
    }
    if (EV_SPEC.target === 'staging') {
      window.addEventListener('hashchange', () => galleryAsked() && galOpen());
      setTimeout(() => galleryAsked() && galOpen(), 0); // after boot's first render
    }
