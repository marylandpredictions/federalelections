// 2026 Election Night Results Page
// Uses existing map files and starts with no results

class ElectionNightPage {
  constructor() {
    this.selectedMode = "house";
    this.selectedRaceId = null;
    this.focusedRace = null;
    this.mapData = null;
    this.raceData = [];
    this.lastUpdated = null;
    
    this.init();
  }

  init() {
    this.bindEvents();
    this.loadInitialData();
  }

  bindEvents() {
    // Mode toggle buttons
    document.querySelectorAll(".button-link[data-mode]").forEach(button => {
      button.addEventListener("click", (e) => {
        const mode = e.target.dataset.mode;
        this.switchMode(mode);
      });
    });

    // Clear focus button
    const clearFocusButton = document.getElementById("clear-focus");
    if (clearFocusButton) {
      clearFocusButton.addEventListener("click", () => {
        this.clearFocus();
      });
    }
  }

  async loadInitialData() {
    await this.loadMap();
    await this.renderSummary();
    await this.renderRaceList();
  }

  async loadMap() {
    try {
      const mapFile = this.selectedMode === "house" 
        ? "data/house-districts-119.geojson"
        : "data/result-us-states.geojson";
      
      const response = await fetch(mapFile);
      if (!response.ok) throw new Error("Failed to load map");
      
      this.mapData = await response.json();
      this.renderMap();
    } catch (error) {
      console.error("Failed to load map:", error);
      this.renderMapError();
    }
  }

  renderMap() {
    const mapContainer = document.getElementById("election-map");
    if (!mapContainer || !this.mapData) return;

    // Use D3 to render the map
    const width = mapContainer.clientWidth || 800;
    const height = 500;
    
    const svg = d3.select("#election-map")
      .append("svg")
      .attr("width", width)
      .attr("height", height);

    const projection = this.selectedMode === "house"
      ? d3.geoAlbersUsa()
      : d3.geoAlbersUsa();
    
    const path = d3.geoPath().projection(projection);

    svg.selectAll("path")
      .data(this.mapData.features)
      .enter()
      .append("path")
      .attr("d", path)
      .attr("fill", "#d6d9e2")
      .attr("stroke", "#fff")
      .attr("stroke-width", 0.5)
      .on("click", (event, d) => this.handleMapClick(d))
      .on("mouseover", (event, d) => this.handleMapHover(d))
      .on("mouseout", () => this.handleMapHoverOut());
  }

  renderMapError() {
    const mapContainer = document.getElementById("election-map");
    if (!mapContainer) return;

    mapContainer.innerHTML = `
      <p style="text-align: center; color: #c6d2ff; padding: 100px 0;">
        Map will appear when results are available
      </p>
    `;
  }

  handleMapClick(feature) {
    // Handle map click to select race
    const raceId = feature.properties?.id || feature.properties?.GEOID;
    if (raceId) {
      this.selectRace(raceId);
    }
  }

  handleMapHover(feature) {
    const hoverCard = document.getElementById("map-hover-card");
    if (!hoverCard || !feature) return;

    const name = feature.properties?.name || feature.properties?.STATE_NAME || feature.properties?.district || "Unknown";
    hoverCard.innerHTML = `<strong>${name}</strong>`;
    hoverCard.style.display = "block";
  }

  handleMapHoverOut() {
    const hoverCard = document.getElementById("map-hover-card");
    if (hoverCard) {
      hoverCard.style.display = "none";
    }
  }

  async switchMode(mode) {
    if (this.selectedMode === mode) return;

    this.selectedMode = mode;
    this.selectedRaceId = null;
    this.focusedRace = null;
    this.mapData = null;
    this.raceData = [];

    // Update mode buttons
    document.querySelectorAll(".button-link[data-mode]").forEach(button => {
      button.classList.toggle("active", button.dataset.mode === mode);
    });

    // Update summary label
    const summaryLabel = document.getElementById("summary-label");
    if (summaryLabel) {
      summaryLabel.textContent = `${mode.charAt(0).toUpperCase() + mode.slice(1)} Results`;
    }

    // Clear focus panel
    this.clearFocus();

    // Load new data
    await this.loadMap();
    await this.renderSummary();
    await this.renderRaceList();
  }

  async renderSummary() {
    // Start with no results
    document.getElementById("total-races").textContent = "--";
    document.getElementById("called-races").textContent = "-- called";
    document.getElementById("reporting-status").textContent = "No votes reported";
    document.getElementById("dem-seats").textContent = "--";
    document.getElementById("rep-seats").textContent = "--";
    document.getElementById("reporting-percent").textContent = "--%";
    document.getElementById("last-updated").textContent = "--";
  }

  async renderRaceList() {
    const raceListContainer = document.getElementById("race-list");
    if (!raceListContainer) return;

    // Start with no races
    raceListContainer.innerHTML = `
      <p style="text-align: center; color: #c6d2ff; padding: 100px 0;">
        No results available yet. Results will appear after polls close.
      </p>
    `;
  }

  async selectRace(raceId) {
    this.selectedRaceId = raceId;

    try {
      // Try to load race details from existing data files
      const response = await fetch(`data/live-results-races/${raceId}.json`);
      if (!response.ok) {
        this.renderNoRaceData();
        return;
      }

      this.focusedRace = await response.json();
      this.renderFocusedRace();
    } catch (error) {
      console.error("Failed to load race details:", error);
      this.renderNoRaceData();
    }
  }

  renderNoRaceData() {
    const focusedPanel = document.getElementById("focused-race-panel");
    const focusedContent = document.getElementById("focused-race-content");
    
    if (!focusedPanel || !focusedContent) return;

    focusedPanel.style.display = "block";
    focusedContent.innerHTML = `
      <p style="color: #c6d2ff;">No results available for this race yet.</p>
    `;
  }

  renderFocusedRace() {
    const focusedPanel = document.getElementById("focused-race-panel");
    const focusedContent = document.getElementById("focused-race-content");
    
    if (!focusedPanel || !focusedContent || !this.focusedRace) return;

    focusedPanel.style.display = "block";

    const race = this.focusedRace;
    const candidates = race.candidates || [];

    const candidateRows = candidates.map(cand => {
      const party = cand.party || "";
      const partyClass = party === "D" ? "party-dem" : party === "R" ? "party-rep" : party === "I" ? "party-ind" : "party-other";
      const winnerClass = cand.isWinner ? "is-winner" : "";
      
      return `
        <article class="result-full-candidate ${partyClass} ${winnerClass}" data-candidate-name="${cand.name}" data-candidate-percent="${cand.percent || 0}" style="--candidate-color: ${this.partyColor(party)};">
          <div class="result-full-header">
            <div class="result-full-info">
              <strong class="result-full-name">${cand.name}</strong>
              ${cand.isIncumbent ? '<span class="result-full-incumbent">Incumbent</span>' : ''}
              <span class="result-full-party">${party}</span>
            </div>
            <div class="result-full-numbers">
              <span class="result-full-percent">${cand.percent !== undefined ? cand.percent.toFixed(1) + "%" : "N/A"}</span>
              <span class="result-full-votes">${cand.votes !== undefined ? cand.votes.toLocaleString() + " votes" : "No votes"}</span>
            </div>
          </div>
          ${cand.isWinner ? '<div class="result-full-winner-badge">Winner</div>' : ''}
        </article>
      `;
    }).join("");

    focusedContent.innerHTML = `
      <div style="margin-bottom: 24px;">
        <h3 style="margin: 0 0 8px; font-size: 1.5rem;">${race.electionName || race.name}</h3>
        <div style="color: #c6d2ff; font-size: 0.9rem;">
          ${race.reportingPercent !== undefined ? race.reportingPercent + "% reporting" : "No votes reported"}
        </div>
      </div>
      <div class="result-full-candidates">
        ${candidateRows}
      </div>
    `;
  }

  partyColor(party) {
    const p = String(party || "").toUpperCase();
    if (p === "D") return "#2d7cff";
    if (p === "R") return "#f3536a";
    if (p === "I") return "#5fc529";
    if (p === "L") return "#ffd700";
    if (p === "G") return "#00a86b";
    return "#566274";
  }

  clearFocus() {
    this.selectedRaceId = null;
    this.focusedRace = null;

    const focusedPanel = document.getElementById("focused-race-panel");
    if (focusedPanel) {
      focusedPanel.style.display = "none";
    }
  }
}

// Initialize the page when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  new ElectionNightPage();
});
