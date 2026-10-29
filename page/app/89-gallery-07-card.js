    // ---- Gallery 07 Card: function galDsCard(), its state cells, staging only (D-388); lane C1 (B-507)
    function galDsCard() {
      const C = DS.card;
      const p = t => el('p', 'meta', t);
      return [
        galCell('plain', C({ title: 'Readiness', body: p('A card holds one thing, one level deep.') })),
        galCell(
          'head, aside, actions, foot',
          C({
            title: 'Fundamentals exam',
            aside: 'Tue 3 Nov',
            actions: DS.button({ label: 'Plan', kind: 'ghost', size: 'sm' }),
            body: p('12 objectives, 4 weak spots.'),
            foot: DS.button({ label: 'Review', size: 'sm' }),
          })
        ),
        galCell('quiet', C({ kind: 'quiet', title: 'Not graded', body: p('Practice only; nothing here counts.') })),
        galCell('fold, closed', C({ kind: 'fold', title: 'Weak spots', body: p('Sodium and potassium; IV rates.') })),
        galCell(
          'fold, open',
          C({ kind: 'fold', title: 'Weak spots', open: true, body: p('Sodium and potassium; IV rates.') })
        ),
      ];
    }
