/* Validated local themes. No imported value is interpreted as HTML or CSS code. */
(function (scope) {
  const hex = /^#[0-9a-f]{6}$/i;
  const defaults = { D: "#1687e8", R: "#df2e38", I: "#9867e8", O: "#d49c39" };
  const groups = {
    Canvas: ["board-bg", "map-bg", "map-neutral"],
    Surfaces: [
      "panel-bg",
      "panel-raised",
      "control-bg",
      "hover-bg",
      "tooltip-bg",
    ],
    Borders: [
      "panel-border",
      "state-border",
      "county-border",
      "district-border",
      "selection",
      "focus",
    ],
    Text: ["text-primary", "text-secondary", "text-muted"],
    Status: ["tossup", "watch", "uncalled", "called", "flip", "warning"],
    Charts: ["chart-grid", "chart-axis", "chart-line"],
    "Election desk": [
      "projection-bg",
      "poll-bg",
      "tray-bg",
      "pin-bg",
      "race-window-bg",
    ],
  };
  const tokenNames = Object.values(groups).flat();
  function validate(raw) {
    if (
      !raw ||
      raw.schemaVersion !== 1 ||
      typeof raw.id !== "string" ||
      !/^[\w-]{1,80}$/.test(raw.id) ||
      typeof raw.name !== "string" ||
      !raw.name.trim() ||
      raw.name.length > 60 ||
      !["dark", "light", "system"].includes(raw.mode) ||
      !hex.test(raw.baseColor)
    )
      throw Error("Invalid theme or unsupported theme version.");
    const partyColors = {};
    for (const p of ["D", "R", "I", "O"]) {
      if (!hex.test(raw.partyColors?.[p]))
        throw Error("Each party color must use six hexadecimal digits.");
      partyColors[p] = raw.partyColors[p];
    }
    const advanced = {};
    if (
      raw.advanced &&
      (typeof raw.advanced !== "object" || Array.isArray(raw.advanced))
    )
      throw Error("Invalid advanced theme.");
    for (const [key, value] of Object.entries(raw.advanced || {})) {
      if (!tokenNames.includes(key) || !hex.test(value))
        throw Error("Unknown or invalid theme token.");
      advanced[key] = value;
    }
    if (raw.motion !== undefined && !["system", "reduced"].includes(raw.motion))
      throw Error("Invalid motion preference.");
    return {
      schemaVersion: 1,
      id: raw.id,
      name: raw.name.trim(),
      mode: raw.mode,
      baseColor: raw.baseColor,
      partyColors,
      advanced,
      motion: raw.motion || "system",
    };
  }
  const make = (
    id,
    name,
    mode,
    baseColor,
    partyColors = defaults,
    advanced = {},
  ) =>
    validate({
      schemaVersion: 1,
      id,
      name,
      mode,
      baseColor,
      partyColors,
      advanced,
    });
  const presets = [
    make("fea-night", "FEA Night", "dark", "#849eed"),
    make("fea-light", "FEA Light", "light", "#849eed"),
    make("system", "System", "system", "#849eed"),
    make("high-contrast", "High Contrast", "dark", "#b5c8ff", defaults, {
      "board-bg": "#030712",
      "panel-bg": "#080f1c",
      "text-primary": "#ffffff",
      "text-secondary": "#e1e8f5",
      "panel-border": "#aabbd3",
    }),
    make("california-inspired", "California Inspired", "dark", "#1030b2", {
      ...defaults,
      D: "#1030b2",
      R: "#ff2a4f",
    }),
  ];
  function mix(a, b, t) {
    return (
      "#" +
      [1, 3, 5]
        .map((i) =>
          Math.round(
            parseInt(a.slice(i, i + 2), 16) * (1 - t) +
              parseInt(b.slice(i, i + 2), 16) * t,
          )
            .toString(16)
            .padStart(2, "0"),
        )
        .join("")
    );
  }
  function luminance(c) {
    const v = [1, 3, 5]
      .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
      .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return v[0] * 0.2126 + v[1] * 0.7152 + v[2] * 0.0722;
  }
  const contrast = (a, b) => {
    const x = luminance(a),
      y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const foreground = (bg) =>
    contrast("#ffffff", bg) > contrast("#101828", bg) ? "#ffffff" : "#101828";
  function resolve(input, systemDark = true) {
    const t = validate(input),
      mode = t.mode === "system" ? (systemDark ? "dark" : "light") : t.mode,
      dark = mode === "dark",
      b = t.baseColor;
    const out = {
      "board-bg": mix(b, dark ? "#020711" : "#f8fafc", dark ? 0.91 : 0.94),
      "map-bg": mix(b, dark ? "#020711" : "#f8fafc", dark ? 0.91 : 0.94),
      "map-neutral": mix(b, dark ? "#273649" : "#c7d0dc", 0.76),
      "panel-bg": mix(b, dark ? "#101c2c" : "#ffffff", dark ? 0.87 : 0.98),
      "panel-raised": mix(b, dark ? "#1c2c40" : "#eef2f7", 0.86),
      "control-bg": mix(b, dark ? "#21324a" : "#e9eff7", 0.85),
      "hover-bg": mix(b, dark ? "#2d4462" : "#dbe5f3", 0.8),
      "panel-border": mix(b, dark ? "#52627d" : "#c6d2e1", 0.8),
      "text-primary": dark ? "#f5f7fd" : "#152a49",
      "text-secondary": dark ? "#bdcce0" : "#4a5c73",
      "text-muted": dark ? "#a4b7d0" : "#536782",
      selection: dark ? "#ffdc73" : "#725600",
      focus: dark ? "#c1d1ff" : "#223e86",
      "state-border": dark ? "#91a4bf" : "#526782",
      "county-border": dark ? "#9bacc2" : "#5e7189",
      "district-border": dark ? "#adc2de" : "#506780",
      tossup: "#f4d65c",
      watch: b,
      uncalled: mix(b, "#536176", 0.8),
      called: "#a5d8b5",
      flip: "#e2b460",
      warning: dark ? "#ffd18a" : "#765000",
      "chart-line": dark ? mix(b, "#ffffff", 0.4) : mix(b, "#142645", 0.65),
      "chart-grid": dark ? "#43546c" : "#c2cedd",
      "chart-axis": dark ? "#b7c6dc" : "#4a5c73",
    };
    out["tooltip-bg"] = out["panel-bg"];
    for (const key of [
      "projection-bg",
      "poll-bg",
      "tray-bg",
      "pin-bg",
      "race-window-bg",
    ])
      out[key] = out["panel-bg"];
    Object.assign(out, t.advanced);
    const warnings = [];
    for (const [fg, bg] of [
      ["text-primary", "panel-bg"],
      ["text-secondary", "panel-bg"],
      ["text-primary", "control-bg"],
      ["text-primary", "tooltip-bg"],
      ["text-primary", "race-window-bg"],
      ["text-primary", "projection-bg"],
    ])
      if (contrast(out[fg], out[bg]) < 4.5) warnings.push(`${fg} on ${bg}`);
    return { mode, tokens: out, partyColors: t.partyColors, warnings };
  }
  function hash(s) {
    let n = 0;
    for (const c of String(s)) n = (n * 31 + c.charCodeAt(0)) >>> 0;
    return n;
  }
  let current = presets[0],
    resolved = resolve(current);
  function candidateColor(c = {}, peers = []) {
    const p = String(c.partyCode || c.party || "O").toUpperCase(),
      base = resolved.partyColors[p] || resolved.partyColors.O;
    const same = peers.filter(
        (k) => String(k.partyCode || k.party || "O").toUpperCase() === p,
      ),
      index = same.findIndex((k) => (k.id || k.name) === (c.id || c.name));
    if (index > 0)
      return mix(
        base,
        index % 2 ? "#ffffff" : "#182136",
        Math.min(0.62, 0.22 + index * 0.08),
      );
    if (!["D", "R", "I"].includes(p)) {
      const palette = [
        "#d49c39",
        "#35b4a7",
        "#d278b7",
        "#b2b647",
        "#a8a4ef",
        "#e3844e",
      ];
      return mix(
        palette[hash(p + ":" + (c.id || c.name || "")) % palette.length],
        base,
        0.3,
      );
    }
    return base;
  }
  const key = "feaDeskThemes.v1";
  function read(storage) {
    try {
      const x = JSON.parse(storage.getItem(key));
      if (x?.schemaVersion !== 1) throw Error();
      return {
        schemaVersion: 1,
        current: validate(x.current),
        saved: (x.saved || [])
          .slice(0, 30)
          .map(validate)
          .filter((t) => !presets.some((p) => p.id === t.id)),
      };
    } catch {
      return { schemaVersion: 1, current: presets[0], saved: [] };
    }
  }
  function apply(t, persist = false) {
    current = validate(t);
    resolved = resolve(
      current,
      scope.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true,
    );
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = resolved.mode;
      document.body.style.colorScheme = resolved.mode;
      document.body.dataset.motion = current.motion;
      for (const [k, v] of Object.entries(resolved.tokens))
        document.body.style.setProperty("--" + k, v);
      for (const [k, v] of Object.entries(resolved.partyColors)) {
        document.body.style.setProperty("--party-" + k.toLowerCase(), v);
        document.body.style.setProperty(
          "--party-" + k.toLowerCase() + "-text",
          contrast(v, resolved.tokens["panel-bg"]) >= 3
            ? v
            : foreground(resolved.tokens["panel-bg"]),
        );
      }
      if (persist)
        try {
          const x = read(localStorage);
          x.current = current;
          localStorage.setItem(key, JSON.stringify(x));
        } catch {}
      document.dispatchEvent(
        new CustomEvent("fea-desk-theme", { detail: resolved }),
      );
    }
    return resolved;
  }
  const api = {
    validate,
    resolve,
    presets,
    groups,
    tokenNames,
    mix,
    contrast,
    foreground,
    candidateColor,
    read,
    apply,
    key,
    get current() {
      return current;
    },
    get resolved() {
      return resolved;
    },
  };
  if (typeof module !== "undefined") module.exports = api;
  scope.FEADeskTheme = api;
})(typeof window === "undefined" ? globalThis : window);
