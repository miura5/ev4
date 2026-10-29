    // ---- Gallery 04 Segmented: function galDsSegmented(), its state cells, staging only (D-388); lane C1 (B-507)
    function galDsSegmented() {
      const S = DS.segmented;
      const focus = S({ label: 'Period', options: ['Week', 'Month', 'Semester'], value: 'Week' });
      galForce(focus.children[1], 'focus');
      const over = el('div', 'gal-narrow');
      over.style.setProperty('max-width', '15rem');
      over.append(
        S({ label: 'Courses', options: ['NUR 112', 'BIO 201', 'NUR 113', 'Clinical', 'ATI'], value: 'BIO 201' })
      );
      return [
        galCell('selected', S({ label: 'Views', options: ['Objectives', 'Plan', 'Weak spots'], value: 'Objectives' })),
        galCell('two', S({ label: 'Show', options: ['Week', 'Month'], value: 'Month' })),
        galCell(
          'with counts',
          S({
            label: 'Kinds',
            options: [
              { value: 'all', label: 'All', count: 24 },
              { value: 'note', label: 'Notes', count: 9 },
            ],
            value: 'note',
          })
        ),
        galCell('focus', focus),
        galCell('scrolls on overflow', over),
      ];
    }
