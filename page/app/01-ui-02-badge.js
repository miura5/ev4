    // ---- Proprietary 02 Badge: function dsBadge(o), declarations only (D-388); lane C1 (B-507)
    /**
     * Badge (B-504 #2): the small label that says what kind or what state a row is, one per row (D-276). Options: text,
     * tone (neutral when none; ok, warn, bad, info, violet, quiet, or proposed: a weak spot she inferred, D-235), course
     * (a course's name as the label: the quiet tone, as Notes shows it), cls, key. The dot carries the coded colour and
     * the words stay text. Today's classes (badge and x-<colour>, B-285) are its classes, so it looks as it did (D-376).
     */
    function dsBadge(o = {}) {
      const want = o.course != null && !o.tone ? 'quiet' : o.tone;
      const mod = want === 'proposed' ? 'proposed' : dsTone(want);
      const tone = mod ? want : undefined; // a tone it does not know paints as neutral, as the kit's badge() did
      const b = dsRoot('span', 'badge', Object.assign({}, o, { tone, cls: dsClasses('badge', o.cls, mod) }));
      const text = o.text != null ? o.text : o.course;
      if (text != null && text !== '') b.textContent = String(text);
      return b;
    }
