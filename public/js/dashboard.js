// Dashboard utilities
document.addEventListener('DOMContentLoaded', () => {
  // Redraw charts on theme change (observe data-theme attribute)
  const observer = new MutationObserver(() => {
    document.querySelectorAll('canvas').forEach(canvas => {
      const chart = Chart.getChart(canvas);
      if (chart) {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const textC  = isDark ? '#7c8ba1' : '#5a6580';
        const gridC  = isDark ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.06)';
        if (chart.options.scales?.x) {
          chart.options.scales.x.grid.color = gridC;
          chart.options.scales.x.ticks.color = textC;
        }
        if (chart.options.scales?.y) {
          chart.options.scales.y.grid.color = gridC;
          chart.options.scales.y.ticks.color = textC;
        }
        if (chart.options.plugins?.legend?.labels) {
          chart.options.plugins.legend.labels.color = textC;
        }
        chart.update();
      }
    });
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
});
