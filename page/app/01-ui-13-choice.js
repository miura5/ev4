    // ---- Proprietary 13 Choice (B-508; D-374, D-375): the answers to one question, a native radio group (a checkbox
    // group when multi) in a fieldset, each answer lettered (A to D, or 1 to 4) with the key that picks it on the
    // laptop. Today's look: the quiz runner's .qz-card .opt. Each answer's input covers its whole row, so the row is
    // the tap target (52 px). Once answered, every answer locks and shows what it was:
    //   correct (his pick, right), wrong (his pick, not right), revealed (right, not his pick).
    //   DS.choice({ label: 'Serum sodium of 128 mEq/L is', options: ['Hyponatremia', 'Normal'], picked: 0, correct: 0,
    //     answered: true, keys: 'letters' | 'numbers', multi: false, disabled: false, onPick: (i, input) => {} })
    let dsChoiceN = 0;
    function dsChoice(o = {}) {
      const r = dsRoot('fieldset', 'choice', o, 'choice');
      const legend = el('legend', null, o.label || 'Answers');
      const name = o.name || 'ds-choice-' + ++dsChoiceN;
      const set = v => new Set(v == null ? [] : [].concat(v));
      const picked = set(o.picked),
        right = set(o.correct);
      const keyOf = k => (o.keys === 'numbers' ? String(k + 1) : 'ABCDEFGHI'[k] || String(k + 1));
      r.append(legend);
      (o.options || []).forEach((text, k) => {
        const row = el('label', 'choice-o');
        const inp = el('input');
        inp.type = o.multi ? 'checkbox' : 'radio';
        inp.name = name;
        inp.checked = picked.has(k);
        inp.disabled = !!(o.answered || o.disabled);
        inp.addEventListener('change', () => o.onPick && o.onPick(k, inp));
        const kb = el('kbd', null, keyOf(k));
        kb.setAttribute('aria-hidden', 'true');
        row.append(inp, kb, el('span', null, text));
        const state = !o.answered
          ? ''
          : picked.has(k)
            ? right.has(k)
              ? 'correct'
              : 'wrong'
            : right.has(k)
              ? 'revealed'
              : '';
        if (state) {
          row.dataset.state = state;
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('viewBox', '0 0 24 24');
          svg.setAttribute('aria-hidden', 'true');
          svg.innerHTML = `<path d="${state === 'wrong' ? 'M6 6l12 12M18 6L6 18' : 'M5 12.5l4.5 4.5L19 7.5'}"/>`;
          row.append(svg);
          inp.setAttribute('aria-description', state === 'wrong' ? 'wrong' : 'correct');
        }
        r.append(row);
      });
      // keys A to D and 1 to 4 pick on the laptop, while focus is in the group
      r.addEventListener('keydown', e => {
        if (e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1) return;
        const k = /\d/.test(e.key) ? Number(e.key) - 1 : 'abcdefghi'.indexOf(e.key.toLowerCase());
        const inp = r.querySelectorAll('input')[k];
        if (inp && !inp.disabled) (e.preventDefault(), inp.click());
      });
      return r;
    }
