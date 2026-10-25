    // ---------------------------------------------------------------- writing to the thread
    function postMsg(m) {
      const { id, pending, error, greeting, day, ...body } = m;
      const date = E.chicagoDate(m.at);
      body.text = String(body.text || '').slice(0, 4000);
      if (error) body.error = error;
      // B-74 (D-128): a line written while a study session or a skills run is going on carries its session, so the
      // session is its own conversation.
      const ss = !body.session && !body.jobId && (activeSession() || activeSkill());
      if (ss && ss.status !== 'ended') body.session = ss.id;
      T.local.set(id, { ...m, ...(body.session ? { session: body.session } : {}), pending: false });
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
            data: { ...envelope('E.V. Home', m.at), schema: 4, date, messages: { [id]: clean(body) } }, // B-178: talk 3; B-227: talk 4
          });
        T.created.add(date);
      });
      // B-200 (D-208): the line painted on his tap; a refused write takes it back out and says why in one line.
      talkQ = p.catch(e => {
        T.local.delete(id);
        render();
        toast('Couldn’t save to the conversation: ' + ((e && (e.code || e.message)) || 'error'));
      });
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
      T.lastMatt = String(text || ''); // B-381: his latest line, which record_score holds a score to
      capEcho(id, text);
      return postMsg({ id, role: 'matt', text, at: now() }).then(
        () => id,
        () => id
      );
    };

