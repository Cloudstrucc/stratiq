// Theme persistence
function toggleTheme() {
  const html    = document.documentElement;
  const isDark  = html.getAttribute('data-theme') === 'dark';
  const newTheme = isDark ? 'light' : 'dark';
  html.setAttribute('data-theme', newTheme);
  localStorage.setItem('stratiq-theme', newTheme);
  updateThemeIcons(newTheme);
}

function updateThemeIcons(theme) {
  const icon = theme === 'dark' ? 'bi-moon-fill' : 'bi-sun-fill';
  document.querySelectorAll('[id^="themeIcon"]').forEach(el => {
    el.className = 'bi ' + icon;
  });
}

// Apply saved theme on load
(function() {
  const saved = localStorage.getItem('stratiq-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  // Icons update after DOM loads
  document.addEventListener('DOMContentLoaded', () => updateThemeIcons(saved));
})();
