(function () {
  const root = document.documentElement;

  function applyTheme() {
    root.dataset.theme = "dark";
    root.style.colorScheme = "dark";
  }

  applyTheme();

  document.addEventListener("DOMContentLoaded", () => {
    applyTheme();
  });
})();
