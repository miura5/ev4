    // ---- Gallery 11 Popover: function galDsPopover(), its state cells, staging only (D-388); lane C2 (B-508)
    function galDsPopover() {
      const items = [
        { label: 'Task for Today', icon: galIcon('M12 5v14M5 12h14') },
        { label: 'Note', icon: galIcon('M5 4h10l4 4v12H5z') },
        { label: 'Exam', icon: galIcon('M4 6h16M4 12h16M4 18h10'), disabled: true },
      ];
      const kinds = [
        { label: 'Learning', on: true },
        { label: 'General', on: false },
      ];
      const anchor = DS.button({ label: 'Kind' });
      const live = DS.popover({ anchor, label: 'Kind', items: kinds });
      const panel = el('div', 'gal-row');
      panel.append(el('span', 'gal-cnote', 'Theme'), DS.chip({ label: 'Dark', kind: 'toggle', on: true }));
      return [
        galCell('closed (opens on tap; a tap outside or Esc closes)', galRow(anchor, live)),
        galCell('open, a menu', DS.popover({ inline: true, label: 'Create', items })),
        galCell('open, one picked', DS.popover({ inline: true, label: 'Kind', items: kinds })),
        galCell('open, a panel', DS.popover({ inline: true, label: 'Preferences', body: panel })),
      ];
    }
