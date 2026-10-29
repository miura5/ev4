    // ---- Proprietary 12 Field (B-508; D-374, D-375): a place to type or pick, with its label, a hint, an error and
    // whether it is saving or saved. Kinds: input (any text type), textarea (grows with what he types), select, date,
    // switch and checkbox, all native controls. Today's look: the page's own input, select and textarea; a switch and a
    // checkbox are a 44 px row on the phone (the whole row taps). Its class is entry, because legacy's .field is the
    // composer's box. Its control is the root's [data-part=control].
    //   DS.field({ kind: 'input', label: 'Title', value, placeholder, hint, error, state: 'saving' | 'saved',
    //     disabled, type: 'text', max, options: [['nur', 'NUR 112'], 'BIO 201'], onInput: (v, e) => {}, onChange })
    let dsFieldN = 0;
    function dsField(o = {}) {
      const kind = o.kind || 'input';
      const r = dsRoot('div', 'field', { ...o, kind }, 'entry');
      const id = o.id || 'ds-field-' + ++dsFieldN;
      const tick = kind === 'switch' || kind === 'checkbox';
      const c = el(kind === 'textarea' || kind === 'select' ? kind : 'input', 'entry-c');
      c.id = id;
      c.dataset.part = 'control';
      if (o.name) c.name = o.name;
      if (tick) {
        c.type = 'checkbox';
        c.checked = !!o.checked;
        if (kind === 'switch') c.setAttribute('role', 'switch');
      } else if (kind === 'select')
        for (const op of o.options || []) {
          const [v, t] = [].concat(op);
          c.append(Object.assign(el('option', null, t ?? v), { value: v }));
        }
      else if (kind !== 'textarea') c.type = kind === 'date' ? 'date' : o.type || 'text';
      if (!tick && o.value != null) c.value = o.value;
      if (o.placeholder) c.placeholder = o.placeholder;
      if (o.max) c.maxLength = o.max;
      c.disabled = !!o.disabled;
      const v = () => (tick ? c.checked : c.value);
      if (o.onInput) c.addEventListener('input', e => o.onInput(v(), e));
      if (o.onChange) c.addEventListener('change', e => o.onChange(v(), e));
      const head = el(tick ? 'label' : 'div', 'entry-top');
      const lab = el(tick ? 'span' : 'label', 'entry-l', o.label || '');
      if (!tick) lab.htmlFor = id;
      if (tick) head.append(c, el('span', 'entry-mark'));
      head.append(lab);
      if (o.state === 'saving' || o.state === 'saved') {
        r.dataset.state = o.state;
        const s = el('span', 'entry-s', o.state === 'saving' ? 'Saving…' : 'Saved');
        s.setAttribute('aria-live', 'polite');
        head.append(s);
      }
      r.append(head);
      if (!tick) r.append(c);
      const said = [];
      for (const [k, t] of [
        ['h', o.hint],
        ['e', o.error],
      ]) {
        if (!t) continue;
        const p = el('p', 'entry-' + k, t);
        p.id = id + '-' + k;
        said.push(p.id);
        r.append(p);
      }
      if (said.length) c.setAttribute('aria-describedby', said.join(' '));
      if (o.error) c.setAttribute('aria-invalid', 'true');
      return r;
    }
