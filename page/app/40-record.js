    // ------------------------------------------------------------ Record
    const IDEA_KIND = { learning: 'Learning', feature: 'Feature', general: 'General' };
    const promote = i =>
      btn('Make it a weak spot', ev =>
        guard(
          ev.target,
          async () => {
            const at = now();
            const id = E.safeId('ws-idea-' + i.id);
            const facts = {
              ...envelope('Promoted idea', at),
              topic: String(i.text || '').slice(0, 140),
              objective: i.objective || '',
              exam: String(i.objective || '').split('-')[0] || '',
              course: E.defaultCourse(),
              kind: 'concept',
              addedBy: 'page',
              origin: { idea: i.id },
              initial: { streak: 0, nextDue: E.addDays(today, 1), recurrence: 1, misses: 0 },
              events: {},
            };
            await write({ op: 'set', collection: 'weakspots', id, data: facts });
            await write({ op: 'update', collection: 'ideas', id: i.id, data: { status: 'promoted', weakspotId: id } });
          },
          'Now a weak spot'
        )
      );
    // B-111 (D-148): an idea is its text on a line of its own, full width, with its kind and source as one quiet line; the
    // kind menu and Make it a weak spot show when the row is opened in place, and an opened row stays open across renders.
    const openIdeas = new Set();
    function ideaRow(i) {
      const li = el('li', 'row idea' + (openIdeas.has(i.id) ? ' open' : ''));
      li.dataset.id = i.id;
      const head = el('button', 'idea-head');
      head.type = 'button';
      head.setAttribute('aria-expanded', String(openIdeas.has(i.id)));
      head.append(
        el('span', 'title', i.text || ''),
        el(
          'span',
          'meta',
          [
            IDEA_KIND[i.kind || 'learning'] || 'Learning',
            i.objective,
            i.sourceLabel || i.source,
            short(i.createdAt),
            (i.links || []).length
              ? plural(new Set(i.links.map(l => (l && l.to) + '|' + (l && l.type))).size, 'link')
              : '',
            i.status === 'promoted' ? 'now a weak spot' : '',
          ]
            .filter(Boolean)
            .join(' · ')
        )
      );
      // D-109: a kind control on every idea; only a learning idea can become a weak spot
      const box = el('div', 'idea-acts');
      const sel = document.createElement('select');
      sel.setAttribute('aria-label', 'Kind of idea');
      sel.className = 'idea-kind';
      for (const [v, t] of Object.entries(IDEA_KIND)) {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = t;
        o.selected = (i.kind || 'learning') === v;
        sel.append(o);
      }
      sel.addEventListener('change', () =>
        guard(
          sel,
          () => write({ op: 'update', collection: 'ideas', id: i.id, data: { kind: sel.value } }),
          'Kind changed'
        )
      );
      box.append(sel);
      if (i.status !== 'promoted' && (i.kind || 'learning') === 'learning') box.append(promote(i));
      head.addEventListener('click', () => {
        const on = !openIdeas.has(i.id);
        on ? openIdeas.add(i.id) : openIdeas.delete(i.id);
        li.classList.toggle('open', on);
        head.setAttribute('aria-expanded', String(on));
      });
      li.append(head, box);
      return li;
    }
    function renderRecord() {
      renderWorkoutList();
      const ss = [...S.sessions].sort((a, b) =>
        String(b.startedAt || b.date || '').localeCompare(String(a.startedAt || a.date || ''))
      );
      $('sessions').replaceChildren(
        ...(ss.length
          ? ss.map(s =>
              row({
                lead: short(s.date),
                title: s.topic || 'Study session',
                chips: [
                  s.status === 'active' || s.status === 'ending' ? ['in progress', 'info'] : null,
                  s.source === 'E.V. Home' ? ['E.V.', 'ok'] : null,
                ],
                detail: [
                  s.minutes ? s.minutes + ' min' : '',
                  s.questions ? plural(s.questions, 'question') : '',
                  s.cardCount ? s.cardCount + ' cards' : '',
                  s.summary,
                ]
                  .filter(Boolean)
                  .join(' · '),
              })
            )
          : [empty('Study sessions show up here. Start one from the E.V. conversation.')])
      );
      const ideas = S.ideas
        .filter(i => i.status !== 'archived')
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      $('ideas').replaceChildren(
        ...(ideas.length ? ideas.map(ideaRow) : [empty('Ideas from Study Watch sessions show up here after filing.')])
      );
      const up = S.dates
        .filter(d => (d.date || '') >= today)
        .sort((a, b) => a.date.localeCompare(b.date) || String(a.title).localeCompare(b.title));
      $('dates').replaceChildren(
        ...(up.length ? up.map(d => dateRow(d, { edit: true })) : [empty('No upcoming dates. Add one below.')])
      );
      const offUp = S.datesAll
        .filter(d => E.isRemovedDate(d) && (d.date || '') >= today)
        .sort((a, b) => a.date.localeCompare(b.date));
      $('dates-off-card').hidden = !offUp.length;
      $('dates-off').replaceChildren(...offUp.map(d => dateRow(d, { edit: true })));
      const js = [...S.journal].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      $('journal').replaceChildren(
        ...(js.length
          ? js.map(j => {
              const li = row({
                title:
                  ({ free: 'Free write', clinical: 'After clinical', weekly: 'Weekly reflection' }[j.kind] || j.kind) +
                  ' · ' +
                  short(j.createdAt),
              });
              const p = el('div', 'stem');
              p.style.fontSize = '.95rem';
              p.textContent = j.text || '';
              li.querySelector('.grow').append(p);
              return li;
            })
          : [empty('No entries yet. Write whenever you like; E.V. suggests one weekly and after each clinical.')])
      );
      renderLibrary();
      const ns = [...S.announcements].sort((a, b) => String(b.postedAt || '').localeCompare(String(a.postedAt || '')));
      $('news').replaceChildren(
        ...(ns.length
          ? ns.map(n => {
              const li = row({ lead: short(n.postedAt), title: n.title || '', detail: n.course || '' });
              const det = el('details');
              det.append(el('summary', null, 'Read'));
              const p = el('p', 'stem');
              p.style.fontSize = '.92rem';
              p.textContent = n.text || '';
              det.append(p);
              li.querySelector('.grow').append(det);
              return li;
            })
          : [empty('Canvas announcements arrive with the evening sync.')])
      );
    }

