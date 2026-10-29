    // ---- Gallery 02 Badge: function galDsBadge(), its state cells, staging only (D-388); lane C1 (B-507)
    function galDsBadge() {
      const cells = [];
      for (const [text, tone] of [
        ['Graded', ''],
        ['Solid', 'ok'],
        ['Almost', 'warn'],
        ['Due tomorrow', 'bad'],
        ['Info', 'info'],
        ['Study', 'violet'],
        ['Quiet', 'quiet'],
        ['Proposed', 'proposed'],
      ])
        cells.push(galCell(tone || 'neutral', DS.badge({ text, tone })));
      cells.push(galCell('course', DS.badge({ course: 'NUR 112' })));
      cells.push(galCell('long, in a narrow row', DS.badge({ text: 'Due tomorrow, before class', tone: 'bad' })));
      return cells;
    }
