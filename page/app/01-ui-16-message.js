    // ---- Proprietary 16 Message (B-508; D-374, D-381): one line of the conversation, hers or his, with its actions
    // (Copy, Start or Open chips, given as nodes) and its status. Today's look: the E.V. window's captions: her line in
    // her quiet ink (the current one large, in the text colour), his on the right under a small "You". Status: pending
    // (his words echo at once, fainter), streaming (her words arriving, a quiet mark at their end), sent, and failed
    // (the line stays, with a plain reason and whatever action the view gives, Try again). Her presence is the view's
    // to place (DS.presence); a message never draws her.
    //   DS.message({ who: 'hers' | 'his', body: 'text' or node, actions: [chips], status: 'sent', current: false,
    //     reason: 'Not sent: no connection.', key: messageId })
    function dsMessage(o = {}) {
      const who = o.who === 'his' ? 'his' : 'hers';
      const status = ['pending', 'streaming', 'failed'].includes(o.status) ? o.status : 'sent';
      const r = dsRoot('div', 'message', { ...o, kind: who }, 'message');
      r.dataset.state = status;
      if (o.current) r.dataset.current = 'true';
      const body = el('div', 'message-b');
      if (who === 'his') body.append(el('span', 'message-who', 'You'));
      if (o.body && typeof o.body === 'object') body.append(o.body);
      else body.append(el('p', null, o.body || ''));
      r.append(body);
      if (status === 'streaming') r.setAttribute('aria-busy', 'true');
      if (status === 'failed') r.append(el('p', 'message-s', o.reason || 'Not sent.'));
      if (o.actions && o.actions.length) {
        const a = el('div', 'message-a');
        a.append(...o.actions);
        r.append(a);
      }
      return r;
    }
