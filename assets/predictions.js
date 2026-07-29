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
    mapController: null,
    timelineTimer: null,
    timelineRequestId: 0
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

  function candidateOrder(candidate) {
    const value = Number(candidate?.order);
    return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
  }

  function candidatesForRace(race) {
    return Object.values(race?.candidates || {})
      .filter((candidate) => candidate && candidate.name)
      .sort((a, b) =>
        candidateOrder(a) - candidateOrder(b)
        || Number(Boolean(b.incumbent)) - Number(Boolean(a.incumbent))
        || String(a.name || "").localeCompare(String(b.name || ""))
      );
  }

  function summarize(data) {
    const counts = { D: 0, R: 0, I: 0, Tossup: 0, Uncalled: 0 };
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
    target.innerHTML = "";
    target.hidden = true;
  }

  function renderBoard() {
    const config = configs[state.key];
    const summary = summarize(state.viewData);
    const notUp = getNotUpSeats(state.viewData);
    const dTotal = summary.counts.D + notUp.D + notUp.I;
    const rTotal = summary.counts.R + notUp.R;
    const tossTotal = summary.counts.Tossup + summary.counts.I;
    const total = Math.max(1, config.totalSeats || summary.raceCount || 1);

    const demCount = $("prediction-dem-count");
    const repCount = $("prediction-rep-count");
    const majority = $("prediction-majority-label");
    if (demCount) demCount.textContent = `${dTotal} D`;
    if (repCount) repCount.textContent = `${rTotal} R`;
    if (majority) {
      const snapshotLabel = snapshotBoardLabel();
      if (state.key === "governor") {
        majority.innerHTML = `<span>${summary.raceCount} races rated</span><small class="prediction-board-snapshot">${escapeHtml(snapshotLabel)}</small>`;
      } else {
        majority.innerHTML = `<span>${config.majority} for majority${state.key === "senate" ? " - D need 51 if GOP controls VP" : ""}</span><small class="prediction-board-snapshot">${escapeHtml(snapshotLabel)}</small>`;
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
            <span><b>${escapeHtml(candidate.name)}${candidate.incumbent ? "*" : ""}${candidate.presumptiveNominee ? ' <i class="candidate-presumptive">P</i>' : ""}</b><small>${escapeHtml(candidate.party || "")}${candidate.status ? ` - ${escapeHtml(candidate.status)}` : ""}</small></span>
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
      selectedRaceId: "",
      interactive: false
    });
    renderDetail(null);
  }

  function buildTimelineItems() {
    return [
      ...state.snapshots,
      {
        isCurrent: true,
        snapshotDate: state.activeData?.lastPublishedAt || state.activeData?.generatedAt || new Date().toISOString(),
        file: null
      }
    ];
  }

  function timelineWeekLabel(index, total, item) {
    if (item?.isCurrent) return "Latest";
    if (total <= 2) return "Earlier";
    return `Week ${index + 1}`;
  }

  function timelineStatusLabel(item) {
    return item?.isCurrent ? "Current ratings" : "Archived week";
  }

  function snapshotBoardLabel() {
    if (!state.viewData?.selectedSnapshotDate) return "Current release";
    const items = buildTimelineItems();
    const index = items.findIndex((item) => item.snapshotDate === state.viewData.selectedSnapshotDate);
    if (index >= 0) return timelineWeekLabel(index, items.length, items[index]);
    return "Archived week";
  }

  function getTimelineSelection() {
    const timelineItems = buildTimelineItems();
    const isCurrent = !state.viewData?.selectedSnapshotDate;
    const selectedIndex = isCurrent
      ? timelineItems.length - 1
      : Math.max(0, timelineItems.findIndex((item) => item.snapshotDate === state.viewData.selectedSnapshotDate));
    return {
      timelineItems,
      selectedIndex,
      selectedItem: timelineItems[selectedIndex] || timelineItems.at(-1)
    };
  }

  function renderTimelineCurrentPanel(selectedItem, selectedIndex, timelineItems) {
    const panel = $("prediction-snapshot-date");
    if (!panel || !selectedItem) return;
    panel.innerHTML = `
      <span>Viewing</span>
      <strong>${escapeHtml(timelineWeekLabel(selectedIndex, timelineItems.length, selectedItem))}</strong>
      <small>${escapeHtml(timelineStatusLabel(selectedItem))}</small>
    `;
  }

  function renderTimelineTicks(timeline, timelineItems, selectedIndex) {
    const ticks = timeline.querySelector(".prediction-rating-ticks");
    if (!ticks) return;
    ticks.innerHTML = timelineItems.map((item, index) => `
      <i class="${index === selectedIndex ? "is-active" : ""}" style="left:${timelineItems.length > 1 ? (index / (timelineItems.length - 1)) * 100 : 100}%"></i>
    `).join("");
  }

  function renderTimelineEndpoints(timeline, timelineItems) {
    const endpoints = timeline.querySelector(".prediction-rating-endpoints");
    if (!endpoints || !timelineItems.length) return;
    endpoints.innerHTML = `
      <span>${escapeHtml(timelineWeekLabel(0, timelineItems.length, timelineItems[0]))}</span>
      <span>${escapeHtml(timelineWeekLabel(timelineItems.length - 1, timelineItems.length, timelineItems.at(-1)))}</span>
    `;
  }

  function syncTimelineControls(timeline, timelineItems, selectedIndex, selectedItem) {
    const slider = timeline.querySelector("#prediction-snapshot-slider");
    if (slider) {
      slider.max = String(Math.max(0, timelineItems.length - 1));
      slider.value = String(selectedIndex);
      slider.disabled = timelineItems.length < 2;
    }
    renderTimelineTicks(timeline, timelineItems, selectedIndex);
    renderTimelineEndpoints(timeline, timelineItems);
    renderTimelineCurrentPanel(selectedItem, selectedIndex, timelineItems);
  }

  function renderTimeline() {
    const mapPanel = document.querySelector(".prediction-map-panel");
    if (!mapPanel) return;
    let timeline = $("prediction-rating-timeline");
    if (!timeline) {
      timeline = document.createElement("section");
      timeline.id = "prediction-rating-timeline";
      timeline.className = "prediction-rating-timeline";
      mapPanel.insertAdjacentElement("afterend", timeline);
      timeline.addEventListener("input", (event) => {
        if (event.target.id !== "prediction-snapshot-slider") return;
        const index = Number(event.target.value);
        const items = buildTimelineItems();
        const item = items[index];
        if (!item) return;
        syncTimelineControls(timeline, items, index, item);
        window.clearTimeout(state.timelineTimer);
        state.timelineTimer = window.setTimeout(() => loadSnapshotAt(index), 120);
      });
    }
  }

  function updateTimeline() {
    renderTimeline();
    const timeline = $("prediction-rating-timeline");
    if (!timeline) return;
    const { timelineItems, selectedIndex, selectedItem } = getTimelineSelection();
    const hasArchive = state.snapshots.length > 0;
    const existingSlider = timeline.querySelector("#prediction-snapshot-slider");
    const expectedMax = Math.max(0, timelineItems.length - 1);

    if (existingSlider && Number(existingSlider.max) === expectedMax) {
      syncTimelineControls(timeline, timelineItems, selectedIndex, selectedItem);
      const subtitle = timeline.querySelector(".prediction-rating-timeline-title span");
      if (subtitle) {
        subtitle.textContent = hasArchive ? "Scrub through each weekly FEA map" : "Weekly snapshots will build from this release";
      }
      return;
    }

    timeline.innerHTML = `
      <div class="prediction-rating-timeline-header">
        <div class="prediction-rating-timeline-title">
          <strong>Ratings history</strong>
          <span>${hasArchive ? "Scrub through each weekly FEA map" : "Weekly snapshots will build from this release"}</span>
        </div>
      </div>
      <div class="prediction-rating-slider-wrap">
        <div class="prediction-rating-track">
          <div class="prediction-rating-rail">
            <input id="prediction-snapshot-slider" type="range" min="0" max="${expectedMax}" value="${selectedIndex}" step="1" aria-label="Ratings snapshot week" ${timelineItems.length < 2 ? "disabled" : ""}>
            <div class="prediction-rating-ticks" aria-hidden="true">
              ${timelineItems.map((item, index) => `
                <i class="${index === selectedIndex ? "is-active" : ""}" style="left:${timelineItems.length > 1 ? (index / (timelineItems.length - 1)) * 100 : 100}%"></i>
              `).join("")}
            </div>
          </div>
          <div class="prediction-rating-endpoints">
            <span>${escapeHtml(timelineWeekLabel(0, timelineItems.length, timelineItems[0]))}</span>
            <span>${escapeHtml(timelineWeekLabel(timelineItems.length - 1, timelineItems.length, timelineItems.at(-1)))}</span>
          </div>
        </div>
        <div id="prediction-snapshot-date" class="prediction-rating-current"></div>
      </div>
    `;
    renderTimelineCurrentPanel(selectedItem, selectedIndex, timelineItems);
  }

  async function loadSnapshotAt(index) {
    const requestId = ++state.timelineRequestId;
    const item = index === state.snapshots.length
      ? { isCurrent: true }
      : state.snapshots[index];
    if (!item) return;
    if (item.isCurrent) {
      state.viewData = state.activeData;
      state.selectedRaceId = "";
      renderAll(false);
      return;
    }
    const snapshot = await fetchJson(`/${item.file.replace(/^\/+/, "")}`, null);
    if (requestId !== state.timelineRequestId || !snapshot) return;
    state.viewData = mergeSnapshot(state.activeData, {
      ...snapshot,
      snapshotDate: item.snapshotDate || snapshot.snapshotDate
    });
    state.selectedRaceId = "";
    renderAll(false);
  }

  async function loadSnapshots() {
    const index = await fetchJson("/data/predictions/rating-snapshots/index.json", { snapshots: {} });
    const list = (index?.snapshots?.[state.key] || []).slice().sort((a, b) => String(a.snapshotDate).localeCompare(String(b.snapshotDate)));
    state.snapshots = list;
    state.viewData = state.activeData;
  }

  function renderAll(rebuildMap = true) {
    renderHeader();
    renderTopline();
    renderBoard();
    updateTimeline();
    renderMap();
  }

  async function init() {
    const config = configs[state.key] || configs.senate;
    state.activeData = await fetchJson(config.file, null);
    if (!state.activeData) {
      const root = $("prediction-root");
      if (root) root.innerHTML = `<section class="prediction-error"><h1>FEA Ratings could not load.</h1><p>Saved ratings data is unavailable.</p></section>`;
      return;
    }
    state.selectedRaceId = "";
    if (window.location.hash) history.replaceState(null, "", window.location.pathname);
    await loadSnapshots();
    renderAll();
  }

  init();
})();
