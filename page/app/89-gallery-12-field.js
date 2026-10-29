    // ---- Gallery 12 Field: function galDsField(), its state cells, staging only (D-388); lane C2 (B-508)
    function galDsField() {
      const f = (state, o) => galCell(state, DS.field({ label: 'Title', placeholder: 'Read chapter 12', ...o }));
      return [
        f('rest', { hint: 'One line; it shows on Today.' }),
        f('filled, saving', { value: 'Fluids and electrolytes', state: 'saving' }),
        f('saved', { value: 'Fluids and electrolytes', state: 'saved' }),
        f('invalid', { value: '', error: 'Give it a title first.' }),
        f('disabled', { value: 'IV rates', disabled: true }),
        f('textarea', {
          kind: 'textarea',
          label: 'Note',
          placeholder: 'What to remember',
          value: 'Protamine reverses heparin.',
        }),
        f('select', { kind: 'select', label: 'Course', options: ['NUR 112', 'BIO 201'] }),
        f('date', { kind: 'date', label: 'Exam date', value: '2026-11-05' }),
        f('switch', { kind: 'switch', label: 'Reduce motion', checked: true }),
        f('switch off', { kind: 'switch', label: 'Sounds' }),
        f('checkbox', { kind: 'checkbox', label: 'Include weak spots', checked: true }),
        f('checkbox off', { kind: 'checkbox', label: 'Only due cards' }),
      ];
    }
