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
    render();
    return { changed, lost };
  }

  window.EVApp = { VERSION, boot };
})();
