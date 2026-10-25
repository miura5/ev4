    // ---------------------------------------------------------------- writing to the thread
    function postMsg(m, o = {}) {
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
      // B-389: his own line is never simply gone: his words go back into the composer (T.restoreInput, set by it) to
      // send again, and the line says so in plain words, never a bare code such as "conflict". B-394: also when he
      // has started a new line meanwhile (B-395: the refused words go after what he is typing, which is never changed).
      // Lines refused back to back come back in the order he sent them (talkQ settles them in that order) and are said
      // in one toast once nothing more waits.
      talkQueued++;
      talkQ = p.then(
        () => {
          talkQueued--;
          refusedToast();
        },
        e => {
          talkQueued--;
          T.local.delete(id);
          render();
          const back = m.role === 'matt' && o.restore !== false && T.restoreInput ? T.restoreInput(m.text) : false;
          const why =
            e && e.conflict
              ? 'the conversation changed while you were writing'
              : (e && (e.message || e.code)) || 'error';
          refusedRun = refusedRun || { n: 0, why, back: false };
          refusedRun.n++;
          refusedRun.back = refusedRun.back || back;
          refusedToast();
        }
      );
      return p;
    }
    function refusedToast() {
      if (talkQueued || !refusedRun) return;
      const { n, why, back } = refusedRun;
      refusedRun = null;
      toast(
        'Couldn’t save ' +
          (n > 1 ? n + ' lines ' : '') +
          'to the conversation: ' +
          why +
          (back
            ? n > 1
              ? '. Your words are back in the box, in order, to send again.'
              : '. Your words are back in the box to send again.'
            : '')
      );
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
    // B-394: a line of his the record refused rejects (e.refused), after postMsg has put his words back, so no caller
    // goes on to answer a line that was never saved; a resend is then his one line, not a second copy.
    const mattSay = (text, o = {}) => {
      const id = msgId('m');
      capEcho(id, text);
      return postMsg({ id, role: 'matt', text, at: now() }, o).then(
        () => id,
        e => {
          throw Object.assign(e instanceof Error ? e : new Error(String(e)), { refused: true, lineId: id });
        }
      );
    };

