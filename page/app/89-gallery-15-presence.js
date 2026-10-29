    // ---- Gallery 15 Presence: function galDsPresence(), its state cells, staging only (D-388); lane C2 (B-508)
    function galDsPresence() {
      const cells = ['sm', 'md', 'stage'].map(size => galCell(size, DS.presence({ size, label: 'E.V., ' + size })));
      for (const state of ['idle', 'thinking', 'speaking', 'quiet', 'loading'])
        cells.push(galCell(state, DS.presence({ size: 'md', state, label: 'E.V., ' + state })));
      return cells;
    }
