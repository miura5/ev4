    // ---- Gallery 18 Chart: function galDsChart(), its state cells, staging only (D-388); lane 1 (B-515)
    function galDsChart() {
      const days = ['Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu'];
      const v = [80, null, 60, 100, 45, null, 70];
      return [
        galCell(
          'a week, two days empty',
          DS.chart({
            label: 'Percent right per day',
            bars: days.map((d, i) => ({ value: v[i], under: [d, v[i] == null ? '–' : 5 + i + ' q'] })),
          })
        ),
      ];
    }
