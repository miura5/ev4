    // ---- Gallery 09 Toast: function galDsToast(), its state cells, staging only (D-388); lane C1 (B-507)
    function galDsToast() {
      // a position:fixed toast is held by its transformed stage (gallery.css), so each shows in place
      const stage = () => el('div', 'gal-stage');
      const shows = stage();
      const undo = stage();
      const hides = stage();
      shows.append(DS.toast({ text: 'Saved. It shows on Today.', ms: 0 }));
      undo.append(DS.toast({ text: 'Task removed.', action: { label: 'Undo' }, ms: 0 }));
      const slot = el('div', 'toast');
      slot.hidden = true;
      const play = DS.button({
        label: 'Show it for 2.6 s',
        size: 'sm',
        onClick: () => DS.toast({ text: 'Ticked off. Nice work.', root: slot }),
      });
      hides.append(play, slot);
      return [galCell('shows', shows), galCell('with Undo', undo), galCell('hides after 2.6 s', hides)];
    }
