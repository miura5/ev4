    // ---- Gallery 19 Picker: function galDsPicker(), its state cells, staging only (D-388); lane 1 (B-596)
    function galDsPicker() {
      const kinds = ['Learn', 'Practice', 'Review', 'Graded', 'Skills prep', 'Clinical prep', 'Reading', 'Note'];
      const options = kinds.map(k => ({ value: k.toLowerCase(), label: k }));
      const P = o => DS.picker(Object.assign({ label: 'Kind', options, onPick: () => {} }, o));
      const est = ['5 min', '15 min', '30 min', '45 min'].map(v => ({ value: v, label: v, icon: galIcon() }));
      return [
        galCell('closed, a value', P({ value: 'graded' })),
        galCell('closed, no value', P({ placeholder: 'Kind' })),
        galCell('disabled', P({ value: 'learn', disabled: true })),
        galCell('open, the current checked', P({ value: 'review', inline: true })),
        galCell('searching', P({ value: 'review', inline: true, query: 'prep' })),
        galCell('no match', P({ inline: true, query: 'zzz' })),
        galCell('icons, not dots', P({ label: 'Estimate', options: est, value: '15 min', inline: true })),
      ];
    }
