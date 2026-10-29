    // ---- Gallery 01 Button: function galDsButton(), its state cells, staging only (D-388); lane C1 (B-507)
    /** A state the Gallery shows without a pointer or a key: the real attribute where one exists, else data-state, which
     *  only the Gallery sets (D-383: never a simulated hover). Returns the node. */
    function galForce(node, state) {
      node.dataset.state = state;
      return node;
    }
    /** A cell holding a few nodes side by side (a component and the words that go with it). */
    function galRow(...nodes) {
      const r = el('div', 'gal-row');
      r.append(...nodes.filter(Boolean));
      return r;
    }
    function galDsButton() {
      const B = DS.button;
      const cells = [
        galCell('primary', B({ label: 'Start session', kind: 'primary' })),
        galCell('neutral', B({ label: 'Course' })),
        galCell('ghost', B({ label: 'Not now', kind: 'ghost' })),
        galCell('small', B({ label: 'Small', size: 'sm' })),
        galCell('icon', B({ label: 'Done', icon: galIcon(), iconOnly: true, kind: 'ghost' })),
        galCell('count', B({ label: 'Due', count: 3 })),
      ];
      for (const t of ['ok', 'warn', 'bad', 'info', 'violet'])
        cells.push(
          galCell('tint ' + t, B({ label: t[0].toUpperCase() + t.slice(1), icon: galIcon(), kind: 'tint', tone: t }))
        );
      for (const k of ['primary', 'neutral', 'ghost'])
        cells.push(galCell('hover, ' + k, galForce(B({ label: 'Hover', kind: k }), 'hover')));
      cells.push(
        galCell('pressed', galForce(B({ label: 'Pressed' }), 'pressed')),
        galCell('focus', galForce(B({ label: 'Focus' }), 'focus')),
        galCell(
          'disabled, with its reason',
          galRow(B({ label: 'Start', kind: 'primary', disabled: true }), el('span', 'gal-cnote', 'Nothing due yet'))
        ),
        galCell('busy', B({ label: 'Making the plan', kind: 'primary', busy: true }))
      );
      return cells;
    }
