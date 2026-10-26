    // ------------------------------------------------------------ forms
    // B-233 (D-235, D-242): every weak spot the page writes goes through act(): his own (weakspot-log), and his triage
    // taps and Mark solid (weakAct). A refusal throws, so the tap's guard puts the old state back and says why.
    const acted = a => {
      if (!a || !a.ok) throw new Error((a && a.refused) || 'the actions table did not load');
    };
    const weakCtx = () => ({ now: now(), key: pageKey, weakspots: S.weak, line: talkLine });
    /** A talk line by id, as the page holds it: its own unsaved lines first, then the record's days. */
    function talkLine(id) {
      if (T.local.has(id)) return T.local.get(id);
      for (const d of S.talk || []) if (d.messages && d.messages[id]) return d.messages[id];
      return null;
    }
    /** Her add_weakspot tool: his own weak spot, at once (D-235), only through the tool actor, so act() checks from,
     * the talk line of his the turn answers; a turn with none (Read from here, a retry of hers) is refused. */
    async function toolLogWeakspot({ topic, objective = '', from }) {
      // B-232: the next free id, so a topic with a spot already made today (proposed, declined, solid) is still logged
      const id = E.freeWeakspotId(E.safeId('ws-' + today + '-' + (objective || 'x') + '-' + E.slug(topic)), S.weak);
      const args = {
        id,
        topic,
        objective,
        course: E.defaultCourse(),
        source: 'Told E.V.',
        initial: { streak: 0, nextDue: today, recurrence: 1, misses: 0 },
        ...(from ? { from } : {}),
      };
      const ctx = weakCtx();
      // D-200's write-site lint takes run(ACT.tool(...).writes) only, so the call is checked, then composed again to run
      acted(ACT && ACT.tool('weakspot-log', args, ctx));
      await run(ACT.tool('weakspot-log', args, ctx).writes);
      return id;
    }
    /** His tap on one weak-spot row: weakspot-accept, -join, -snooze, -decline or -solid. */
    async function weakAct(name, args) {
      const ctx = weakCtx();
      acted(ACT && ACT.tap(name, args, ctx));
      await run(ACT.tap(name, args, ctx).writes);
      const said = triageSaid(name, args);
      if (said) toast(said);
    }
    // B-409: his triage tap says what it did, as the demo's line. The demo's Undo is not offered: the actions table
    // (core/actions.mjs) has no event that puts a spot back to proposed or takes a Join's link off, and a new data path
    // is out of this wave's reach, so the line says what happened and nothing more.
    function triageSaid(name, args) {
      const items = args.items || [{ id: args.id }];
      const spot = id => (S.weak || []).find(w => w && w.id === id) || {};
      if (name === 'weakspot-accept') {
        if (items.length !== 1) return 'Accepted ' + items.length + ' weak spots.';
        const o = (S.objectives || []).find(x => x.id === items[0].objective);
        return o && o.text ? 'Accepted under “' + o.text + '”.' : 'Accepted.';
      }
      if (name === 'weakspot-join') return 'Joined to “' + (spot(args.to).topic || args.to) + '”.';
      if (name === 'weakspot-snooze') return 'Not now: it comes back tomorrow.';
      if (name === 'weakspot-decline') return 'Declined. Nothing is counted.';
      return '';
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
