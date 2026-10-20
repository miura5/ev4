    // ------------------------------------------------------------ forms
    async function addWeakspot({ topic, objective = '', source }) {
      const at = now();
      const id = E.safeId('ws-' + today + '-' + (objective || 'x') + '-' + E.slug(topic));
      const facts = {
        ...envelope(source || 'Logged by you', at),
        topic,
        objective,
        exam: objective.split('-')[0] || '',
        course: E.defaultCourse(),
        kind: 'concept',
        addedBy: 'page',
        initial: { streak: 0, nextDue: today, recurrence: 1, misses: 0 },
        events: {},
      };
      await write({ op: 'set', collection: 'weakspots', id, data: facts });
      return id;
    }
    async function editDates(edit, by) {
      // one add / change / remove / restore through EVCore.dateEdit (D-080)
      const r = E.dateEdit(S.datesRaw, S.dateedits, edit, { now: now(), by });
      if (r.write)
        await write({ op: r.write.op, collection: r.write.collection, id: r.write.id || r.id, data: r.write.data });
      return r;
    }
    $('date-add').addEventListener('submit', ev => {
      ev.preventDefault();
      const date = $('d-date').value,
        title = $('d-title').value.trim();
      if (!date || !title) return;
      guard(
        ev.submitter,
        async () => {
          const r = await editDates(
            {
              action: 'add',
              date,
              title,
              kind: $('d-kind').value,
              graded: $('d-graded').checked,
              course: $('d-course').value,
            },
            'Matt'
          );
          if (r.note && r.note !== 'back on the calendar') throw new Error(r.note);
          $('d-title').value = '';
          $('d-graded').checked = false;
        },
        'Date added'
      );
    });
    $('j-text').addEventListener('input', () => {
      const w = E.scanIdentifiers($('j-text').value);
      $('j-warn').textContent = w.length ? 'Check before saving: this ' + w[0] + '. No patient details.' : '';
    });
    $('j-add').addEventListener('submit', ev => {
      ev.preventDefault();
      const text = $('j-text').value.trim();
      if (!text) return;
      guard(
        ev.submitter,
        async () => {
          const at = now();
          const data = { ...envelope('E.V. Home', at), text, kind: $('j-kind').value, createdAt: at };
          if (validate) {
            const r = validate('journal', data);
            if (!r.ok) throw new Error('that entry does not fit its shape');
          }
          await db.collection('journal').add(data);
          $('j-text').value = '';
          $('j-warn').textContent = '';
        },
        'Entry saved'
      );
    });
    render();
    return { changed, lost };
  }

  window.EVApp = { VERSION, boot };
})();
