(function () {
  const storageKey = "federal-elections-theme";
  const root = document.documentElement;

  function systemTheme() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function selectedTheme() {
    const stored = localStorage.getItem(storageKey);
    return stored === "dark" || stored === "light" ? stored : systemTheme();
  }

  function applyTheme(theme) {
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      button.setAttribute("aria-label", `Switch to ${theme === "dark" ? "light" : "dark"} mode`);
      button.title = `Switch to ${theme === "dark" ? "light" : "dark"} mode`;
    });
  }

  applyTheme(selectedTheme());

  document.addEventListener("DOMContentLoaded", () => {
    applyTheme(selectedTheme());
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        const next = root.dataset.theme === "dark" ? "light" : "dark";
        localStorage.setItem(storageKey, next);
        applyTheme(next);
      });
    });
  });
})();
