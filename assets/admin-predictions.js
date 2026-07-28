(() => {
  const officeFiles = {
    senate: "2026-senate-predictions.json",
    house: "2026-house-predictions.json",
    governor: "2026-governor-predictions.json"
  };
  const officeLabels = {
    senate: "Senate",
    house: "House",
    governor: "Governors"
  };
  const cycles = {
    D: ["Tilt Democratic", "Lean Democratic", "Likely Democratic", "Safe Democratic"],
    I: ["Tilt Independent", "Lean Independent", "Likely Independent", "Safe Independent"],
    R: ["Tilt Republican", "Lean Republican", "Likely Republican", "Safe Republican"]
  };

  const state = {
    secret: localStorage.getItem("feaAdminSecret") || "",
    bootstrap: null,
    office: "senate",
    data: null,
    selectedRaceId: "",
    editMode: "D",
    selectedRating: "Tilt Democratic",
    paintKeyDown: false,
    paintSession: null,
    importReport: null,
    undoStack: [],
    redoStack: [],
    dirty: false,
    mapController: null,
    mapRenderId: 0
  };

  const mapUtils = window.FeaPredictionMaps || {};
  const allowedRatings = mapUtils.allowedRatings || [
    "Safe Democratic",
    "Likely Democratic",
    "Lean Democratic",
    "Tilt Democratic",
    "Tossup",
    "Tilt Independent",
    "Lean Independent",
    "Likely Independent",
    "Safe Independent",
    "Tilt Republican",
    "Lean Republican",
    "Likely Republican",
    "Safe Republican"
  ];

  const $ = (id) => document.getElementById(id);

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    })[char]);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeRating(value) {
    return mapUtils.normalizeRating ? mapUtils.normalizeRating(value) : String(value || "Tossup");
  }

  function ratingParty(rating) {
    return mapUtils.ratingParty ? mapUtils.ratingParty(rating) : "Tossup";
  }

  function displayDate(value) {
    return mapUtils.displayDate ? mapUtils.displayDate(value) : String(value || "--");
  }

  function ratingClass(rating) {
    return `rating-${normalizeRating(rating).toLowerCase().replace(/\s+/g, "-")}`;
  }

  function isCompetitiveRating(rating) {
    const normalized = normalizeRating(rating);
    return normalized === "Tossup" || normalized.startsWith("Tilt") || normalized.startsWith("Lean");
  }

  function setStatus(message, isError = false) {
    const node = $("admin-status") || $("admin-login-status");
    if (!node) return;
    node.textContent = message;
    node.classList.toggle("is-error", isError);
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Secret": state.secret,
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || response.statusText);
    return data;
  }

  function fileRecord() {
    return (state.bootstrap?.files || []).find((entry) => entry.file === officeFiles[state.office]);
  }

  function raceTitle(race) {
    if (!race) return "No race selected";
    if (race.displayName) return race.displayName;
    if (state.office === "house") {
      return `${race.state || "--"}-${String(race.district || "").padStart(2, "0")} House`;
    }
    return `${race.state || "--"} ${officeLabels[state.office]}`;
  }

  function sortedRaces() {
    return [...(state.data?.races || [])].sort((a, b) =>
      String(a.state || "").localeCompare(String(b.state || ""))
      || String(a.district || "").localeCompare(String(b.district || ""), undefined, { numeric: true })
      || raceTitle(a).localeCompare(raceTitle(b))
    );
  }

  function selectedRace() {
    return (state.data?.races || []).find((race) => race.raceId === state.selectedRaceId) || null;
  }

  function candidateOrder(candidate) {
    const value = Number(candidate?.order);
    return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
  }

  function candidateEntries(race) {
    return Object.entries(race?.candidates || {})
      .filter(([, candidate]) => candidate && typeof candidate === "object")
      .sort(([, a], [, b]) =>
        candidateOrder(a) - candidateOrder(b)
        || Number(Boolean(b.incumbent)) - Number(Boolean(a.incumbent))
        || String(a.name || "").localeCompare(String(b.name || ""))
      );
  }

  function candidateKey(race, preferredParty = "I") {
    const candidates = race.candidates || {};
    const base = String(preferredParty || "I").trim().toUpperCase().slice(0, 1) || "I";
    if (!candidates[base]) return base;
    let index = 2;
    while (candidates[`${base}${index}`]) index += 1;
    return `${base}${index}`;
  }

  function updateCandidate(raceId, key, field, value) {
    const race = (state.data?.races || []).find((entry) => entry.raceId === raceId);
    if (!race?.candidates?.[key]) return;
    if (!state.dirty) pushUndo();
    if (field === "incumbent" || field === "presumptiveNominee") {
      race.candidates[key][field] = Boolean(value);
    } else if (field === "order") {
      const order = Number(value);
      if (String(value).trim() === "" || !Number.isFinite(order)) delete race.candidates[key].order;
      else race.candidates[key].order = order;
    } else {
      race.candidates[key][field] = String(value ?? "");
    }
    state.data.lastEdited = new Date().toISOString();
    state.data.lastEditedBy = "FEA admin";
    state.dirty = true;
  }

  function renameCandidateKey(raceId, oldKey, requestedKey) {
    const race = (state.data?.races || []).find((entry) => entry.raceId === raceId);
    if (!race?.candidates?.[oldKey]) return oldKey;
    const nextKey = String(requestedKey || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, "")
      .slice(0, 12);
    if (!nextKey) throw new Error("Candidate key cannot be blank.");
    if (nextKey !== oldKey && race.candidates[nextKey]) throw new Error(`Candidate key ${nextKey} is already used in this race.`);
    if (nextKey === oldKey) return oldKey;
    pushUndo();
    const entries = Object.entries(race.candidates).map(([key, candidate]) => (
      key === oldKey ? [nextKey, candidate] : [key, candidate]
    ));
    race.candidates = Object.fromEntries(entries);
    state.data.lastEdited = new Date().toISOString();
    state.data.lastEditedBy = "FEA admin";
    state.dirty = true;
    return nextKey;
  }

  function moveCandidate(raceId, key, direction) {
    const race = (state.data?.races || []).find((entry) => entry.raceId === raceId);
    if (!race?.candidates?.[key]) return;
    const entries = candidateEntries(race);
    const index = entries.findIndex(([candidateKey]) => candidateKey === key);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= entries.length) return;
    pushUndo();
    [entries[index], entries[target]] = [entries[target], entries[index]];
    entries.forEach(([candidateKey], order) => {
      race.candidates[candidateKey].order = order + 1;
    });
    state.data.lastEdited = new Date().toISOString();
    state.data.lastEditedBy = "FEA admin";
    state.dirty = true;
    render();
  }

  function addCandidate(raceId) {
    const race = (state.data?.races || []).find((entry) => entry.raceId === raceId);
    if (!race) return;
    pushUndo();
    race.candidates = race.candidates || {};
    const key = candidateKey(race, "I");
    race.candidates[key] = {
      name: "",
      party: "I",
      incumbent: false,
      presumptiveNominee: false,
      order: candidateEntries(race).length + 1
    };
    state.data.lastEdited = new Date().toISOString();
    state.data.lastEditedBy = "FEA admin";
    render();
    requestAnimationFrame(() => {
      document.querySelector(`[data-candidate-key="${key}"] input[data-candidate-field="name"]`)?.focus();
    });
  }

  function removeCandidate(raceId, key) {
    const race = (state.data?.races || []).find((entry) => entry.raceId === raceId);
    if (!race?.candidates?.[key]) return;
    pushUndo();
    delete race.candidates[key];
    state.data.lastEdited = new Date().toISOString();
    state.data.lastEditedBy = "FEA admin";
    render();
  }

  function summarize(data = state.data) {
    const counts = { D: 0, R: 0, I: 0, Tossup: 0 };
    const ratings = Object.fromEntries(allowedRatings.map((rating) => [rating, 0]));
    for (const race of data?.races || []) {
      const rating = normalizeRating(race?.prediction?.rating);
      ratings[rating] = (ratings[rating] || 0) + 1;
      const party = ratingParty(rating);
      if (party === "D") counts.D += 1;
      else if (party === "R") counts.R += 1;
      else if (party === "I") counts.I += 1;
      else counts.Tossup += 1;
    }
    return { counts, ratings, raceCount: (data?.races || []).length };
  }

  function rebuildSummary() {
    if (!state.data) return;
    const summary = summarize();
    state.data.summary = {
      ...(state.data.summary || {}),
      counts: {
        ...(state.data.summary?.counts || {}),
        D: summary.counts.D,
        R: summary.counts.R,
        I: summary.counts.I,
        Tossup: summary.counts.Tossup
      },
      ratingCounts: summary.ratings,
      competitiveCount: (state.data.races || []).filter((race) => {
        return isCompetitiveRating(race?.prediction?.rating);
      }).length
    };
  }

  function pushUndo() {
    if (!state.data) return;
    state.undoStack.push(JSON.stringify(state.data));
    if (state.undoStack.length > 80) state.undoStack.shift();
    state.redoStack = [];
    state.dirty = true;
  }

  function restoreFromStack(serialized) {
    state.data = JSON.parse(serialized);
    rebuildSummary();
    render();
  }

  function touchEditedData() {
    state.data.lastEdited = new Date().toISOString();
    state.data.lastEditedBy = "FEA admin";
    state.dirty = true;
  }

  function applyRaceRating(race, rating = state.selectedRating, options = {}) {
    if (!race) return;
    const current = normalizeRating(race?.prediction?.rating);
    const nextRating = normalizeRating(rating);
    if (nextRating === current) {
      if (options.select !== false) state.selectedRaceId = race.raceId;
      if (options.render !== false) render();
      return false;
    }
    if (options.pushUndo !== false) pushUndo();
    race.prediction = {
      ...(race.prediction || {}),
      rating: nextRating,
      status: race.prediction?.status || "published"
    };
    if (options.select !== false) state.selectedRaceId = race.raceId;
    touchEditedData();
    rebuildSummary();
    if (options.render !== false) render();
    if (options.status !== false) setStatus(`${raceTitle(race)} changed to ${nextRating}.`);
    return true;
  }

  function selectRatingMode(mode) {
    if (mode === "Tossup") {
      state.editMode = "Tossup";
      state.selectedRating = "Tossup";
      return;
    }
    const cycle = cycles[mode] || cycles.D;
    if (state.editMode === mode) {
      const index = Math.max(0, cycle.indexOf(state.selectedRating));
      state.selectedRating = cycle[(index + 1) % cycle.length];
    } else {
      state.editMode = mode;
      state.selectedRating = cycle[0];
    }
  }

  const stateNames = {
    AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
    CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho",
    IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
    ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
    MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
    NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
    NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
    PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
    TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
    WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming"
  };
  const stateFips = {
    AL: "01", AK: "02", AZ: "04", AR: "05", CA: "06", CO: "08", CT: "09", DE: "10",
    FL: "12", GA: "13", HI: "15", ID: "16", IL: "17", IN: "18", IA: "19", KS: "20",
    KY: "21", LA: "22", ME: "23", MD: "24", MA: "25", MI: "26", MN: "27", MS: "28",
    MO: "29", MT: "30", NE: "31", NV: "32", NH: "33", NJ: "34", NM: "35", NY: "36",
    NC: "37", ND: "38", OH: "39", OK: "40", OR: "41", PA: "42", RI: "44", SC: "45",
    SD: "46", TN: "47", TX: "48", UT: "49", VT: "50", VA: "51", WA: "53", WV: "54",
    WI: "55", WY: "56"
  };

  function canonicalRaceToken(value) {
    return String(value || "")
      .toUpperCase()
      .replace(/\b20\d{2}\b/g, " ")
      .replace(/\b(U\.?S\.?|CONGRESSIONAL|CONGRESS|DISTRICT|HOUSE|SENATE|GOVERNOR|GOVERNORS|ELECTION|GENERAL|PRIMARY|SPECIAL|RACE)\b/g, " ")
      .replace(/[^A-Z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, "-");
  }

  function raceAliasMap() {
    const aliases = new Map();
    for (const race of state.data?.races || []) {
      const stateCode = String(race.state || "").toUpperCase();
      const district = race.district == null ? "" : String(Number(race.district) || race.district).padStart(2, "0");
      const values = [
        race.raceId,
        race.displayName,
        district ? "" : stateCode,
        district ? "" : stateNames[stateCode],
        district ? "" : stateFips[stateCode],
        district ? `${stateCode}-${district}` : "",
        district ? `${stateCode}${Number(race.district)}` : "",
        district ? `${stateFips[stateCode]}-${district}` : "",
        district ? `${stateFips[stateCode]}${district}` : ""
      ];
      values.forEach((value) => {
        const key = canonicalRaceToken(value);
        if (key && (!aliases.has(key) || value === race.raceId)) aliases.set(key, race);
      });
    }
    return aliases;
  }

  function importedRating(value, partyHint = "") {
    const rawValue = typeof value === "object" && value
      ? value.rating ?? value.classification ?? value.category ?? value.lean ?? value.label ?? value.result ?? value.color
      : value;
    const raw = String(rawValue || "").trim();
    if (!raw) return "";
    const exact = allowedRatings.find((rating) => rating.toLowerCase() === raw.toLowerCase());
    if (exact) return exact;

    const colorRatings = new Map([
      ["#2c54bc", "Safe Democratic"], ["#4f73d1", "Likely Democratic"], ["#7694e2", "Lean Democratic"], ["#a0b6ef", "Tilt Democratic"],
      ["#cbcacd", "Tossup"],
      ["#c0a5e6", "Tilt Independent"], ["#a17bd6", "Lean Independent"], ["#865cc6", "Likely Independent"], ["#6f3db4", "Safe Independent"],
      ["#eba3a2", "Tilt Republican"], ["#dd7a78", "Lean Republican"], ["#cb5452", "Likely Republican"], ["#b5312f", "Safe Republican"],
      ["#c6d8ff", "Tilt Democratic"], ["#8aaafa", "Lean Democratic"], ["#577ccc", "Likely Democratic"], ["#1c408c", "Safe Democratic"],
      ["#8aafff", "Lean Democratic"], ["#949bb3", "Tilt Democratic"],
      ["#f4c7c8", "Tilt Republican"], ["#f0939b", "Lean Republican"], ["#d75d6d", "Likely Republican"], ["#bf1d29", "Safe Republican"],
      ["#ff5865", "Likely Republican"], ["#ff8b98", "Lean Republican"], ["#cf8980", "Tilt Republican"],
      ["#cccccc", "Tossup"]
    ]);
    const colorRating = colorRatings.get(raw.toLowerCase());
    if (colorRating) return colorRating;

    const combined = `${raw} ${partyHint}`.toLowerCase();
    if (/\b(toss[\s-]?up|tie|even)\b/.test(combined)) return "Tossup";
    const strength = /\b(safe|solid)\b/.test(combined) ? "Safe"
      : /\blikely\b/.test(combined) ? "Likely"
        : /\blean(?:ing)?\b/.test(combined) ? "Lean"
          : /\btilt\b/.test(combined) ? "Tilt"
            : "";
    if (!strength) return "";
    const party = /\b(democrat(?:ic)?|dem|blue)\b/.test(combined) || /\bd\b/.test(String(partyHint).toLowerCase()) ? "Democratic"
      : /\b(republican|gop|rep|red)\b/.test(combined) || /\br\b/.test(String(partyHint).toLowerCase()) ? "Republican"
        : /\b(independent|ind|other|purple)\b/.test(combined) || /\bi\b/.test(String(partyHint).toLowerCase()) ? "Independent"
          : "";
    return party ? `${strength} ${party}` : "";
  }

  function extractYapmsRatings(payload) {
    const aliases = raceAliasMap();
    const matches = new Map();
    const unmatched = new Set();
    let ignored = 0;

    function resolveRace(values) {
      for (const value of values) {
        const token = canonicalRaceToken(value);
        if (token && aliases.has(token)) return aliases.get(token);
      }
      return null;
    }

    function yapmsParty(candidate) {
      const name = String(candidate?.name || "").trim().toLowerCase();
      if (/^(democrat|democratic|dem|d)$/.test(name)) return "Democratic";
      if (/^(republican|gop|rep|r)$/.test(name)) return "Republican";
      if (/^(independent|ind|unaffiliated|i)$/.test(name)) return "Independent";

      for (const margin of candidate?.margins || []) {
        const rating = importedRating(margin?.color);
        const party = ratingParty(rating);
        if (party === "D") return "Democratic";
        if (party === "R") return "Republican";
        if (party === "I") return "Independent";
      }
      return "";
    }

    function extractOfficialYapmsSave(node) {
      if (!Array.isArray(node?.regions) || !Array.isArray(node?.candidates)) return false;
      const candidates = new Map(node.candidates.map((candidate) => [String(candidate?.id || ""), candidate]));
      const tossupId = String(node?.tossup?.id || "");

      for (const region of node.regions) {
        const race = resolveRace([
          region?.raceId, region?.id, region?.region, region?.shortName, region?.longName
        ]);
        const assignments = Array.isArray(region?.candidates) ? region.candidates : [];
        const assignment = [...assignments].sort((left, right) => Number(right?.count || 0) - Number(left?.count || 0))[0];
        const candidateId = String(assignment?.id ?? assignment?.candidate ?? "");
        if (!race) {
          unmatched.add(String(region?.id || region?.region || "unknown"));
          continue;
        }
        if (!assignment || candidateId === tossupId || !candidateId) {
          matches.set(race.raceId, "Tossup");
          continue;
        }

        const candidate = candidates.get(candidateId);
        const party = yapmsParty(candidate);
        if (!candidate || !party) {
          ignored += 1;
          continue;
        }

        const marginIndex = Math.max(0, Math.min(3, Number(assignment?.margin) || 0));
        const strength = ["Safe", "Likely", "Lean", "Tilt"][marginIndex];
        matches.set(race.raceId, `${strength} ${party}`);
      }
      return true;
    }

    const officialSave = extractOfficialYapmsSave(payload);

    function walk(node, path = [], inheritedRace = null) {
      if (node == null) return;
      if (typeof node !== "object") {
        const race = inheritedRace || resolveRace([...path].reverse());
        const rating = importedRating(node, path.join(" "));
        if (race && rating) matches.set(race.raceId, rating);
        return;
      }
      if (Array.isArray(node)) {
        node.forEach((item, index) => walk(item, [...path, index], inheritedRace));
        return;
      }

      const race = resolveRace([
        node.raceId, node.race, node.region, node.state, node.postal, node.abbr,
        node.districtId, node.district, node.name, ...[...path].reverse()
      ]) || inheritedRace;
      const partyHint = node.party ?? node.affiliation ?? node.side ?? node.winnerParty ?? "";
      const ratingValue = node.rating ?? node.classification ?? node.category ?? node.lean ?? node.result ?? node.fill ?? node.color;
      const rating = importedRating(ratingValue, partyHint);
      if (race && rating) matches.set(race.raceId, rating);
      else if (rating && !race) unmatched.add(String(node.raceId || node.region || node.state || node.name || path.at(-1) || "unknown"));
      else if ((node.candidate || node.candidateName || node.candidates) && !partyHint) ignored += 1;

      for (const [key, child] of Object.entries(node)) {
        if (/^candidates?$|candidateNames?|photos?|headshots?/i.test(key)) continue;
        const keyedRace = resolveRace([key]) || race;
        if (typeof child !== "object" && keyedRace) {
          const keyedRating = importedRating(child, key);
          if (keyedRating) {
            matches.set(keyedRace.raceId, keyedRating);
            continue;
          }
        }
        walk(child, [...path, key], keyedRace);
      }
    }

    if (!officialSave) walk(payload);
    return { matches, unmatched: [...unmatched], ignored };
  }

  function importYapmsPayload(payload) {
    const result = extractYapmsRatings(payload);
    if (!result.matches.size) {
      state.importReport = { applied: 0, unmatched: result.unmatched, ignored: result.ignored };
      render();
      setStatus("No recognizable YAPms ratings matched this office. Candidate-only and custom-color entries were ignored.", true);
      return;
    }
    pushUndo();
    let applied = 0;
    for (const [raceId, rating] of result.matches) {
      const race = (state.data?.races || []).find((entry) => entry.raceId === raceId);
      if (!race || normalizeRating(race?.prediction?.rating) === rating) continue;
      race.prediction = { ...(race.prediction || {}), rating, status: race.prediction?.status || "published" };
      applied += 1;
    }
    touchEditedData();
    rebuildSummary();
    state.importReport = { applied, unmatched: result.unmatched, ignored: result.ignored };
    render();
    setStatus(`Imported ${applied} FEA Rating${applied === 1 ? "" : "s"} from the YAPms data. Candidate data was not changed.`);
  }

  async function loadOffice(office = state.office, useDraft = false) {
    state.office = office;
    const record = fileRecord();
    if (!record) throw new Error(`No ratings file found for ${officeLabels[office]}.`);
    const payload = useDraft && record.draft ? record.draft : record.published;
    if (!payload) throw new Error(useDraft ? "No draft exists for this office." : "Published ratings file is missing.");
    state.data = clone(payload);
    state.selectedRaceId = "";
    state.undoStack = [];
    state.redoStack = [];
    state.dirty = false;
    rebuildSummary();
    render();
    setStatus(`${officeLabels[office]} ratings loaded${useDraft ? " from draft" : ""}.`);
  }

  async function saveRatings(mode = "publish") {
    if (!state.data) return;
    rebuildSummary();
    const result = await api("/api/admin/predictions/save", {
      method: "POST",
      body: JSON.stringify({
        file: officeFiles[state.office],
        mode,
        editedBy: "FEA admin",
        changeSummary: mode === "publish" ? "Update FEA Ratings" : "Save FEA Ratings draft",
        data: state.data
      })
    });
    const record = fileRecord();
    if (record) {
      if (mode === "publish") record.published = clone(result.data);
      else record.draft = clone(result.data);
    }
    state.data = clone(result.data);
    state.dirty = false;
    render();
    const persistence = result.persistence || {};
    const historyPersistence = result.historyPersistence || {};
    let message;
    let isError = false;
    if (persistence.committed) {
      message = mode === "publish"
        ? "Published to the live ratings file and committed to GitHub."
        : "Draft saved and committed to GitHub.";
      if (mode === "publish" && historyPersistence.committed === false && !historyPersistence.skipped) {
        message += " The live file is published, but its history copy could not be committed.";
      }
    } else if (persistence.skipped) {
      message = mode === "publish"
        ? "Published on this server. GitHub publishing is not configured, so the repository was not changed."
        : "Draft saved on this server. GitHub publishing is not configured.";
    } else if (persistence.committed === false) {
      message = `Saved on this server, but the GitHub update failed: ${persistence.reason || persistence.error || "unknown error"}`;
      isError = true;
    } else {
      message = mode === "publish" ? "Published ratings saved." : "Draft ratings saved.";
    }
    setStatus(message, isError);
  }

  function renderOfficeTabs() {
    return Object.entries(officeLabels).map(([key, label]) =>
      `<button type="button" class="admin-rating-tab ${state.office === key ? "active" : ""}" data-office="${key}">${escapeHtml(label)}</button>`
    ).join("");
  }

  function renderModeButtons() {
    return [
      ["D", "Democratic"],
      ["Tossup", "Tossup"],
      ["I", "Independent"],
      ["R", "Republican"]
    ].map(([key, label]) =>
      `<button type="button" class="admin-rating-mode ${state.editMode === key ? "active" : ""} mode-${key.toLowerCase()}" data-mode="${key}" aria-pressed="${state.editMode === key ? "true" : "false"}"><span>${escapeHtml(label)}</span><small>${state.editMode === key ? escapeHtml(state.selectedRating) : "Choose party"}</small></button>`
    ).join("");
  }

  function renderRatingPalette() {
    return `
      <div class="admin-rating-palette" aria-label="Exact FEA Rating">
        ${allowedRatings.map((rating) => `
          <button
            type="button"
            class="admin-rating-choice ${state.selectedRating === rating ? "is-selected" : ""}"
            data-rating-choice="${escapeHtml(rating)}"
            aria-pressed="${state.selectedRating === rating ? "true" : "false"}"
            style="--rating-color:${escapeHtml(mapUtils.colors?.[rating] || "#cbcacd")}"
          >
            <i></i><span>${escapeHtml(rating.replace(" Democratic", " D").replace(" Republican", " R").replace(" Independent", " I"))}</span>
          </button>
        `).join("")}
      </div>
    `;
  }

  function renderSummary() {
    const summary = summarize();
    return `
      <div class="admin-rating-summary">
        <span><b>${summary.counts.D}</b> Democratic</span>
        <span><b>${summary.counts.Tossup}</b> Tossup</span>
        <span><b>${summary.counts.I}</b> Independent</span>
        <span><b>${summary.counts.R}</b> Republican</span>
        <span><b>${summary.raceCount}</b> races</span>
        <span>Updated <b>${escapeHtml(displayDate(state.data?.lastPublishedAt || state.data?.generatedAt))}</b></span>
      </div>
    `;
  }

  function renderSelectedPanel() {
    const race = selectedRace();
    if (!race) {
      return `
        <aside class="admin-rating-side">
          <span class="prediction-kicker">Selected race</span>
          <h2>No race selected</h2>
          <p class="prediction-note">Choose an exact FEA Rating, then click a state or district. Hold <kbd>F</kbd> and drag to paint several races without zooming the map.</p>
        </aside>
      `;
    }
    const rating = normalizeRating(race?.prediction?.rating);
    const candidates = candidateEntries(race);
    return `
      <aside class="admin-rating-side">
        <span class="prediction-kicker">Selected race</span>
        <h2>${escapeHtml(raceTitle(race))}</h2>
        <span class="rating-pill ${ratingClass(rating)}">${escapeHtml(rating)}</span>
        <p class="prediction-note">Map brush: <b>${escapeHtml(state.selectedRating)}</b>. Click another rating above to change it, or hold <kbd>F</kbd> and drag across the map.</p>
        <div class="admin-selected-meta">
          <span>${escapeHtml(race.raceId)}</span>
          <span>${escapeHtml(race.office || officeLabels[state.office])}</span>
        </div>
        <div class="admin-candidate-editor">
          <div class="admin-candidate-editor-head">
            <strong>Candidates</strong>
            <span>These names appear in the public map hover card. Publish to update the live ratings pages.</span>
          </div>
          <div class="admin-candidate-list">
            ${candidates.map(([key, candidate], index) => `
              <div class="admin-candidate-row" data-candidate-key="${escapeHtml(key)}">
                <label class="admin-candidate-key">Key
                  <input value="${escapeHtml(key)}" data-candidate-key-input aria-label="Candidate key">
                </label>
                <label class="admin-candidate-name">Name
                  <input value="${escapeHtml(candidate.name || "")}" data-candidate-field="name" aria-label="Candidate name">
                </label>
                <label class="admin-candidate-party">Party
                  <select data-candidate-field="party" aria-label="Candidate party">
                    ${["D", "R", "I", "L", "G", "NP"].map((party) => `<option value="${party}" ${String(candidate.party || "I").toUpperCase() === party ? "selected" : ""}>${party}</option>`).join("")}
                  </select>
                </label>
                <label class="admin-candidate-status">Status
                  <input value="${escapeHtml(candidate.status || "")}" data-candidate-field="status" placeholder="Optional" aria-label="Candidate status">
                </label>
                <label class="admin-candidate-order">Order
                  <input type="number" min="1" step="1" value="${Number.isFinite(Number(candidate.order)) ? escapeHtml(candidate.order) : ""}" data-candidate-field="order" placeholder="Auto" aria-label="Candidate custom order">
                </label>
                <div class="admin-candidate-flags">
                  <label class="admin-candidate-check">
                    <input type="checkbox" data-candidate-field="incumbent" ${candidate.incumbent ? "checked" : ""}>
                    Incumbent
                  </label>
                  <label class="admin-candidate-check">
                    <input type="checkbox" data-candidate-field="presumptiveNominee" ${candidate.presumptiveNominee ? "checked" : ""}>
                    Presumptive nominee (P)
                  </label>
                </div>
                <div class="admin-candidate-order-actions" aria-label="Candidate ordering">
                  <button type="button" data-move-candidate="${escapeHtml(key)}" data-direction="-1" ${index === 0 ? "disabled" : ""} aria-label="Move ${escapeHtml(candidate.name || "candidate")} up">Up</button>
                  <button type="button" data-move-candidate="${escapeHtml(key)}" data-direction="1" ${index === candidates.length - 1 ? "disabled" : ""} aria-label="Move ${escapeHtml(candidate.name || "candidate")} down">Down</button>
                </div>
                <button type="button" data-remove-candidate="${escapeHtml(key)}" aria-label="Remove ${escapeHtml(candidate.name || "candidate")}">Remove</button>
              </div>
            `).join("") || `<p class="prediction-note">No candidates are configured for this race.</p>`}
          </div>
          <button type="button" id="admin-add-candidate">Add candidate</button>
        </div>
        <a class="prediction-button is-small" href="/predictions/2026/${state.office}" target="_blank" rel="noopener">Open public map</a>
      </aside>
    `;
  }

  function renderImportPanel() {
    const report = state.importReport;
    return `
      <section class="admin-yapms-import">
        <div>
          <span class="prediction-kicker">YAPms ratings import</span>
          <h2>Bring in ratings, not candidates.</h2>
          <p>Upload or paste a YAPms JSON export. Standard Democratic, Republican, Independent, and tossup ratings are translated to FEA categories and colors. Custom candidates and unrecognized colors are ignored.</p>
        </div>
        <label class="admin-yapms-file">
          YAPms JSON file
          <input id="admin-yapms-file" type="file" accept=".json,.txt,application/json,text/plain">
        </label>
        <label class="admin-yapms-paste">
          Or paste JSON
          <textarea id="admin-yapms-json" rows="5" spellcheck="false" placeholder='Paste the YAPms JSON export here'></textarea>
        </label>
        <button id="admin-yapms-import" type="button">Import FEA Ratings</button>
        ${report ? `
          <div class="admin-import-report" role="status">
            <strong>${report.applied} changed</strong>
            <span>${report.unmatched.length} unmatched</span>
            <span>${report.ignored} custom candidate entr${report.ignored === 1 ? "y" : "ies"} ignored</span>
            ${report.unmatched.length ? `<small>Unmatched: ${escapeHtml(report.unmatched.slice(0, 8).join(", "))}${report.unmatched.length > 8 ? "..." : ""}</small>` : ""}
          </div>
        ` : ""}
      </section>
    `;
  }

  function attachHandlers() {
    document.querySelectorAll("[data-office]").forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          if (state.dirty && !confirm("You have unsaved rating changes. Switch offices anyway?")) return;
          await loadOffice(button.dataset.office);
        } catch (error) {
          setStatus(error.message, true);
        }
      });
    });
    document.querySelectorAll("[data-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        selectRatingMode(button.dataset.mode);
        render();
        setStatus(`${state.selectedRating} selected. Click a race, or hold F and drag across the map.`);
      });
    });
    document.querySelectorAll("[data-rating-choice]").forEach((button) => {
      button.addEventListener("click", () => {
        state.selectedRating = normalizeRating(button.dataset.ratingChoice);
        state.editMode = ratingParty(state.selectedRating);
        render();
        setStatus(`${state.selectedRating} selected. Click a race, or hold F and drag across the map.`);
      });
    });
    $("admin-load-published")?.addEventListener("click", () => loadOffice(state.office, false).catch((error) => setStatus(error.message, true)));
    $("admin-load-draft")?.addEventListener("click", () => loadOffice(state.office, true).catch((error) => setStatus(error.message, true)));
    $("admin-undo")?.addEventListener("click", () => {
      const previous = state.undoStack.pop();
      if (!previous) return;
      state.redoStack.push(JSON.stringify(state.data));
      state.dirty = true;
      restoreFromStack(previous);
    });
    $("admin-redo")?.addEventListener("click", () => {
      const next = state.redoStack.pop();
      if (!next) return;
      state.undoStack.push(JSON.stringify(state.data));
      state.dirty = true;
      restoreFromStack(next);
    });
    $("admin-save-draft")?.addEventListener("click", () => saveRatings("draft").catch((error) => setStatus(error.message, true)));
    $("admin-publish")?.addEventListener("click", () => saveRatings("publish").catch((error) => setStatus(error.message, true)));
    $("admin-clear-rating")?.addEventListener("click", () => {
      const race = selectedRace();
      if (!race) return;
      applyRaceRating(race, "Tossup");
    });
    $("admin-yapms-import")?.addEventListener("click", async () => {
      try {
        const file = $("admin-yapms-file")?.files?.[0];
        const text = file ? await file.text() : $("admin-yapms-json")?.value;
        if (!String(text || "").trim()) throw new Error("Choose a YAPms JSON file or paste its JSON first.");
        importYapmsPayload(JSON.parse(text));
      } catch (error) {
        setStatus(`YAPms import failed: ${error.message}`, true);
      }
    });
    const activeRace = selectedRace();
    if (activeRace) {
      document.querySelectorAll("[data-candidate-key-input]").forEach((input) => {
        input.addEventListener("change", () => {
          const row = input.closest("[data-candidate-key]");
          const oldKey = row?.dataset.candidateKey;
          try {
            const nextKey = renameCandidateKey(activeRace.raceId, oldKey, input.value);
            render();
            setStatus(`${raceTitle(activeRace)} candidate key changed to ${nextKey}. Save draft or publish when ready.`);
          } catch (error) {
            input.value = oldKey;
            setStatus(error.message, true);
          }
        });
      });
      document.querySelectorAll("[data-candidate-field]").forEach((input) => {
        const row = input.closest("[data-candidate-key]");
        const key = row?.dataset.candidateKey;
        const field = input.dataset.candidateField;
        const eventName = input.type === "checkbox" || input.tagName === "SELECT" ? "change" : "input";
        input.addEventListener(eventName, () => {
          updateCandidate(activeRace.raceId, key, field, input.type === "checkbox" ? input.checked : input.value);
          setStatus(`${raceTitle(activeRace)} candidate details updated. Save draft or publish when ready.`);
        });
      });
      document.querySelectorAll("[data-remove-candidate]").forEach((button) => {
        button.addEventListener("click", () => removeCandidate(activeRace.raceId, button.dataset.removeCandidate));
      });
      document.querySelectorAll("[data-move-candidate]").forEach((button) => {
        button.addEventListener("click", () => {
          moveCandidate(activeRace.raceId, button.dataset.moveCandidate, Number(button.dataset.direction));
        });
      });
      $("admin-add-candidate")?.addEventListener("click", () => addCandidate(activeRace.raceId));
    }
  }

  async function renderMap() {
    const container = $("admin-rating-map");
    if (!container || !state.data || !mapUtils.renderRaceShapeMap) return;
    const renderId = ++state.mapRenderId;
    state.mapController?.destroy?.();
    const controller = await mapUtils.renderRaceShapeMap({
      container,
      data: state.data,
      office: state.office,
      selectedRaceId: "",
      onSelect(race) {
        applyRaceRating(race);
      },
      isPaintEnabled() {
        return state.paintKeyDown;
      },
      onPaintStart() {
        if (state.paintSession) return;
        pushUndo();
        state.paintSession = { touched: new Set(), lastRaceId: "" };
        document.body.classList.add("is-rating-painting");
      },
      onPaintRace(race) {
        if (!state.paintSession || state.paintSession.touched.has(race.raceId)) return;
        state.paintSession.touched.add(race.raceId);
        state.paintSession.lastRaceId = race.raceId;
        applyRaceRating(race, state.selectedRating, {
          pushUndo: false,
          render: false,
          select: false,
          status: false
        });
      },
      onPaintEnd() {
        const painted = state.paintSession;
        if (!painted) return;
        state.paintSession = null;
        document.body.classList.remove("is-rating-painting");
        if (painted.lastRaceId) state.selectedRaceId = painted.lastRaceId;
        render();
        setStatus(`Painted ${painted.touched.size} race${painted.touched.size === 1 ? "" : "s"} ${state.selectedRating}.`);
      }
    });
    if (renderId !== state.mapRenderId) {
      controller?.destroy?.();
      return;
    }
    state.mapController = controller;
  }

  function render() {
    const root = $("admin-editor");
    if (!root || !state.data) return;
    root.hidden = false;
    root.innerHTML = `
      <section class="admin-ratings-toolbar">
        <div class="admin-rating-tabs">${renderOfficeTabs()}</div>
        <div class="admin-rating-modes" aria-label="Rating mode">${renderModeButtons()}</div>
        ${renderRatingPalette()}
        <div class="admin-rating-actions">
          <button id="admin-load-published" type="button">Load published</button>
          <button id="admin-load-draft" type="button">Load draft</button>
          <button id="admin-undo" type="button" ${state.undoStack.length ? "" : "disabled"}>Undo</button>
          <button id="admin-redo" type="button" ${state.redoStack.length ? "" : "disabled"}>Redo</button>
          <button id="admin-save-draft" type="button">Save draft</button>
          <button id="admin-publish" type="button">Publish</button>
        </div>
      </section>
      <div id="admin-status" class="prediction-note admin-save-status" role="status"></div>
      ${renderSummary()}
      <section class="admin-rating-workspace">
        <div id="admin-rating-map" class="prediction-map admin-rating-map"></div>
        ${renderSelectedPanel()}
      </section>
      <section class="admin-rating-legend-panel">
        <span class="prediction-kicker">Map brush</span>
        <p>Choose an exact rating above. Click one race to apply it, or hold <kbd>F</kbd> while dragging across the map to paint multiple races. A full drag stroke is one undo step.</p>
        <button id="admin-clear-rating" type="button">Set selected race to Tossup</button>
      </section>
      ${renderImportPanel()}
    `;
    attachHandlers();
    renderMap();
  }

  async function init() {
    const login = $("admin-login-form");
    if ($("admin-secret")) $("admin-secret").value = state.secret;
    login?.addEventListener("submit", async (event) => {
      event.preventDefault();
      state.secret = $("admin-secret")?.value || "";
      localStorage.setItem("feaAdminSecret", state.secret);
      try {
        state.bootstrap = await api("/api/admin/predictions/bootstrap");
        await loadOffice("senate");
        $("admin-login")?.setAttribute("hidden", "");
      } catch (error) {
        setStatus(error.message, true);
      }
    });
    window.addEventListener("beforeunload", (event) => {
      if (!state.dirty) return;
      event.preventDefault();
      event.returnValue = "";
    });
    window.addEventListener("keydown", (event) => {
      const target = event.target;
      if (event.key.toLowerCase() !== "f" || event.repeat || target?.matches?.("input, textarea, select, [contenteditable='true']")) return;
      state.paintKeyDown = true;
      document.body.classList.add("is-rating-brush-ready");
      setStatus(`Paint brush ready: ${state.selectedRating}. Drag across the map while holding F.`);
    });
    window.addEventListener("keyup", (event) => {
      if (event.key.toLowerCase() !== "f") return;
      state.paintKeyDown = false;
      document.body.classList.remove("is-rating-brush-ready");
    });
    window.addEventListener("blur", () => {
      state.paintKeyDown = false;
      document.body.classList.remove("is-rating-brush-ready");
    });
  }

  init();
})();
