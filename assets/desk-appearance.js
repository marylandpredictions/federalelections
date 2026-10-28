/* Appearance is a local, reversible preview; applying it never fetches result data. */
window.FEAAppearance = function () {
  const T = FEADeskTheme,
    clone = (x) => JSON.parse(JSON.stringify(x)),
    el = (tag, text) => {
      const n = document.createElement(tag);
      if (text) n.textContent = text;
      return n;
    };
  let store;
  try {
    store = T.read(localStorage);
  } catch {
    store = T.read({ getItem: () => null });
  }
  let draft = clone(store.current),
    before = clone(store.current),
    previousFocus;
  T.apply(store.current);
  const dialog = el("dialog");
  dialog.id = "desk-appearance";
  dialog.setAttribute("aria-labelledby", "appearance-title");
  dialog.innerHTML =
    '<header><div><small>YOUR ELECTION DESK</small><h2 id="appearance-title">Appearance</h2></div><button type="button" data-cancel aria-label="Close Appearance">×</button></header><div class="appearance-scroll"><label>Theme<select id="desk-theme-select"></select></label><div id="theme-preview" aria-label="Theme preview"></div><div id="simple-theme"></div><details id="advanced-theme"><summary>Advanced customization</summary><div id="advanced-tokens"></div><label>Import / export theme JSON<textarea id="theme-json" rows="4" maxlength="16000" spellcheck="false"></textarea></label><button type="button" data-import>Import theme</button><button type="button" data-export>Export theme</button></details><p id="theme-feedback" role="status"></p><p id="contrast-feedback" role="status"></p><button type="button" data-fix>Fix contrast automatically</button><label>Theme name<input id="theme-name" maxlength="60"></label><div class="theme-library-actions"><button type="button" data-save>Save theme</button><button type="button" data-rename>Rename saved</button><button type="button" data-duplicate>Duplicate</button><button type="button" data-delete>Delete saved</button><button type="button" data-reset>Reset custom settings</button><button type="button" data-defaults>Restore FEA defaults</button></div></div><footer><button type="button" data-cancel>Cancel</button><button type="button" data-apply>Use theme</button></footer>';
  document.body.append(dialog);
  const q = (s) => dialog.querySelector(s),
    feedback = (message) => (q("#theme-feedback").textContent = message);
  function persist() {
    try {
      localStorage.setItem(T.key, JSON.stringify(store));
    } catch {
      feedback("Theme storage is unavailable in this browser.");
    }
  }
  function preview() {
    const r = T.apply(draft);
    q("#contrast-feedback").textContent = r.warnings.length
      ? "Contrast needs attention: " + r.warnings.join(", ")
      : "Text contrast checks pass.";
    q("[data-fix]").hidden = !r.warnings.length;
    const view = q("#theme-preview");
    view.replaceChildren();
    for (const [party, state] of [
      ["D", "Called"],
      ["D", "Leading"],
      ["R", "Leading"],
      ["R", "Called"],
      ["I", "Independent"],
      ["O", "Other"],
    ]) {
      const box = el("span", party + " " + state);
      box.style.background =
        state === "Leading"
          ? T.mix(r.partyColors[party], r.tokens["map-neutral"], 0.5)
          : r.partyColors[party];
      box.style.color = T.foreground(
        box.style.background.startsWith("#")
          ? box.style.background
          : r.partyColors[party],
      );
      view.append(box);
    }
  }
  function colorInput(host, label, value, change, reset) {
    const wrap = el("div");
    wrap.className = "theme-color-field";
    const lab = el("label", label),
      input = el("input");
    input.type = "color";
    input.value = value;
    input.setAttribute("aria-label", label);
    input.addEventListener("input", () => {
      change(input.value);
      preview();
    });
    lab.append(input);
    wrap.append(lab);
    if (reset) {
      const button = el("button", "Reset");
      button.type = "button";
      button.setAttribute("aria-label", "Reset " + label);
      button.onclick = () => {
        reset();
        fields();
        preview();
      };
      wrap.append(button);
    }
    host.append(wrap);
  }
  function fields() {
    const select = q("#desk-theme-select");
    select.replaceChildren();
    for (const t of [...T.presets, ...store.saved]) {
      const o = el("option", t.name);
      o.value = t.id;
      select.append(o);
    }
    select.value = [...T.presets, ...store.saved].some((t) => t.id === draft.id)
      ? draft.id
      : "custom";
    q("#theme-name").value = draft.name;
    const simple = q("#simple-theme");
    simple.replaceChildren();
    const modeLabel = el("label", "Mode"),
      mode = el("select");
    mode.setAttribute("aria-label", "Theme mode");
    for (const value of ["dark", "light", "system"]) {
      const o = el("option", value[0].toUpperCase() + value.slice(1));
      o.value = value;
      mode.append(o);
    }
    mode.value = draft.mode;
    mode.onchange = () => {
      draft.mode = mode.value;
      preview();
    };
    modeLabel.append(mode);
    simple.append(modeLabel);
    const motionLabel = el("label", "Reduce motion"),
      motion = el("input");
    motion.type = "checkbox";
    motion.checked = draft.motion === "reduced";
    motion.setAttribute("aria-label", "Reduce motion");
    motion.onchange = () => {
      draft.motion = motion.checked ? "reduced" : "system";
      preview();
    };
    motionLabel.append(motion);
    simple.append(motionLabel);
    colorInput(
      simple,
      "Theme color",
      draft.baseColor,
      (v) => (draft.baseColor = v),
      () => (draft.baseColor = T.presets[0].baseColor),
    );
    for (const [key, name] of [
      ["D", "Democratic"],
      ["R", "Republican"],
      ["I", "Independent"],
      ["O", "Other"],
    ])
      colorInput(
        simple,
        name + " color",
        draft.partyColors[key],
        (v) => (draft.partyColors[key] = v),
        () => (draft.partyColors[key] = T.presets[0].partyColors[key]),
      );
    const advanced = q("#advanced-tokens");
    advanced.replaceChildren();
    for (const [name, keys] of Object.entries(T.groups)) {
      const section = el("details"),
        summary = el("summary", name),
        reset = el("button", "Reset section");
      reset.type = "button";
      reset.onclick = () => {
        for (const key of keys) delete draft.advanced[key];
        fields();
        preview();
      };
      section.append(summary, reset);
      for (const key of keys)
        colorInput(
          section,
          key,
          draft.advanced[key] || T.resolve(draft).tokens[key],
          (v) => (draft.advanced[key] = v),
          () => delete draft.advanced[key],
        );
      advanced.append(section);
    }
    const saved = store.saved.some((t) => t.id === draft.id);
    q("[data-delete]").disabled = !saved;
    q("[data-rename]").disabled = !saved;
  }
  const uid = () =>
    "custom-" +
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 7);
  function save(duplicate = false) {
    draft.name = q("#theme-name").value.trim() || "My Election Night";
    if (duplicate || !store.saved.some((t) => t.id === draft.id))
      draft.id = uid();
    try {
      draft = T.validate(draft);
      const i = store.saved.findIndex((t) => t.id === draft.id);
      if (i < 0) {
        if (store.saved.length >= 30) throw Error("Save up to 30 themes.");
        store.saved.push(clone(draft));
      } else store.saved[i] = clone(draft);
      persist();
      fields();
      feedback("Saved on this browser.");
    } catch (e) {
      feedback(e.message);
    }
  }
  q("#desk-theme-select").onchange = (event) => {
    draft = clone(
      [...T.presets, ...store.saved].find((t) => t.id === event.target.value),
    );
    fields();
    preview();
  };
  q("[data-save]").onclick = () => save();
  q("[data-duplicate]").onclick = () => save(true);
  q("[data-rename]").onclick = () => save();
  q("[data-delete]").onclick = () => {
    if (store.current.id === draft.id) store.current = clone(T.presets[0]);
    store.saved = store.saved.filter((t) => t.id !== draft.id);
    draft = clone(T.presets[0]);
    persist();
    fields();
    preview();
    feedback("Saved theme deleted.");
  };
  q("[data-reset]").onclick = () => {
    draft.advanced = {};
    draft.baseColor = T.presets[0].baseColor;
    draft.partyColors = clone(T.presets[0].partyColors);
    fields();
    preview();
  };
  q("[data-defaults]").onclick = () => {
    draft = clone(T.presets[0]);
    fields();
    preview();
  };
  q("[data-fix]").onclick = () => {
    const r = T.resolve(draft);
    for (const key of ["text-primary", "text-secondary", "text-muted"])
      draft.advanced[key] = T.foreground(r.tokens["panel-bg"]);
    for (const key of [
      "control-bg",
      "tooltip-bg",
      "race-window-bg",
      "projection-bg",
    ])
      draft.advanced[key] = r.tokens["panel-bg"];
    fields();
    preview();
  };
  q("[data-export]").onclick = () => {
    q("#theme-json").value = JSON.stringify(T.validate(draft), null, 2);
    feedback("Theme JSON is ready to copy.");
  };
  q("[data-import]").onclick = () => {
    try {
      const imported = T.validate(JSON.parse(q("#theme-json").value));
      draft = { ...imported, id: uid() };
      fields();
      preview();
      feedback("Imported preview. Save to keep a named copy.");
    } catch (e) {
      feedback("Theme rejected: " + e.message);
    }
  };
  const cancel = () => {
    T.apply(before);
    dialog.close();
    previousFocus?.focus();
  };
  dialog.querySelectorAll("[data-cancel]").forEach((b) => (b.onclick = cancel));
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    cancel();
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") event.stopPropagation();
  });
  q("[data-apply]").onclick = () => {
    store.current = clone(draft);
    persist();
    T.apply(draft);
    dialog.close();
    previousFocus?.focus();
  };
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (T.current.mode === "system") {
      T.apply(T.current);
      if (dialog.open) preview();
    }
  });
  return {
    open() {
      previousFocus = document.activeElement;
      before = clone(T.current);
      draft = clone(before);
      fields();
      feedback(
        "Changes preview live. Cancel restores your previous appearance.",
      );
      dialog.showModal();
      preview();
      q("#desk-theme-select").focus();
    },
  };
};
