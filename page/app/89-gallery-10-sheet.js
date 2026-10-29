    // ---- Gallery 10 Sheet: function galDsSheet(), its state cells, staging only (D-388); lane C2 (B-508) Two previews
    // in the flow (show(), never over the Gallery) and the buttons that open each kind for real: modal, Esc and the
    // backdrop close it, focus comes back (test/harness/components.cjs proves it at 390 and 1280).
    function galDsSheet() {
      const B = DS.button;
      const make = (kind, o = {}) => {
        const s = DS.sheet({
          kind,
          ...(kind === 'confirm'
            ? {
                title: 'Put this plan away?',
                body: [el('p', null, 'It leaves Study; his ticks and notes stay in the record.')],
                foot: [
                  B({ label: 'Cancel', onClick: () => s.close() }),
                  B({ label: 'Put away', kind: 'primary', onClick: () => s.close() }),
                ],
              }
            : {
                title: 'Study plan instructions',
                icon: galIcon(),
                aside: el('span', 'gal-cnote', 'Edited'),
                body: [
                  DS.field({
                    kind: 'textarea',
                    label: 'Instructions',
                    value: 'Twenty-five minute blocks, the weakest objective first.',
                  }),
                ],
                foot: [
                  B({ label: 'Reset to default', kind: 'ghost' }),
                  B({ label: 'Cancel', onClick: () => s.close() }),
                  B({ label: 'Save', kind: 'primary', onClick: () => s.close() }),
                ],
              }),
          ...o,
        });
        return s;
      };
      const preview = kind => {
        const s = make(kind);
        s.setAttribute('open', '');
        return s;
      };
      const opener = (label, kind) =>
        B({
          label,
          onClick: () => {
            const s = make(kind, { onClose: () => s.remove() });
            document.getElementById('gallery').append(s);
            s.showModal();
          },
        });
      return [
        galCell('sheet, open', preview('sheet')),
        galCell('confirm, open', preview('confirm')),
        galCell(
          'opens modal; Esc, backdrop or a swipe closes',
          galRow(opener('Open sheet', 'sheet'), opener('Open confirm', 'confirm'))
        ),
      ];
    }
