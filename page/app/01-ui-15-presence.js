    // ---- Proprietary 15 Presence (B-508; D-374, D-381): E.V. herself, her hand-made flower (CORE, page/app/60-ev-
    // conversation.js) at one of three sizes and in one of five states. Only she glows (D-381); the flower stays hers
    // and the component only sizes and names it. A follow presence moves with her own state (CORE.setMood); any other
    // keeps the state it was made with. She is decorative unless a label is given (then an image, or a status while
    // loading).
    //   DS.presence({ size: 'sm' | 'md' | 'stage', state: 'idle', follow: false, px: 104, label: 'E.V.' })
    // sm is 24 px (the header, the sidebar), md 32 px (beside her line), stage 104 px unless px says (her stage,
    // D-213).
    const PRESENCE_PX = { sm: 24, md: 32, stage: 104 };
    const PRESENCE_MOOD = {
      idle: 'idle',
      thinking: 'thinking',
      speaking: 'speaking',
      quiet: 'sleepy',
      loading: 'thinking',
    };
    function dsPresence(o = {}) {
      const size = PRESENCE_PX[o.size] ? o.size : 'md';
      const px = Math.round(o.px || PRESENCE_PX[size]);
      const state = PRESENCE_MOOD[o.state] ? o.state : 'idle';
      const r = dsRoot('span', 'presence', { ...o, size, vars: { ...o.vars, 'presence-s': px + 'px' } }, 'presence');
      r.dataset.state = state;
      const core = CORE.make(px, { mood: PRESENCE_MOOD[state], follow: !!o.follow, when: o.when, still: !!o.still });
      r.append(core.el);
      if (o.label) {
        r.setAttribute('role', state === 'loading' ? 'status' : 'img');
        r.setAttribute('aria-label', o.label);
      } else r.setAttribute('aria-hidden', 'true');
      if (state === 'loading') r.setAttribute('aria-busy', 'true');
      return r;
    }
