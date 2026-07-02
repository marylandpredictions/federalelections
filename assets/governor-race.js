(function () {
  function setText(id, value) {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    })[char]);
  }

  function pct(value) {
    if (Number.isFinite(Number(value)) && Number(value) === 1) return ">99%";
    if (Number.isFinite(Number(value)) && Number(value) === 0) return "<1%";
    return `${Math.round((Number(value) || 0) * 100)}%`;
  }

  function oneDecimal(value) {
    if (Number.isFinite(Number(value)) && Number(value) === 1) return ">99%";
    if (Number.isFinite(Number(value)) && Number(value) === 0) return "<1%";
    return `${((Number(value) || 0) * 100).toFixed(1)}%`;
  }

  function signedPointMargin(value) {
    const margin = Number(value) || 0;
    if (Math.abs(margin) < .05) return "Even";
    return `${margin > 0 ? "D" : "R"}+${Math.abs(margin).toFixed(1)} pts`;
  }

  function forecastDisplayMargin(race) {
    const value = race?.projectedResultMargin?.value ?? race?.projectedMargin ?? race?.margin;
    return Number.isFinite(Number(value)) ? Number(value) : 0;
  }

  function candidateDisplayName(race, party) {
    const name = party === "D" ? race.dem : race.rep;
    const status = party === "D" ? race.demStatus : race.repStatus;
    if (status === "unresolved" && (name === "Democrat" || name === "Republican")) return name;
    if (status === "unresolved" && ["Democratic field", "Republican field"].includes(name)) return party === "D" ? "Democratic field" : "Republican field";
    return name || (party === "D" ? "Democrat" : "Republican");
  }

  function candidateStatusLabel(race, party) {
    const status = party === "D" ? race.demStatus : race.repStatus;
    const badge = status === "presumptive" ? " (P)" : status === "nominee" ? " nominee" : status === "front-runner" ? " front-runner" : "";
    return `${candidateDisplayName(race, party)}${badge}`;
  }

  function profileLabel(profile) {
    if (!profile) return "standard";
    const source = profile.source === "candidate" ? "candidate profile" : "generic profile";
    return `${profile.label || profile.key || "standard"} (${source})`;
  }

  function groupLabel(key) {
    return ({
      white_college: "White college",
      white_noncollege: "White non-college",
      black: "Black",
      latino: "Latino",
      asian_other: "Asian/other",
      youth: "18-29",
      senior: "65+"
    })[key] || String(key).replace(/_/g, " ");
  }

  function renderInputs(race) {
    const container = document.getElementById("governor-race-input-cards");
    if (!container) return;
    const demographic = race.demographicPull;
    const competitiveIndependents = (race.extraCandidates || []).filter((candidate) => {
      return candidate.party === "I" && candidate.note && candidate.note.toLowerCase().includes("competitive");
    });
    const extras = competitiveIndependents.map((candidate) => `<li>${escapeHtml(candidate.name)}: ${escapeHtml(candidate.note || candidate.party || "tracked option")}</li>`).join("");
    const demographicRows = demographic ? [
      `<li>Adjustment: ${signedPointMargin(demographic.adjustment || 0)}</li>`,
      `<li>Democratic profile: ${escapeHtml(profileLabel(demographic.demProfile))}</li>`,
      `<li>Republican profile: ${escapeHtml(profileLabel(demographic.repProfile))}</li>`,
      ...((demographic.topGroups || []).map((item) => `<li>${escapeHtml(groupLabel(item.group))}: ${signedPointMargin(item.effect || 0)}</li>`))
    ].join("") : `<li>No separate demographic-pull adjustment saved for this race.</li>`;
    const finance = race.sourceInputs?.finance;
    const financeSource = finance?.sourceUrl
      ? `<a href="${escapeHtml(finance.sourceUrl)}" target="_blank" rel="noopener">${escapeHtml(finance.source || "Configured state campaign-finance source")}</a>`
      : escapeHtml(finance?.source || "Configured state campaign-finance source");
    const financeRows = finance ? [
      `<li>Finance signal: ${signedPointMargin(race.sourceInputs?.financeSignal || 0)}</li>`,
      `<li>${escapeHtml(finance.demFinanceLabel || "Democratic side")} receipts: $${Math.round(finance.demReceipts || 0).toLocaleString()}</li>`,
      `<li>${escapeHtml(finance.repFinanceLabel || "Republican side")} receipts: $${Math.round(finance.repReceipts || 0).toLocaleString()}</li>`,
      `<li>${escapeHtml(finance.demFinanceLabel || "Democratic side")} cash: $${Math.round(finance.demCash || 0).toLocaleString()}</li>`,
      `<li>${escapeHtml(finance.repFinanceLabel || "Republican side")} cash: $${Math.round(finance.repCash || 0).toLocaleString()}</li>`,
      `<li>Source: ${financeSource}</li>`
    ].join("") : `<li>No normalized state campaign-finance source is available for this race yet.</li>`;
    const pollSources = race.sourceInputs?.pollSources || [];
    const pollSourceUrls = race.sourceInputs?.pollSourceUrls || [];
    const pollMatchups = race.sourceInputs?.pollMatchups || [];
    const pollMarginInput = race.sourceInputs?.pollMargin;
    const pollMarginValue = Number(pollMarginInput?.value);
    const usableGeneralPoll = Boolean(pollMarginInput?.usableAsGeneralElectionPoll);
    const pollingRows = Number(race.sourceInputs?.pollCount || 0) > 0 && usableGeneralPoll ? [
      `<li>Polling pull: ${signedPointMargin(pollMarginValue)}</li>`,
      `<li>Type: ${escapeHtml(pollMarginInput?.type || "GENERAL_ELECTION_POLL")}</li>`,
      `<li>Usable polls: ${escapeHtml(String(race.sourceInputs?.pollCount || 0))}</li>`,
      `<li>Sources: ${escapeHtml(pollSources.join(", ") || "Governor polling source")}</li>`,
      pollSourceUrls.length ? `<li>Links: ${pollSourceUrls.map((url) => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a>`).join(" / ")}</li>` : "",
      pollMatchups.length ? `<li>Matched matchup: ${escapeHtml(pollMatchups.join(" / "))}</li>` : ""
    ].filter(Boolean).join("") : [
      `<li>No usable general-election polling average is available for this race yet.</li>`,
      pollMarginInput?.type && pollMarginInput.type !== "NONE" ? `<li>Polling signal type: ${escapeHtml(pollMarginInput.type)} (not treated as a usable general-election poll)</li>` : ""
    ].filter(Boolean).join("");
    const snapshotCards = [
      ["Model classification", race.modelRating || race.rating, "Generated from the current probability and projected margin"],
      ["Fundamentals", signedPointMargin(race.fundamentalsMargin), "PVI, prior gubernatorial result, and incumbency"],
      ["Candidate/local", signedPointMargin(race.candidateAndLocal), "Manual candidate-quality and local context adjustment"],
      ["Finance", signedPointMargin(race.sourceInputs?.financeSignal || 0), "State-level campaign finance input"],
      ["Polling", pollMarginInput?.value != null ? signedPointMargin(pollMarginValue) : "--", usableGeneralPoll ? "Matched governor general-election polling input" : "No usable governor general-election polling input"],
      ["Demographic pull", signedPointMargin(race.demographicPull?.adjustment || 0), "Candidate profile interaction with state electorate"],
      ["Model margin", signedPointMargin(forecastDisplayMargin(race)), "Final projected vote margin"],
      ["Structural baseline", signedPointMargin(race.structuralMargin ?? race.ratingMargin), "PVI, prior gubernatorial result, and incumbency before other model adjustments"]
    ].map(([label, value, detail]) => `
      <article class="input-snapshot-card">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
        <small>${escapeHtml(detail)}</small>
      </article>
    `).join("");
    container.innerHTML = `
      <div class="input-snapshot-grid">${snapshotCards}</div>
      <details open><summary>Candidates</summary><ul>
        <li>${escapeHtml(candidateStatusLabel(race, "D"))}</li>
        <li>${escapeHtml(candidateStatusLabel(race, "R"))}</li>
        <li>${escapeHtml(race.primarySummary || "Primary not yet resolved or not entered in the manual candidate ledger.")}</li>
        ${extras}
      </ul></details>
      <details><summary>Demographic pull</summary><ul>${demographicRows}</ul></details>
      <details><summary>Polling</summary><ul>${pollingRows}</ul></details>
      <details><summary>Finance</summary><ul>${financeRows}</ul></details>
      <details><summary>Fundamentals</summary><ul>
        <li>PVI: ${escapeHtml(String(race.pvi))}</li>
        <li>Last gubernatorial margin: ${signedPointMargin(race.lastMargin)}</li>
        <li>Incumbency/status: ${escapeHtml(race.status || "--")}</li>
        <li>Structural baseline: ${signedPointMargin(race.structuralMargin ?? race.ratingMargin)}</li>
      </ul></details>
    `;
  }

  function renderHistory(race) {
    const chart = document.getElementById("governor-race-history");
    if (!chart) return;
    let points = race.history?.length ? race.history : [{ date: race.modelDate || new Date().toISOString().split('T')[0], dem: race.demProbability }];
    const onlyOneSavedRun = points.length < 2;
    if (typeof renderLineChart === "function") {
      renderLineChart(chart, points, {
        label: "Governor race probability history",
        pointHtml: (point) => `${point.date}<br>D ${pct(point.dem)} / R ${pct(1 - point.dem)}`,
        value: (point) => point.dem,
        electionDate: "2026-11-03",
        singleNote: "State-level governor probability history starts from the first saved state run and grows each daily run."
      });
      if (onlyOneSavedRun) {
        chart.insertAdjacentHTML("beforeend", `<p class="meta">Only one state-level governor run is currently saved for this race. Additional daily runs will extend this chart.</p>`);
      }
    } else {
      chart.innerHTML = `<p class="meta">Chart rendering not available. Current: D ${pct(race.demProbability)} / R ${pct(race.repProbability)}</p>`;
    }
  }

  function renderRace(data) {
    const state = new URLSearchParams(window.location.search).get("state")?.toUpperCase() || "VT";
    const race = data.races.find((item) => item.state === state) || data.races[0];
    const winner = race.demProbability >= .5 ? candidateDisplayName(race, "D") : candidateDisplayName(race, "R");
    const winProb = Math.max(race.demProbability, race.repProbability);
    document.title = `${race.displayName} | Federal Elections Analysis`;
    setText("governor-race-state", race.state);
    setText("governor-race-name", race.displayName);
    setText("governor-race-note", `${race.status}. ${race.primarySummary || ""}`);
    setText("governor-race-winner", `${winner} ${pct(winProb)}`);
    setText("governor-race-dem", pct(race.demProbability));
    setText("governor-race-rep", pct(race.repProbability));
    setText("governor-race-tipping", oneDecimal(race.tippingPower));
    setText("governor-race-rating", race.modelRating || race.rating);
    setText("governor-race-margin", signedPointMargin(forecastDisplayMargin(race)));
    setText("governor-race-seat", race.status || "--");
    setText("governor-race-incumbent", race.incumbent || "--");
    setText("governor-race-dem-candidate", candidateStatusLabel(race, "D"));
    setText("governor-race-rep-candidate", candidateStatusLabel(race, "R"));
    setText("governor-race-primary", `${race.primary || "unresolved"} / ${race.primaryDate || "--"}`);
    setText("governor-race-independent", race.independent || "none");
    const extras = (race.extraCandidates || []).map((candidate) => `${candidate.name} (${candidate.note || candidate.party || "tracked option"})`).join("; ");
    setText("governor-race-primary-summary", extras ? `${race.primarySummary} Additional tracked option: ${extras}.` : race.primarySummary);
    const demTrack = document.getElementById("governor-race-dem-track");
    const repTrack = document.getElementById("governor-race-rep-track");
    if (demTrack && repTrack) {
      demTrack.style.width = `${race.demProbability * 100}%`;
      repTrack.style.width = `${race.repProbability * 100}%`;
    }
    renderInputs(race);
    renderHistory(race);
  }

  async function init() {
    if (!document.getElementById("governor-race-detail-page")) return;
    try {
      const response = await fetch("data/governor-forecast.json", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      renderRace(await response.json());
    } catch (error) {
      const container = document.getElementById("governor-race-input-cards");
      if (container) container.innerHTML = `<p class="meta">Governor forecast data did not load. Run <code>npm start</code> and open this page through localhost. ${escapeHtml(error.message || "")}</p>`;
    }
  }

  init();
})();
