    // ---- Gallery 06 Fold: function galDsFold(), its state cells, staging only (D-388); lane C1 (B-507)
    function galDsFold() {
      const body = () => el('p', 'meta', 'Sodium 135 to 145; potassium 3.5 to 5.0. A fold opens beneath its head.');
      return [
        galCell('closed', DS.fold({ head: 'Show 3 more', body: body() })),
        galCell('open', DS.fold({ head: 'Hide the reference ranges', body: body(), open: true })),
      ];
    }
