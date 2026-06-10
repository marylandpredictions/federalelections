(function () {
  const root = document.getElementById("call-overlay");
  const params = new URLSearchParams(window.location.search);
  const raceFilter = params.get("race");
  const shownCalls = new Set();
  const queuedCalls = [];
  let isShowingCall = false;
  let tickerSignature = "";
  let callsDataCache = null;
  let resultsDataCache = null;
  let overlayConfigCache = null;

  const PHOTO_SETS = {
    "79778": {
      base: "assets/img/candidates/california-insurance-commissioner",
      photos: {
        "ben-allen": "ben-allen.webp",
        "steven-craig-bradford": "steven-craig-bradford.webp",
        "jane-kim": "jane-kim.webp",
        "stacy-a-korsgaden": "stacy-a-korsgaden.webp"
      },
      colors: {
        "ben-allen": "#17a7e8",
        "steven-craig-bradford": "#565cf4",
        "jane-kim": "#55ca2d",
        "stacy-a-korsgaden": "#e27415"
      }
    },
    "79893": {
      base: "assets/img/candidates/california-us-house-1",
      photos: {
        "audrey-denney": "audrey-denney.webp",
        "mike-mcguire": "mike-mcguire.webp",
        "james-gallagher": "james-gallagher.webp"
      },
      colors: {
        "audrey-denney": "#6c5cff",
        "mike-mcguire": "#23d5d8",
        "james-gallagher": "#c4162f"
      }
    },
    "79777": {
      base: "assets/img/candidates/california-governor",
      photos: {
        "antonio-villaraigosa": "villaraigosa.webp",
        "tony-k-thurmond": "thurmond.webp",
        "eric-swalwell": "swalwell.webp",
        "tom-steyer": "steyer.webp",
        "katie-porter": "porter.webp",
        "matt-mahan": "mahan.webp",
        "xavier-becerra": "becerra.webp",
        "steve-hilton": "hilton.webp",
        "chad-bianco": "bianco.webp"
      },
      colors: {
        "antonio-villaraigosa": "#24dcae",
        "tony-k-thurmond": "#1493f6",
        "eric-swalwell": "#99e600",
        "tom-steyer": "#4fc92a",
        "katie-porter": "#5765ff",
        "matt-mahan": "#2fdde0",
        "xavier-becerra": "#1493f6",
        "steve-hilton": "#bf0000",
        "chad-bianco": "#d97112"
      }
    },
    "79779": {
      base: "assets/img/candidates/california-lieutenant-governor",
      photos: {
        "josh-fryday": "josh-fryday.webp",
        "fiona-ma": "fiona-ma.webp",
        "michael-tubbs": "michael-tubbs.webp",
        "oliver-ma": "oliver-ma.webp",
        "david-fennell": "david-fennell.webp",
        "gloria-romero": "gloria-romero.webp"
      },
      colors: {
        "josh-fryday": "#0091ff",
        "fiona-ma": "#52ca2b",
        "michael-tubbs": "#6263f5",
        "oliver-ma": "#28d7db",
        "david-fennell": "#d97a18",
        "gloria-romero": "#e4d000"
      }
    },
    "79881": {
      base: "assets/img/candidates/california-superintendent",
      photos: {
        "richard-barrera": "richard-barrera.webp",
        "nichelle-m-henderson": "nichelle-henderson.webp",
        "al-muratsuchi": "al-muratsuchi.webp",
        "josh-newman": "josh-newman.webp",
        "anthony-rendon": "anthony-rendon.webp",
        "sonja-shaw": "sonja-shaw.webp"
      },
      colors: {
        "richard-barrera": "#0091ff",
        "nichelle-m-henderson": "#5560f6",
        "al-muratsuchi": "#25d6d6",
        "josh-newman": "#0091ff",
        "anthony-rendon": "#8dde18",
        "sonja-shaw": "#e6c900"
      }
    },
    "79884": {
      base: "assets/img/candidates/california-us-house-11",
      photos: {
        "saikat-chakrabarti": "saikat-chakrabarti.webp",
        "connie-chan": "connie-chan.webp",
        "scott-wiener": "scott-wiener.webp"
      },
      colors: {
        "saikat-chakrabarti": "#6b42d8",
        "connie-chan": "#0091ff",
        "scott-wiener": "#25d6d6"
      }
    },
    "79896": {
      base: "assets/img/candidates/california-us-house-22",
      photos: {
        "jasmeet-bains": "jasmeet-bains.webp",
        "randy-villegas": "randy-villegas.webp",
        "david-g-valadao": "david-g-valadao.webp"
      },
      colors: {
        "jasmeet-bains": "#4361ff",
        "randy-villegas": "#26d6d6",
        "david-g-valadao": "#d86f19"
      }
    },
    "79907": {
      base: "assets/img/candidates/california-us-house-32",
      photos: {
        "jake-levine": "jake-levine.webp",
        "marena-lin": "marena-lin.webp",
        "brad-sherman": "brad-sherman.webp",
        "larry-thompson": "larry-thompson.webp"
      },
      colors: {
        "jake-levine": "#0091ff",
        "marena-lin": "#25d6d6",
        "brad-sherman": "#5360f6",
        "larry-thompson": "#8dde18"
      }
    },
    "79916": {
      base: "assets/img/candidates/california-us-house-40",
      photos: {
        "joe-kerr": "joe-kerr.webp",
        "esther-kim-varet": "esther-kim-varet.webp",
        "ken-calvert": "ken-calvert.webp",
        "young-kim": "young-kim.webp"
      },
      colors: {
        "joe-kerr": "#0091ff",
        "esther-kim-varet": "#5560f6",
        "ken-calvert": "#c56517",
        "young-kim": "#dec30f"
      }
    },
    "79932": {
      base: "assets/img/candidates/california-us-house-7",
      photos: {
        "doris-matsui": "doris-matsui.webp",
        "mai-vang": "mai-vang.webp"
      },
      colors: {
        "doris-matsui": "#0091ff",
        "mai-vang": "#25d6d6"
      }
    }
  };

  const POLL_CLOSE_UTC_BY_STATE = {
    CA: "2026-06-03T03:00:00Z",
    IA: "2026-06-03T01:00:00Z",
    MT: "2026-06-03T02:00:00Z",
    NJ: "2026-06-03T00:00:00Z",
    NM: "2026-06-03T01:00:00Z",
    SD: "2026-06-03T01:00:00Z"
  };

  const POLL_OPEN_UTC_BY_STATE = {
    CA: "2026-06-02T14:00:00Z",
    IA: "2026-06-02T12:00:00Z",
    MT: "2026-06-02T13:00:00Z",
    NJ: "2026-06-02T10:00:00Z",
    NM: "2026-06-02T13:00:00Z",
    SD: "2026-06-02T12:00:00Z"
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function slugify(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  function candidateNameParts(name) {
    return String(name || "")
      .replace(/"[^"]*"/g, " ")
      .replace(/\([^)]*\)/g, " ")
      .replace(/[.,]/g, " ")
      .split(/\s+/)
      .map((part) => part.replace(/[^A-Za-z-]/g, ""))
      .filter(Boolean);
  }

  function initials(name) {
    const parts = candidateNameParts(name);
    if (!parts.length) return "?";
    if (parts.length === 1) {
      const word = parts[0];
      return (word.length >= 2 ? word.slice(0, 2) : word.slice(0, 1)).toUpperCase();
    }
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }

  function percentLabel(value) {
    const number = Number(value || 0);
    if (!Number.isFinite(number)) return "0.0%";
    if (number >= 100) return ">99%";
    return `${number.toFixed(1)}%`;
  }

  function estimatedInLabel(value) {
    const number = Number(value || 0);
    if (!Number.isFinite(number)) return "0.0";
    if (number >= 100) return ">99";
    return `${number.toFixed(1)}`;
  }

  function validElectionIso(value) {
    if (!value) return "";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 2020) return "";
    return date.toISOString();
  }

  function numberLabel(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) ? number.toLocaleString("en-US") : "0";
  }

  function callTimeLabel(timestamp) {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    if (!Number.isFinite(date.getTime())) return "";
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short"
    }).format(date);
  }

  const DEM_PALETTE = [
    "#0391FF", "#5FC529", "#5560F5", "#32EBEB", "#2AE19F",
    "#214BE1", "#9FE121", "#5E21E1", "#72A2FF", "#A985F8",
    "#CA58F9", "#12A500", "#0033A5"
  ];

  const GOP_PALETTE = [
    "#A50000", "#C66518", "#DFC30E", "#C00F79", "#E14F50",
    "#FE9745", "#620000", "#FF8686", "#FF68B1"
  ];

  function stringToHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  function candidateColor(candidate, race) {
    const slug = slugify(candidate?.name);
    const mappedColor = PHOTO_SETS[String(race?.id)]?.colors?.[slug];
    const color = String(mappedColor || candidate?.color || "").trim();
    if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(color)) return color;
    
    const partyCode = candidate?.partyCode || "";
    const candidateName = String(candidate?.name || "").toLowerCase();
    const hash = stringToHash(candidateName + String(race?.id || ""));
    
    if (partyCode === "R" || partyCode === "Republican") {
      return GOP_PALETTE[hash % GOP_PALETTE.length];
    }
    if (partyCode === "D" || partyCode === "Democrat") {
      return DEM_PALETTE[hash % DEM_PALETTE.length];
    }
    if (partyCode === "I" || partyCode === "Independent") return "#2ec6a3";
    return "#7c6cff";
  }

  function candidatePhoto(candidate, race) {
    const slug = slugify(candidate?.name);
    const set = PHOTO_SETS[String(race?.id)];
    if (set?.photos?.[slug]) return `${set.base}/${set.photos[slug]}`;
    return `assets/img/candidates/live-results/${slug}.webp`;
  }

  function isRealCandidate(candidate) {
    const name = String(candidate?.name || "").trim();
    return Boolean(name) && !/^write-?in$/i.test(name);
  }

  function pollsAreClosed(race) {
    const iso = validElectionIso(race?.pollsClose || race?.pollCloseAt) || POLL_CLOSE_UTC_BY_STATE[String(race?.state || "").toUpperCase()];
    if (!iso) return false;
    const date = new Date(iso);
    return Number.isFinite(date.getTime()) && Date.now() >= date.getTime();
  }

  function pollsAreOpen(race) {
    const iso = validElectionIso(race?.pollsOpen || race?.pollOpenAt) || POLL_OPEN_UTC_BY_STATE[String(race?.state || "").toUpperCase()];
    if (!iso) return pollsAreClosed(race);
    const date = new Date(iso);
    return Number.isFinite(date.getTime()) && Date.now() >= date.getTime();
  }

  function automaticUncontestedCalls(race) {
    if (!pollsAreClosed(race)) return [];
    const realCandidates = (race.candidates || []).filter(isRealCandidate);
    if (realCandidates.length !== 1) return [];
    const calledAt = validElectionIso(race?.pollsClose || race?.pollCloseAt)
      || POLL_CLOSE_UTC_BY_STATE[String(race?.state || "").toUpperCase()]
      || "";
    return [{
      candidate: realCandidates[0].name,
      status: "winner",
      label: "Winner",
      automatic: true,
      calledAt
    }];
  }

  function labelFor(call, race) {
    if (call.label) return call.label;
    const status = String(call.status || "").toLowerCase();
    const raceText = `${race?.electionScope || race?.electionName || ""}`.toLowerCase();
    if (status === "projected") return "Projected winner";
    if (status === "advanced") return "Advanced to general election";
    if (status === "advances" || raceText.includes("primary")) return "Advances";
    return "Winner";
  }

  function verbFor(label, race, count) {
    const text = String(label || "").toLowerCase();
    const raceText = `${race?.electionScope || race?.electionName || ""}`.toLowerCase();
    if (text.includes("advance") || raceText.includes("open primary") || count > 1) return count > 1 ? "advance" : "advances";
    if (text.includes("project")) {
      if (raceText.includes("primary") || raceText.includes("open primary")) return "is projected to advance";
      return "is projected to win";
    }
    return "wins";
  }

  function callText(race, calledCandidates) {
    const names = calledCandidates.map((item) => item.candidate?.name || item.call.candidate).filter(Boolean);
    const label = labelFor(calledCandidates[0]?.call || {}, race);
    const verb = verbFor(label, race, names.length);
    const raceName = race?.electionName || "this race";
    if (names.length === 1) return `${names[0]} ${verb} in the ${raceName}.`;
    if (names.length === 2) return `${names[0]} and ${names[1]} ${verb} in the ${raceName}.`;
    return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)} ${verb} in the ${raceName}.`;
  }

  function fetchJson(url) {
    return fetch(`${url}?v=${Date.now()}`, { cache: "no-store" }).then((response) => {
      if (!response.ok) throw new Error(`${url} returned ${response.status}`);
      return response.json();
    });
  }

  function flattenRaces(data) {
    return (data?.groups || []).flatMap((group) => group.races || []);
  }

  function raceCandidatesForCalls(race, calls) {
    return calls.map((call) => ({
      call,
      candidate: (race?.candidates || []).find((candidate) => (
        String(candidate.name || "").toLowerCase() === String(call.candidate || "").toLowerCase()
      )) || { name: call.candidate, partyCode: "" }
    }));
  }

  function collectCalls(callsData, races) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const entries = Object.entries(callsData?.races || {})
      .filter(([raceId]) => !raceFilter || String(raceId) === String(raceFilter))
      .map(([raceId, value]) => {
        const race = races.find((item) => String(item.id) === String(raceId));
        const calls = Array.isArray(value?.calls) ? value.calls : [];
        return { raceId, race, calls, automatic: false };
      })
      .filter((entry) => {
        if (!entry.race || !entry.calls.length) return false;
        const electionDate = new Date(entry.race.electionDate || entry.race.pollsClose || entry.race.pollCloseAt);
        const latestCallTime = Math.max(...entry.calls.map((call) => Date.parse(call.calledAt || "") || 0), 0);
        const electionDateMidnight = new Date(electionDate);
        electionDateMidnight.setHours(0, 0, 0, 0);
        return electionDateMidnight.getTime() === today.getTime() && latestCallTime >= today.getTime();
      });

    const manuallyCalledRaceIds = new Set(entries.map((entry) => String(entry.raceId)));
    const autoEntries = races
      .filter((race) => !raceFilter || String(race.id) === String(raceFilter))
      .filter((race) => !manuallyCalledRaceIds.has(String(race.id)))
      .filter((race) => {
        const electionDate = new Date(race.electionDate || race.pollsClose || race.pollCloseAt);
        const electionDateMidnight = new Date(electionDate);
        electionDateMidnight.setHours(0, 0, 0, 0);
        return electionDateMidnight.getTime() === today.getTime();
      })
      .map((race) => ({ raceId: String(race.id), race, calls: automaticUncontestedCalls(race), automatic: true }))
      .filter((entry) => entry.calls.length);

    return [...entries, ...autoEntries].map((entry) => {
      const calledCandidates = raceCandidatesForCalls(entry.race, entry.calls);
      const latestTime = Math.max(...entry.calls.map((call) => Date.parse(call.calledAt || "") || 0), 0);
      const signature = `${entry.raceId}:${entry.calls.map((call) => `${call.candidate}:${call.status}:${call.calledAt || ""}`).join("|")}`;
      return {
        ...entry,
        calledCandidates,
        latestTime,
        signature,
        text: callText(entry.race, calledCandidates),
        label: labelFor(entry.calls[0] || {}, entry.race)
      };
    }).sort((a, b) => b.latestTime - a.latestTime || String(b.raceId).localeCompare(String(a.raceId)));
  }

  function ensureLayout() {
    if (root.dataset.ready) return;
    root.innerHTML = `
      <section class="broadcast-overlay-stage">
        <div id="broadcast-call-slot" class="broadcast-call-slot" aria-live="polite"></div>
        <div class="broadcast-ticker-shell">
          <div class="broadcast-ticker-brand">
            <img src="assets/img/FEA_White.webp" alt="Federal Elections Analysis">
            <strong>LIVE</strong>
          </div>
          <div class="broadcast-ticker-viewport">
            <div id="broadcast-ticker-track" class="broadcast-ticker-track"></div>
          </div>
          <div id="broadcast-ticker-clock" class="broadcast-ticker-clock"></div>
        </div>
      </section>
    `;
    root.dataset.ready = "true";
    updateClock();
    setInterval(updateClock, 10000);
  }

  function updateClock() {
    const clock = document.getElementById("broadcast-ticker-clock");
    if (!clock) return;
    clock.textContent = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York"
    }).format(new Date());
  }

  function tickerItems(calls, races, overlayConfig = {}) {
    const customItems = (overlayConfig.tickerItems || [])
      .filter((item) => item?.text)
      .map((item) => ({ tag: item.tag || "FEA", text: item.text }));
    const items = [...customItems];
    calls.slice(0, 8).forEach((call) => {
      items.push({ tag: "Race call", text: call.text });
    });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    races
      .filter((race) => {
        if (raceFilter && String(race.id) !== String(raceFilter)) return false;
        const electionDate = new Date(race.electionDate || race.pollsClose || race.pollCloseAt);
        const electionDateMidnight = new Date(electionDate);
        electionDateMidnight.setHours(0, 0, 0, 0);
        return electionDateMidnight.getTime() === today.getTime();
      })
      .slice()
      .sort((a, b) => Number(b.estimatedVoteReporting || b.percentReporting || 0) - Number(a.estimatedVoteReporting || a.percentReporting || 0))
      .slice(0, 12)
      .forEach((race) => {
        const candidates = [...(race.candidates || [])].sort((a, b) => Number(b.percent || 0) - Number(a.percent || 0) || Number(b.votes || 0) - Number(a.votes || 0));
        const leader = candidates[0];
        if (leader && (Number(leader.votes || 0) || Number(race.estimatedVoteReporting || race.percentReporting || 0))) {
          items.push({
            tag: race.state || "Update",
            text: `${race.electionName}: ${leader.name}`
          });
        } else {
          items.push({
            tag: race.state || "Status",
            text: `${race.electionName}: awaiting reported results`
          });
        }
      });
    if (!items.length) {
      items.push({ tag: "FEA Live", text: "Race calls and result updates will appear here during election coverage." });
    }
    return items;
  }

  function updateTicker(calls, races, overlayConfig = {}) {
    const track = document.getElementById("broadcast-ticker-track");
    if (!track) return;
    const items = tickerItems(calls, races, overlayConfig);
    const signature = items.map((item) => `${item.tag}:${item.text}`).join("||");
    if (signature === tickerSignature) return;
    tickerSignature = signature;
    const html = items.map((item) => `
      <span class="broadcast-ticker-item">
        <b>${escapeHtml(item.tag)}</b>
        <span>${escapeHtml(item.text)}</span>
      </span>
    `).join("");
    track.innerHTML = `<div class="broadcast-ticker-loop">${html}</div><div class="broadcast-ticker-loop" aria-hidden="true">${html}</div>`;
  }

  function avatarMarkup(item, race) {
    const candidate = item.candidate || { name: item.call.candidate };
    const color = candidateColor(candidate, race);
    const photo = candidatePhoto(candidate, race);
    const fallback = initials(candidate.name);
    return `
      <span class="broadcast-call-avatar" style="--candidate-color:${escapeHtml(color)}">
        <b>${escapeHtml(fallback)}</b>
        <img src="${escapeHtml(photo)}" alt="" data-fallback="${escapeHtml(fallback)}">
      </span>
    `;
  }

  function renderCallCard(callEvent) {
    const primary = callEvent.calledCandidates[0]?.candidate || { name: "Candidate" };
    const color = candidateColor(primary, callEvent.race);
    const avatars = callEvent.calledCandidates.map((item) => avatarMarkup(item, callEvent.race)).join("");
    const raceName = callEvent.race?.electionName || "Election race";
    const calledAt = callTimeLabel(Math.max(...callEvent.calls.map((call) => Date.parse(call.calledAt || "") || 0), 0));
    return `
      <article class="broadcast-call-card" style="--candidate-color:${escapeHtml(color)}">
        <div class="broadcast-call-topline">
          <span>${escapeHtml(callEvent.label)}</span>
          <i aria-hidden="true">&#8594;</i>
        </div>
        <div class="broadcast-call-body">
          <div class="broadcast-call-copy">
            <p>${escapeHtml(raceName)}</p>
            <h1>${escapeHtml(callEvent.text)}</h1>
            <small>Race called by Federal Elections Analysis${calledAt ? ` at ${escapeHtml(calledAt)}` : ""}.</small>
          </div>
          <div class="broadcast-call-avatars">${avatars}</div>
        </div>
      </article>
    `;
  }

  function bindImageFallbacks(card) {
    card.querySelectorAll("img[data-fallback]").forEach((img) => {
      img.addEventListener("error", () => {
        img.remove();
      }, { once: true });
    });
  }

  function playQueue() {
    if (isShowingCall || !queuedCalls.length) return;
    const slot = document.getElementById("broadcast-call-slot");
    if (!slot) return;
    isShowingCall = true;
    const next = queuedCalls.shift();
    slot.innerHTML = renderCallCard(next);
    const card = slot.querySelector(".broadcast-call-card");
    bindImageFallbacks(card);
    requestAnimationFrame(() => card.classList.add("is-live"));
    setTimeout(() => {
      card.classList.add("is-exiting");
      setTimeout(() => {
        slot.innerHTML = "";
        isShowingCall = false;
        playQueue();
      }, 700);
    }, 8500);
  }

  function queueNewCalls(calls) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    calls.slice().reverse().forEach((call) => {
      if (shownCalls.has(call.signature)) return;
      if (call.latestTime < today.getTime()) return;
      shownCalls.add(call.signature);
      queuedCalls.push(call);
    });
    playQueue();
  }

  async function update() {
    ensureLayout();
    try {
      const [callsData, resultsData, overlayConfig] = await Promise.all([
        fetchJson("data/result-calls.json"),
        fetchJson("data/live-results.json"),
        fetchJson("data/overlay-config.json").catch(() => ({ tickerItems: [] }))
      ]);
      callsDataCache = callsData;
      resultsDataCache = resultsData;
      overlayConfigCache = overlayConfig;
      const races = flattenRaces(resultsData);
      const calls = collectCalls(callsData, races);
      updateTicker(calls, races, overlayConfig);
      queueNewCalls(calls);
    } catch (error) {
      console.error(error);
      const races = flattenRaces(resultsDataCache);
      const calls = collectCalls(callsDataCache, races);
      updateTicker(calls, races, overlayConfigCache || {});
    }
  }

  update();
  setInterval(update, 5000);
})();
