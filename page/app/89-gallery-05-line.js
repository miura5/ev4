    // ---- Gallery 05 Line: function galDsLine(), its state cells, staging only (D-388); lane C1 (B-507)
    function galDsLine() {
      const L = DS.line;
      const open = () => {};
      const hov = () => DS.button({ label: 'Open', kind: 'ghost', size: 'sm' });
      // the set's rows (B-285: 32 px from 600 px, 44 px on the phone, C-1): the harness measures these seven
      const set = el('div', 'cs-list gal-set');
      for (const [title, text, tone, lead] of [
        ['Fluid and electrolyte balance', 'Solid', 'ok', '9:00'],
        ['IV rates and drop factors', 'Almost', 'warn', '9:30'],
        ['Fundamentals exam', 'Due tomorrow', 'bad', '10:00'],
        ['Sodium and potassium review', 'Proposed', 'proposed', '10:45'],
        ['ATI Engage: Nutrition', 'Graded', '', '11:30'],
        ['A long name that has to give way to its badge and its time on a narrow phone', 'Info', 'info', '12:15'],
        ['Pathophysiology reading', 'Study', 'violet', '1:00'],
      ])
        set.append(L({ title, badge: { text, tone }, lead, action: hov(), key: 'gal-' + lead }));
      const one = (state, o) => {
        const box = el('div', 'cs-list');
        const line = L(Object.assign({ title: 'Read chapter 12', lead: '9:00', badge: ['Reading', 'ok'] }, o));
        box.append(o.state ? galForce(line, o.state) : line);
        return galCell(state, box);
      };
      const stack = el('ul', 'list');
      stack.append(
        L({
          kind: 'stack',
          lead: '9:00',
          title: 'Read chapter 12',
          meta: 'NUR 112 · 25 min',
          badge: ['Due today', 'bad'],
        }),
        L({
          kind: 'stack',
          title: 'Practice dosage set',
          meta: 'BIO 201',
          check: { checked: false, label: 'Practice dosage set', onChange: () => {} },
        }),
        L({
          kind: 'stack',
          title: 'Ticked off',
          done: true,
          check: { checked: true, label: 'Ticked off', onChange: () => {} },
        }),
        L({ kind: 'stack', title: 'With an action', action: DS.button({ label: 'Open', kind: 'ghost', size: 'sm' }) })
      );
      return [
        galCell('set rows', set),
        one('with its tick', { check: { checked: false, label: 'Read chapter 12', onChange: () => {} } }),
        one('opens', { onOpen: open, key: 'gal-open' }),
        one('hover', { action: hov(), state: 'hover' }),
        one('pressed', { onOpen: open, state: 'pressed' }),
        one('open', { onOpen: open, open: true }),
        one('done', { done: true, check: { checked: true, label: 'Read chapter 12', onChange: () => {} } }),
        one('urgent', { urgent: true, badge: ['Due today', 'bad'] }),
        one('disabled, with its reason', { disabled: true, lead: null, reason: 'After the exam', onOpen: open }),
        one('dragging', { state: 'dragging' }),
        galCell('stacked (the kit’s row)', stack),
      ];
    }
