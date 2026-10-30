    // ---- Gallery 17 Table: function galDsTable(), its state cells, staging only (D-388); lane 1 (B-515)
    function galDsTable() {
      const radio = (name, on, off) => {
        const i = document.createElement('input');
        i.type = 'radio';
        i.name = name;
        i.checked = !!on;
        i.disabled = !!off;
        i.setAttribute('aria-label', name);
        return i;
      };
      const cols = ['Give', 'Hold'];
      const rows = (k, done) => [
        { cells: ['Metoprolol, HR 52', radio(k + '1', 0, done), radio(k + '1', 1, done)], tone: done ? 'right' : null },
        { cells: ['Furosemide, K 3.1', radio(k + '2', 1, done), radio(k + '2', 0, done)], tone: done ? 'wrong' : null },
        { cells: ['Insulin, BG 210', radio(k + '3', 0, done), radio(k + '3', 0, done)] },
      ];
      return [
        galCell('rest', DS.table({ columns: cols, rows: rows('gal-mx-a', false) })),
        galCell('checked: right, wrong', DS.table({ columns: cols, rows: rows('gal-mx-b', true) })),
      ];
    }
