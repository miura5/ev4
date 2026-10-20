    // ---------------------------------------------------------------- writing to the thread
    function postMsg(m) {
      const { id, pending, error, greeting, day, ...body } = m;
      const date = E.chicagoDate(m.at);
      body.text = String(body.text || '').slice(0, 4000);
      if (error) body.error = error;
      T.local.set(id, { ...m, pending: false });
      T.scrollTo = id;
      render();
      const p = talkQ.then(async () => {
        let exists = T.created.has(date) || S.talk.some(d => d.id === date);
        if (!exists) exists = (await db.collection('talk').doc(date).get()).exists; // the worker may have opened today's doc
        if (exists)
          await write({ op: 'update', collection: 'talk', id: date, data: { messages: { [id]: clean(body) } } });
        else
          await write({
            op: 'set',
            collection: 'talk',
            id: date,
            data: { ...envelope('E.V. Home', m.at), date, messages: { [id]: clean(body) } },
          });
        T.created.add(date);
      });
      talkQ = p.catch(e => toast('Couldn’t save to the conversation: ' + ((e && (e.code || e.message)) || 'error')));
      return p;
    }
    const evSay = (text, cards = [], o = {}) =>
      postMsg({
        id: msgId('e'),
        role: 'ev',
        text,
        cards,
        at: now(),
        tier: o.tier || 'local',
        ...(o.replyTo ? { replyTo: o.replyTo } : {}),
      });
    const mattSay = text => {
      const id = msgId('m');
      capEcho(id, text);
      return postMsg({ id, role: 'matt', text, at: now() }).then(
        () => id,
        () => id
      );
    };

