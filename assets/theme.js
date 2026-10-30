(function () {
  const root = document.documentElement;

  let selected;
  try { selected = localStorage.getItem("feaTheme"); } catch {}
  const preference = window.matchMedia("(prefers-color-scheme: dark)");
  function applyTheme(theme = selected || (preference.matches ? "dark" : "light")) {
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    document.querySelectorAll("[data-theme-toggle]").forEach(button => button.setAttribute("aria-label", `Switch to ${theme === "dark" ? "light" : "dark"} theme`));
  }
  document.addEventListener("click", event => {
    if (!event.target.closest("[data-theme-toggle]")) return;
    selected = root.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("feaTheme", selected); } catch {}
    applyTheme(selected);
  });
  preference.addEventListener("change", () => { if (!selected) applyTheme(); });

  applyTheme();

  document.addEventListener("DOMContentLoaded", () => {
    applyTheme();
    const header = document.querySelector(".site-header");
    const setHeaderOffset = () => {
      if (!header) return;
      root.style.setProperty("--header-offset", `${Math.ceil(header.getBoundingClientRect().height)}px`);
    };
    setHeaderOffset();
    window.addEventListener("resize", setHeaderOffset, { passive: true });
    if (window.ResizeObserver && header) {
      new ResizeObserver(setHeaderOffset).observe(header);
    }
    document.querySelectorAll(".site-footer").forEach((footer) => {
      if (!footer.querySelector(".footer-logo-link")) {
        const logo = document.createElement("a");
        logo.className = "footer-logo-link";
        logo.href = "/";
        logo.setAttribute("aria-label", "Federal Elections Analysis home");
        logo.innerHTML = '<img src="/assets/img/FEA_Icon.webp" alt=""><span>Federal Elections Analysis</span>';
        footer.prepend(logo);
      }
      const copyHost = footer.querySelector(":scope > div");
      if (copyHost && !copyHost.querySelector(".footer-copyright")) {
        const copyright = document.createElement("p");
        copyright.className = "footer-copyright";
        copyright.textContent = "Federal Elections Analysis ©";
        copyHost.append(copyright);
      }
    });
    const desktopHover = window.matchMedia("(hover: hover) and (pointer: fine)");
    document.querySelectorAll(".nav-dropdown").forEach((dropdown) => {
      let closeTimer = null;
      const open = () => {
        if (!desktopHover.matches) return;
        clearTimeout(closeTimer);
        dropdown.open = true;
      };
      const close = () => {
        if (!desktopHover.matches) return;
        closeTimer = setTimeout(() => {
          if (!dropdown.matches(":hover") && !dropdown.contains(document.activeElement)) {
            dropdown.open = false;
          }
        }, 120);
      };
      dropdown.addEventListener("mouseenter", open);
      dropdown.addEventListener("focusin", open);
      dropdown.addEventListener("mouseleave", close);
      dropdown.addEventListener("focusout", close);
      dropdown.querySelector("summary")?.addEventListener("click", (event) => {
        if (desktopHover.matches) {
          event.preventDefault();
          dropdown.open = true;
          return;
        }
        document.querySelectorAll(".nav-dropdown[open]").forEach((otherDropdown) => {
          if (otherDropdown !== dropdown) otherDropdown.open = false;
        });
      });
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      document.querySelectorAll('.nav-dropdown[open]').forEach(dropdown => {
        if (dropdown.contains(document.activeElement)) dropdown.querySelector('summary')?.focus();
        dropdown.open = false;
      });
    });
    document.addEventListener('click', (event) => {
      document.querySelectorAll('.nav-dropdown[open]').forEach(dropdown => {
        if (!dropdown.contains(event.target) || event.target.closest('.nav-dropdown-menu a')) dropdown.open = false;
      });
    });
  });
})();
