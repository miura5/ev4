    // ---- Gallery 03 Chip: function galDsChip(), its state cells, staging only (D-388); lane C1 (B-507)
    function galDsChip() {
      const C = DS.chip;
      const cells = [];
      for (const [label, tone] of [
        ['NUR 112', ''],
        ['your turn', 'accent'],
        ['answered', 'ok'],
        ['Attention', 'warn'],
        ['Info', 'info'],
      ])
        cells.push(galCell(tone || 'label', C({ label, tone })));
      cells.push(
        galCell('toggle, off', C({ label: 'Due today', kind: 'toggle', on: false, onClick: () => {} })),
        galCell('toggle, on', C({ label: 'Graded', kind: 'toggle', on: true, onClick: () => {} })),
        galCell('action', C({ label: 'Quiz me', icon: galIcon(), kind: 'action', onClick: () => {} })),
        galCell('hover', galForce(C({ label: 'Hover', kind: 'action' }), 'hover')),
        galCell('pressed', galForce(C({ label: 'Pressed', kind: 'action' }), 'pressed')),
        galCell('focus', galForce(C({ label: 'Focus', kind: 'action' }), 'focus')),
        galCell('disabled', C({ label: 'Disabled', kind: 'toggle', disabled: true }))
      );
      return cells;
    }
