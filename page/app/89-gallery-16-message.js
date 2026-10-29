    // ---- Gallery 16 Message: function galDsMessage(), its state cells, staging only (D-388); lane C2 (B-508)
    function galDsMessage() {
      const M = DS.message;
      const chip = label => DS.chip({ label, kind: 'action', onClick: () => {} });
      return [
        galCell(
          'hers, sent, with actions',
          M({
            who: 'hers',
            body: 'Fundamentals is Thursday: two objectives are still Almost. Twenty minutes on IV rates first?',
            actions: [chip('Start'), chip('Copy')],
          })
        ),
        galCell(
          'hers, current',
          M({ who: 'hers', current: true, body: 'Set. Eight questions, the drop factors first.' })
        ),
        galCell(
          'hers, streaming',
          M({ who: 'hers', status: 'streaming', body: 'Macro drip sets run at ten to twenty' })
        ),
        galCell('his, pending', M({ who: 'his', status: 'pending', body: 'Quiz me on the drop factors' })),
        galCell(
          'his, sent (a long line)',
          M({
            who: 'his',
            body: 'Yes, but quiz me on the drop factors and the conversion between macro and micro drip sets as well',
          })
        ),
        galCell(
          'his, failed',
          M({
            who: 'his',
            status: 'failed',
            body: 'What is due this week?',
            reason: 'Not sent: no connection.',
            actions: [DS.button({ label: 'Try again', size: 'sm' })],
          })
        ),
      ];
    }
