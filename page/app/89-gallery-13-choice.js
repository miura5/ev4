    // ---- Gallery 13 Choice: function galDsChoice(), its state cells, staging only (D-388); lane C2 (B-508)
    function galDsChoice() {
      const options = ['Hyponatremia', 'Hyperkalemia', 'Hypocalcemia'];
      const q = (state, o) => galCell(state, DS.choice({ label: 'Serum sodium of 128 mEq/L is', options, ...o }));
      return [
        q('rest', {}),
        q('selected', { picked: 0 }),
        q('correct', { picked: 0, correct: 0, answered: true }),
        q('wrong, revealed', { picked: 2, correct: 0, answered: true }),
        q('disabled, keys 1 to 3', { disabled: true, keys: 'numbers' }),
      ];
    }
