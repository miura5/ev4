    // ------------------------------------------------------------ fold motion (B-576)
    // dsGrow(node, open, done) opens a node by height and opacity (--dur-fold-open, its fade --dur-fold-fade) or closes
    // it (--dur-fold-close), then runs done (on a close with no done, it sets hidden). Nothing scales and nothing above
    // it moves; reduced motion is instant. Only inline styles and animations touch the node while it runs.
    function foldMs(name) {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v.endsWith('ms') ? parseFloat(v) || 0 : v.endsWith('s') ? (parseFloat(v) || 0) * 1000 : 0;
    }
    function foldStill() {
      return (
        document.documentElement.dataset.motion === 'reduce' ||
        (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
      );
    }
    function dsGrow(node, open, done) {
      if (!node) return done && done();
      const end = () => {
        if (done) done();
        else if (!open) node.hidden = true;
      };
      if (node._fold) node._fold.forEach(a => a.cancel());
      if (open) node.hidden = false;
      const ms = foldMs(open ? '--dur-fold-open' : '--dur-fold-close');
      if (foldStill() || !node.animate || !node.isConnected || ms < 1) return end();
      const cs = getComputedStyle(node);
      if (cs.display === 'none') return end();
      const full = {
        height: node.getBoundingClientRect().height + 'px',
        paddingTop: cs.paddingTop,
        paddingBottom: cs.paddingBottom,
        marginTop: cs.marginTop,
        marginBottom: cs.marginBottom,
      };
      const none = { height: '0px', paddingTop: '0px', paddingBottom: '0px', marginTop: '0px', marginBottom: '0px' };
      const ease = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || 'ease';
      const was = node.style.overflow;
      node.style.overflow = 'hidden';
      const fill = open ? 'none' : 'forwards';
      const anims = [
        node.animate(open ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }], {
          duration: open ? foldMs('--dur-fold-fade') || ms : ms,
          easing: ease(open ? '--ease-out' : '--ease-in'),
          fill,
        }),
      ];
      // an inline node has no height of its own to grow: it fades only
      if (!cs.display.startsWith('inline'))
        anims.push(
          node.animate(open ? [none, full] : [full, none], {
            duration: ms,
            easing: ease(open ? '--ease-std' : '--ease-in'),
            fill,
          })
        );
      node._fold = anims;
      const last = anims[anims.length - 1];
      last.onfinish = () => {
        node._fold = null;
        node.style.overflow = was;
        end();
        if (!open) anims.forEach(a => a.cancel());
      };
      last.oncancel = () => {
        node.style.overflow = was;
      };
    }
    /** B-576: a fold whose view draws itself again on a tap. Its body's nodes carry data-fold-key (foldTag); open: draw,
     *  then grow what came in; close: shrink what shows, then draw. */
    function dsFoldFlip(key, open, apply) {
      const q = () => [...document.querySelectorAll('[data-fold-key]')].filter(n => n.dataset.foldKey === key);
      if (open) {
        apply();
        q().forEach(n => dsGrow(n, true));
        return;
      }
      const ns = q().filter(n => !n.hidden && n.getClientRects().length);
      if (!ns.length || foldStill()) return apply();
      let left = ns.length;
      ns.forEach(n => dsGrow(n, false, () => --left === 0 && apply()));
    }
    function foldTag(key, ...nodes) {
      const all = nodes.flat().filter(Boolean);
      for (const n of all) n.dataset.foldKey = key;
      return all;
    }
