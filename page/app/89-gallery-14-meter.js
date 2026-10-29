    // ---- Gallery 14 Meter: function galDsMeter(), its state cells, staging only (D-388); lane C2 (B-508)
    function galDsMeter() {
      const bar = (value, label, tone) => DS.meter({ value, label, tone });
      return [
        galCell('empty', bar(0, 'Nothing done yet')),
        galCell('partial', bar(60, 'Done')),
        galCell('complete', bar(100, 'All done')),
        galCell('warn', bar(35, 'Almost', 'warn')),
        galCell(
          'segments',
          DS.meter({
            kind: 'segments',
            label: '4 solid, 2 almost, of 10 objectives',
            parts: [
              { value: 40, tone: 'ok' },
              { value: 20, tone: 'warn' },
            ],
          })
        ),
        galCell('stat', DS.meter({ kind: 'stat', value: '12', label: 'cards due' })),
        galCell('stat, opens', DS.meter({ kind: 'stat', value: '3', label: 'weak spots open', onOpen: () => {} })),
        galCell(
          'legend',
          DS.meter({
            kind: 'legend',
            parts: [{ label: 'Solid', tone: 'ok' }, { label: 'Almost', tone: 'warn' }, { label: 'Not yet' }],
          })
        ),
      ];
    }
