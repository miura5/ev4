    // ---- Gallery 08 Notice: function galDsNotice(), its state cells, staging only (D-388); lane C1 (B-507)
    function galDsNotice() {
      const N = DS.notice;
      const list = n => {
        const ul = el('ul', 'list');
        ul.append(n);
        return ul;
      };
      return [
        galCell('empty', list(N({ line: 'Nothing due today.', tag: 'li', cls: 'row' }))),
        galCell('info', N({ kind: 'info', line: 'Your plan follows the exam on Tue 3 Nov.' })),
        galCell('working', N({ kind: 'working', line: 'Making your plan', expected: 'about 2 min' })),
        galCell(
          'failed',
          N({ kind: 'failed', line: 'The plan didn’t finish: Canvas didn’t answer.', onRetry: () => {} })
        ),
      ];
    }
