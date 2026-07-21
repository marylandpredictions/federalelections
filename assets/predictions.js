(function () {
  const configs = {
    senate: {
      label: "Senate",
      title: "2026 Senate FEA Ratings",
      file: "/data/predictions/2026-senate-predictions.json",
      majority: 50,
      totalSeats: 100,
      notUpSeats: { D: 33, R: 32, I: 0 }
    },
    house: {
      label: "House",
      title: "2026 House FEA Ratings",
      file: "/data/predictions/2026-house-predictions.json",
      majority: 218,
      totalSeats: 435,
      notUpSeats: { D: 0, R: 0, I: 0 }
    },
    governor: {
      label: "Governors",
      title: "2026 Governor FEA Ratings",
      file: "/data/predictions/2026-governor-predictions.json",
      majority: null,
      totalSeats: null,
      notUpSeats: { D: 0, R: 0, I: 0 }
    }
  };

  const state = {
    key: document.body.dataset.predictionKey || "senate",
    activeData: null,
    viewData: null,
    snapshots: [],
    selectedRaceId: "",
    mapController: null
  };

  const mapUtils = window.FeaPredictionMaps || {};
  const allowedRatings = mapUtils.allowedRatings || [];

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
    })[char]);
  }

  async function fetchJson(url, fallback = null) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.json();
    } catch (error) {
      console.warn(`Could not load ${url}`, error);
      return fallback;
    }
  }

  function normalizeRating(value) {
    return mapUtils.normalizeRating ? mapUtils.normalizeRating(value) : String(value || "Tossup");
  }

  function ratingParty(rating) {
    return mapUtils.ratingParty ? mapUtils.ratingParty(rating) : "Tossup";
  }

  function displayDate(value) {
    return mapUtils.displayDate ? mapUtils.displayDate(value) : String(value || "No date");
  }

  function ratingClass(rating) {
    return `rating-${normalizeRating(rating).toLowerCase().replace(/\s+/g, "-")}`;
  }

  function titleForRace(race) {
    if (!race) return "";
    if (race.displayName) return race.displayName;
    if (state.key === "house") return `${race.state}-${String(race.district || "").padStart(2, "0")} House`;
    return `${race.state} ${configs[state.key].label}`;
  }

  function candidatesForRace(race) {
    return Object.values(race?.candidates || {}).filter((candidate) => candidate && candidate.name);
  }

  function summarize(data) {
    const counts = { D: 0, R: 0, Tossup: 0, Uncalled: 0 };
    const ratings = Object.fromEntries(allowedRatings.map((rating) => [rating, 0]));
    for (const race of data?.races || []) {
      const rating = normalizeRating(race?.prediction?.rating);
      ratings[rating] = (ratings[rating] || 0) + 1;
      const party = ratingParty(rating);
      if (party === "D") counts.D += 1;
      else if (party === "R") counts.R += 1;
      else counts.Tossup += 1;
    }
    return { counts, ratings, raceCount: (data?.races || []).length };
  }

  function mergeSnapshot(active, snapshot) {
    if (!snapshot) return active;
    const ratingByRace = new Map((snapshot.races || []).map((race) => [race.raceId, normalizeRating(race?.prediction?.rating)]));
    const races = (active.races || []).map((race) => ({
      ...race,
      prediction: {
        ...(race.prediction || {}),
        rating: ratingByRace.get(race.raceId) || normalizeRating(race?.prediction?.rating)
      }
    }));
    const merged = {
      ...active,
      title: active.title,
      selectedSnapshotDate: snapshot.snapshotDate,
      generatedAt: snapshot.generatedAt || active.generatedAt,
      races
    };
    merged.summary = summarize(merged);
    if (active.summary?.notUpSeats) merged.summary.notUpSeats = active.summary.notUpSeats;
    if (active.summary?.incumbentsNotUp) merged.summary.incumbentsNotUp = active.summary.incumbentsNotUp;
    return merged;
  }

  function getNotUpSeats(data) {
    const config = configs[state.key];
    const fromData = data?.summary?.notUpSeats || data?.summary?.incumbentsNotUp || config.notUpSeats || {};
    return {
      D: Number(fromData.D || fromData.democratic || 0),
      R: Number(fromData.R || fromData.republican || 0),
      I: Number(fromData.I || fromData.independent || 0)
    };
  }

  function renderHeader() {
    const config = configs[state.key];
    const data = state.viewData;
    if ($("prediction-title")) $("prediction-title").textContent = config.title;
    if ($("prediction-subtitle")) {
      $("prediction-subtitle").textContent = "Categorical FEA Ratings for the current 2026 map. Use the timeline to view earlier weekly snapshots.";
    }
    if ($("prediction-updated")) {
      const date = data?.selectedSnapshotDate || data?.lastPublishedAt || data?.generatedAt;
      $("prediction-updated").textContent = date ? displayDate(date) : "--";
    }
  }

  function renderTopline() {
    const target = $("prediction-topline");
    if (!target) return;
    const summary = summarize(state.viewData);
    const updated = state.viewData?.selectedSnapshotDate || state.viewData?.lastPublishedAt || state.viewData?.generatedAt;
    target.innerHTML = `
      <article class="prediction-card is-compact">
        <span>Snapshot</span>
        <strong>${escapeHtml(displayDate(updated))}</strong>
        <small>Newest snapshot loads by default.</small>
      </article>
      <article class="prediction-card is-compact">
        <span>Democratic ratings</span>
        <strong class="prediction-party-d">${summary.counts.D}</strong>
        <small>Safe, Likely, Lean, and Tilt Democratic.</small>
      </article>
      <article class="prediction-card is-compact">
        <span>Tossups</span>
        <strong>${summary.counts.Tossup}</strong>
        <small>Neutral FEA rating.</small>
      </article>
      <article class="prediction-card is-compact">
        <span>Republican ratings</span>
        <strong class="prediction-party-r">${summary.counts.R}</strong>
        <small>Safe, Likely, Lean, and Tilt Republican.</small>
      </article>
    `;
  }

  function renderBoard() {
    const config = configs[state.key];
    const summary = summarize(state.viewData);
    const notUp = getNotUpSeats(state.viewData);
    const dTotal = summary.counts.D + notUp.D + notUp.I;
    const rTotal = summary.counts.R + notUp.R;
    const tossTotal = summary.counts.Tossup;
    const total = Math.max(1, config.totalSeats || summary.raceCount || 1);

    const demCount = $("prediction-dem-count");
    const repCount = $("prediction-rep-count");
    const majority = $("prediction-majority-label");
    if (demCount) demCount.textContent = `${dTotal} D`;
    if (repCount) repCount.textContent = `${rTotal} R`;
    if (majority) {
      if (state.key === "governor") {
        majority.textContent = `${summary.raceCount} races rated`;
      } else {
        majority.textContent = `${config.majority} for majority${state.key === "senate" ? " - D need 51 if GOP controls VP" : ""}`;
      }
    }

    const demBar = $("prediction-bar-dem");
    const tossBar = $("prediction-bar-toss");
    const repBar = $("prediction-bar-rep");
    const majorityLine = $("prediction-majority-line");
    if (demBar) demBar.style.width = `${Math.max(0, Math.min(100, (dTotal / total) * 100))}%`;
    if (tossBar) tossBar.style.width = `${Math.max(0, Math.min(100, (tossTotal / total) * 100))}%`;
    if (repBar) repBar.style.width = `${Math.max(0, Math.min(100, (rTotal / total) * 100))}%`;
    if (majorityLine && config.majority) majorityLine.style.left = `${Math.max(0, Math.min(100, (config.majority / total) * 100))}%`;
  }

  function renderDetail(race) {
    const panel = $("prediction-detail");
    if (!panel) return;
    if (!race) {
      panel.hidden = true;
      panel.innerHTML = "";
      return;
    }
    const rating = normalizeRating(race?.prediction?.rating);
    const candidates = candidatesForRace(race);
    const rows = candidates.length
      ? candidates.map((candidate) => `
          <div class="prediction-detail-row">
            <span class="candidate-party-dot">${escapeHtml((candidate.party || "?").slice(0, 1).toUpperCase())}</span>
            <span><b>${escapeHtml(candidate.name)}${candidate.incumbent ? "*" : ""}</b><small>${escapeHtml(candidate.party || "")}${candidate.status ? ` - ${escapeHtml(candidate.status)}` : ""}</small></span>
          </div>
        `).join("")
      : `<p class="prediction-note">Candidate details have not been added yet.</p>`;
    const note = race?.notes?.whyWeRateItThisWay || race?.notes?.short || race?.notes?.publicNote || "";
    panel.hidden = false;
    panel.innerHTML = `
      <button class="prediction-detail-close" type="button" aria-label="Close selected race">x</button>
      <div class="prediction-detail-head">
        <span class="rating-pill ${ratingClass(rating)}">${escapeHtml(rating)}</span>
        <h2>${escapeHtml(titleForRace(race))}</h2>
        <p>${escapeHtml(race.office || configs[state.key].label)}${race.state ? ` - ${escapeHtml(race.state)}` : ""}</p>
      </div>
      <div class="prediction-detail-candidates">${rows}</div>
      ${note ? `<div class="prediction-detail-note"><span>Team note</span><p>${escapeHtml(note)}</p></div>` : ""}
      <a class="prediction-button is-small" href="#${encodeURIComponent(race.raceId)}">Full race page</a>
    `;
    panel.querySelector(".prediction-detail-close")?.addEventListener("click", () => {
      state.selectedRaceId = "";
      panel.hidden = true;
      state.mapController?.setSelected?.("");
      history.replaceState(null, "", window.location.pathname);
    });
  }

  async function renderMap() {
    const target = $("prediction-map");
    if (!target || !mapUtils.renderRaceShapeMap) return;
    state.mapController?.destroy?.();
    state.mapController = await mapUtils.renderRaceShapeMap({
      container: target,
      data: state.viewData,
      office: state.key,
      selectedRaceId: state.selectedRaceId,
      onSelect(race) {
        state.selectedRaceId = race.raceId;
        renderDetail(race);
        state.mapController?.focusRace?.(race.raceId);
        history.replaceState(null, "", `#${encodeURIComponent(race.raceId)}`);
      }
    });
    if (state.selectedRaceId) {
      const race = (state.viewData.races || []).find((item) => item.raceId === state.selectedRaceId);
      renderDetail(race);
      setTimeout(() => state.mapController?.focusRace?.(state.selectedRaceId), 30);
    }
  }

  function renderTimeline() {
    const mapPanel = document.querySelector(".prediction-map-panel");
    if (!mapPanel || document.getElementById("prediction-rating-timeline")) return;
    const timeline = document.createElement("section");
    timeline.id = "prediction-rating-timeline";
    timeline.className = "prediction-rating-timeline";
    mapPanel.insertAdjacentElement("afterend", timeline);
  }

  function updateTimeline() {
    renderTimeline();
    const timeline = $("prediction-rating-timeline");
    if (!timeline) return;
    if (!state.snapshots.length) {
      timeline.innerHTML = `<span class="prediction-kicker">Ratings History</span><p class="prediction-note">Weekly snapshots will appear here after the first ratings archive is saved.</p>`;
      return;
    }
    const selected = state.viewData?.selectedSnapshotDate || state.snapshots.at(-1)?.snapshotDate;
    const selectedIndex = Math.max(0, state.snapshots.findIndex((item) => item.snapshotDate === selected));
    timeline.innerHTML = `
      <div class="prediction-timeline-head">
        <span class="prediction-kicker">Ratings History</span>
        <strong id="prediction-snapshot-date">${escapeHtml(displayDate(selected))}</strong>
      </div>
      <input id="prediction-snapshot-slider" type="range" min="0" max="${state.snapshots.length - 1}" value="${selectedIndex}" step="1" aria-label="Ratings snapshot week">
      <div class="prediction-snapshot-points">
        ${state.snapshots.map((item, index) => `<button type="button" data-snapshot-index="${index}" class="${index === selectedIndex ? "active" : ""}" title="${escapeHtml(displayDate(item.snapshotDate))}"></button>`).join("")}
      </div>
    `;
    timeline.querySelector("#prediction-snapshot-slider")?.addEventListener("input", async (event) => {
      await loadSnapshotAt(Number(event.target.value));
    });
    timeline.querySelectorAll("[data-snapshot-index]").forEach((button) => {
      button.addEventListener("click", async () => {
        await loadSnapshotAt(Number(button.dataset.snapshotIndex));
      });
    });
  }

  async function loadSnapshotAt(index) {
    const item = state.snapshots[index];
    if (!item) return;
    const snapshot = await fetchJson(`/${item.file.replace(/^\/+/, "")}`, null);
    state.viewData = mergeSnapshot(state.activeData, snapshot);
    state.selectedRaceId = "";
    renderAll(false);
  }

  async function loadSnapshots() {
    const index = await fetchJson("/data/predictions/rating-snapshots/index.json", { snapshots: {} });
    const list = (index?.snapshots?.[state.key] || []).slice().sort((a, b) => String(a.snapshotDate).localeCompare(String(b.snapshotDate)));
    state.snapshots = list;
    if (list.length) {
      const newest = list.at(-1);
      const snapshot = await fetchJson(`/${newest.file.replace(/^\/+/, "")}`, null);
      state.viewData = mergeSnapshot(state.activeData, snapshot);
    } else {
      state.viewData = state.activeData;
    }
  }

  function renderAll(rebuildMap = true) {
    renderHeader();
    renderTopline();
    renderBoard();
    updateTimeline();
    if (rebuildMap) renderMap();
    else renderMap();
  }

  async function init() {
    const config = configs[state.key] || configs.senate;
    state.activeData = await fetchJson(config.file, null);
    if (!state.activeData) {
      const root = $("prediction-root");
      if (root) root.innerHTML = `<section class="prediction-error"><h1>FEA Ratings could not load.</h1><p>Saved ratings data is unavailable.</p></section>`;
      return;
    }
    state.selectedRaceId = decodeURIComponent(window.location.hash.replace(/^#/, ""));
    await loadSnapshots();
    renderAll();
  }

  init();
})();
