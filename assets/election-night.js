// 2026 Election Night Results Page
// Results Provider Abstraction Layer

// Normalized race format
// type ElectionRace = {
//   id: string;
//   year: 2026;
//   type: "house" | "senate" | "governor";
//   state: string;
//   district?: string;
//   name: string;
//   status:
//     | "pre_election"
//     | "not_started"
//     | "polls_closed_no_votes"
//     | "reporting"
//     | "too_early"
//     | "too_close"
//     | "called"
//     | "recount_likely"
//     | "runoff";
//   reportingPercent?: number;
//   lastUpdated?: string;
//   candidates: CandidateResult[];
//   counties?: CountyResult[];
// };

// type CandidateResult = {
//   id: string;
//   name: string;
//   party: "D" | "R" | "I" | "L" | "G" | "Other";
//   votes?: number;
//   percent?: number;
//   imageUrl?: string;
//   isWinner?: boolean;
//   isIncumbent?: boolean;
//   isPresumptiveNominee?: boolean;
//   isPlaceholder?: boolean;
//   placeholderLabel?: string;
// };

// type CountyResult = {
//   name: string;
//   fips?: string;
//   votes?: Record<string, number>;
//   percent?: Record<string, number>;
//   leader?: string;
//   margin?: number;
//   reportingPercent?: number;
// };

// type ElectionSummary = {
//   mode: "house" | "senate" | "governor";
//   totalRaces: number;
//   calledRaces: number;
//   leadingRaces: number;
//   democraticVotes?: number;
//   republicanVotes?: number;
//   democraticSeats?: number;
//   republicanSeats?: number;
//   netChange?: {
//     democratic: number;
//     republican: number;
//   };
//   lastUpdated?: string;
// };

// type RaceIndexItem = {
//   id: string;
//   state: string;
//   district?: string;
//   name: string;
//   status: string;
//   reportingPercent?: number;
//   leader?: string;
//   margin?: number;
// };

// Results Provider Interface
class ResultsProvider {
  async getSummary(mode) {
    throw new Error("getSummary must be implemented by subclass");
  }

  async getRaceIndex(mode) {
    throw new Error("getRaceIndex must be implemented by subclass");
  }

  async getRaceDetails(raceId) {
    throw new Error("getRaceDetails must be implemented by subclass");
  }

  async getCountyResults(raceId) {
    throw new Error("getCountyResults must be implemented by subclass");
  }
}

// TODO: Replace this placeholder with NBC News 2026 election results feed
// once the actual endpoint or data structure is available.
class NBCResultsProvider extends ResultsProvider {
  async getSummary(mode) {
    // TODO: Implement NBC API call for summary data
    console.warn("NBCResultsProvider.getSummary not yet implemented - using placeholder");
    return {
      mode,
      totalRaces: 0,
      calledRaces: 0,
      leadingRaces: 0,
      lastUpdated: new Date().toISOString()
    };
  }

  async getRaceIndex(mode) {
    // TODO: Implement NBC API call for race index
    console.warn("NBCResultsProvider.getRaceIndex not yet implemented - using placeholder");
    return [];
  }

  async getRaceDetails(raceId) {
    // TODO: Implement NBC API call for race details
    console.warn("NBCResultsProvider.getRaceDetails not yet implemented - using placeholder");
    return null;
  }

  async getCountyResults(raceId) {
    // TODO: Implement NBC API call for county results
    console.warn("NBCResultsProvider.getCountyResults not yet implemented - using placeholder");
    return [];
  }
}

// Mock Results Provider for testing and pre-election preview
class MockResultsProvider extends ResultsProvider {
  constructor() {
    super();
    this.mockData = this.generateMockData();
  }

  generateMockData() {
    return {
      house: {
        summary: {
          mode: "house",
          totalRaces: 435,
          calledRaces: 312,
          leadingRaces: 89,
          democraticVotes: 45230000,
          republicanVotes: 44180000,
          democraticSeats: 198,
          republicanSeats: 214,
          netChange: { democratic: -5, republican: +5 },
          lastUpdated: new Date().toISOString()
        },
        races: this.generateHouseRaces()
      },
      senate: {
        summary: {
          mode: "senate",
          totalRaces: 34,
          calledRaces: 18,
          leadingRaces: 12,
          democraticVotes: 28500000,
          republicanVotes: 27800000,
          democraticSeats: 45,
          republicanSeats: 48,
          netChange: { democratic: -2, republican: +2 },
          lastUpdated: new Date().toISOString()
        },
        races: this.generateSenateRaces()
      },
      governor: {
        summary: {
          mode: "governor",
          totalRaces: 36,
          calledRaces: 22,
          leadingRaces: 10,
          democraticVotes: 15200000,
          republicanVotes: 14800000,
          democraticSeats: 18,
          republicanSeats: 16,
          netChange: { democratic: 0, republican: 0 },
          lastUpdated: new Date().toISOString()
        },
        races: this.generateGovernorRaces()
      }
    };
  }

  generateHouseRaces() {
    const states = ["CA", "TX", "FL", "NY", "PA", "OH", "GA", "NC", "MI", "AZ"];
    const statuses = ["called", "called", "called", "reporting", "reporting", "too_early", "pre_election"];
    const races = [];

    for (let i = 0; i < 50; i++) {
      const state = states[i % states.length];
      const district = String(i + 1);
      const status = statuses[i % statuses.length];
      const isDemocratic = Math.random() > 0.5;

      races.push({
        id: `house-${state}-${district}`,
        year: 2026,
        type: "house",
        state,
        district,
        name: `${state} ${String(district).padStart(2, "0")}`,
        status,
        reportingPercent: status === "pre_election" ? 0 : Math.floor(Math.random() * 100),
        lastUpdated: new Date().toISOString(),
        candidates: [
          {
            id: `cand-d-${i}`,
            name: isDemocratic ? "Democratic Nominee" : "Republican Nominee",
            party: isDemocratic ? "D" : "R",
            votes: status === "pre_election" ? 0 : Math.floor(Math.random() * 200000),
            percent: status === "pre_election" ? 0 : Math.floor(Math.random() * 60) + 40,
            isWinner: status === "called" && isDemocratic,
            isPlaceholder: true,
            placeholderLabel: isDemocratic ? "Democratic nominee" : "Republican nominee"
          },
          {
            id: `cand-r-${i}`,
            name: !isDemocratic ? "Republican Nominee" : "Democratic Nominee",
            party: !isDemocratic ? "R" : "D",
            votes: status === "pre_election" ? 0 : Math.floor(Math.random() * 200000),
            percent: status === "pre_election" ? 0 : Math.floor(Math.random() * 40),
            isWinner: status === "called" && !isDemocratic,
            isPlaceholder: true,
            placeholderLabel: !isDemocratic ? "Republican nominee" : "Democratic nominee"
          }
        ]
      });
    }

    return races;
  }

  generateSenateRaces() {
    const states = ["PA", "OH", "MI", "WI", "AZ", "GA", "NV", "NC", "FL", "TX"];
    const statuses = ["called", "called", "reporting", "reporting", "too_close", "too_early", "pre_election"];
    const races = [];

    for (let i = 0; i < 20; i++) {
      const state = states[i % states.length];
      const status = statuses[i % statuses.length];
      const isDemocratic = Math.random() > 0.5;

      races.push({
        id: `senate-${state}`,
        year: 2026,
        type: "senate",
        state,
        name: `${state} Senate`,
        status,
        reportingPercent: status === "pre_election" ? 0 : Math.floor(Math.random() * 100),
        lastUpdated: new Date().toISOString(),
        candidates: [
          {
            id: `cand-d-${i}`,
            name: isDemocratic ? "Democratic Nominee" : "Republican Nominee",
            party: isDemocratic ? "D" : "R",
            votes: status === "pre_election" ? 0 : Math.floor(Math.random() * 1500000),
            percent: status === "pre_election" ? 0 : Math.floor(Math.random() * 60) + 40,
            isWinner: status === "called" && isDemocratic,
            isPlaceholder: true,
            placeholderLabel: isDemocratic ? "Democratic nominee" : "Republican nominee"
          },
          {
            id: `cand-r-${i}`,
            name: !isDemocratic ? "Republican Nominee" : "Democratic Nominee",
            party: !isDemocratic ? "R" : "D",
            votes: status === "pre_election" ? 0 : Math.floor(Math.random() * 1500000),
            percent: status === "pre_election" ? 0 : Math.floor(Math.random() * 40),
            isWinner: status === "called" && !isDemocratic,
            isPlaceholder: true,
            placeholderLabel: !isDemocratic ? "Republican nominee" : "Democratic nominee"
          }
        ]
      });
    }

    return races;
  }

  generateGovernorRaces() {
    const states = ["PA", "MI", "AZ", "GA", "NV", "NC", "TX", "FL"];
    const statuses = ["called", "called", "reporting", "too_close", "too_early", "pre_election"];
    const races = [];

    for (let i = 0; i < 15; i++) {
      const state = states[i % states.length];
      const status = statuses[i % statuses.length];
      const isDemocratic = Math.random() > 0.5;

      races.push({
        id: `gov-${state}`,
        year: 2026,
        type: "governor",
        state,
        name: `${state} Governor`,
        status,
        reportingPercent: status === "pre_election" ? 0 : Math.floor(Math.random() * 100),
        lastUpdated: new Date().toISOString(),
        candidates: [
          {
            id: `cand-d-${i}`,
            name: isDemocratic ? "Democratic Nominee" : "Republican Nominee",
            party: isDemocratic ? "D" : "R",
            votes: status === "pre_election" ? 0 : Math.floor(Math.random() * 2000000),
            percent: status === "pre_election" ? 0 : Math.floor(Math.random() * 60) + 40,
            isWinner: status === "called" && isDemocratic,
            isPlaceholder: true,
            placeholderLabel: isDemocratic ? "Democratic nominee" : "Republican nominee"
          },
          {
            id: `cand-r-${i}`,
            name: !isDemocratic ? "Republican Nominee" : "Democratic Nominee",
            party: !isDemocratic ? "R" : "D",
            votes: status === "pre_election" ? 0 : Math.floor(Math.random() * 2000000),
            percent: status === "pre_election" ? 0 : Math.floor(Math.random() * 40),
            isWinner: status === "called" && !isDemocratic,
            isPlaceholder: true,
            placeholderLabel: !isDemocratic ? "Republican nominee" : "Democratic nominee"
          }
        ]
      });
    }

    return races;
  }

  async getSummary(mode) {
    await this.delay(100);
    return this.mockData[mode]?.summary || {
      mode,
      totalRaces: 0,
      calledRaces: 0,
      leadingRaces: 0,
      lastUpdated: new Date().toISOString()
    };
  }

  async getRaceIndex(mode) {
    await this.delay(150);
    const races = this.mockData[mode]?.races || [];
    return races.map(race => ({
      id: race.id,
      state: race.state,
      district: race.district,
      name: race.name,
      status: race.status,
      reportingPercent: race.reportingPercent,
      leader: race.candidates[0]?.name,
      margin: race.candidates[0] && race.candidates[1] 
        ? Math.abs(race.candidates[0].percent - race.candidates[1].percent)
        : 0
    }));
  }

  async getRaceDetails(raceId) {
    await this.delay(200);
    for (const mode of ["house", "senate", "governor"]) {
      const race = this.mockData[mode]?.races?.find(r => r.id === raceId);
      if (race) {
        return race;
      }
    }
    return null;
  }

  async getCountyResults(raceId) {
    await this.delay(150);
    // Return mock county data for some races
    const counties = [];
    const countyNames = ["County 1", "County 2", "County 3", "County 4", "County 5"];
    
    for (let i = 0; i < countyNames.length; i++) {
      const isDemocratic = Math.random() > 0.5;
      counties.push({
        name: countyNames[i],
        fips: `0000${i}`,
        votes: {
          D: Math.floor(Math.random() * 50000),
          R: Math.floor(Math.random() * 50000)
        },
        percent: {
          D: Math.floor(Math.random() * 60) + 20,
          R: Math.floor(Math.random() * 60) + 20
        },
        leader: isDemocratic ? "D" : "R",
        margin: Math.floor(Math.random() * 20),
        reportingPercent: Math.floor(Math.random() * 100)
      });
    }
    
    return counties;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Simulation Results Provider for admin testing
class SimulationResultsProvider extends MockResultsProvider {
  constructor() {
    super();
    this.simulationState = "pre_election";
  }

  setSimulationState(state) {
    this.simulationState = state;
    this.regenerateMockData();
  }

  regenerateMockData() {
    this.mockData = this.generateMockData();
    
    // Apply simulation state
    Object.keys(this.mockData).forEach(mode => {
      this.mockData[mode].races.forEach(race => {
        if (this.simulationState === "pre_election") {
          race.status = "pre_election";
          race.reportingPercent = 0;
          race.candidates.forEach(c => {
            c.votes = 0;
            c.percent = 0;
          });
        } else if (this.simulationState === "polls_closed_no_votes") {
          race.status = "polls_closed_no_votes";
          race.reportingPercent = 0;
          race.candidates.forEach(c => {
            c.votes = 0;
            c.percent = 0;
          });
        } else if (this.simulationState === "reporting") {
          race.status = "reporting";
          race.reportingPercent = Math.floor(Math.random() * 50) + 10;
        } else if (this.simulationState === "called") {
          race.status = "called";
          race.reportingPercent = 95 + Math.floor(Math.random() * 5);
          race.candidates[0].isWinner = true;
        }
      });
    });
  }
}

// Election Night Page State
class ElectionNightPage {
  constructor() {
    this.selectedMode = "house";
    this.selectedRaceId = null;
    this.focusedRace = null;
    this.summaryData = null;
    this.raceIndex = [];
    this.raceDetailsCache = new Map();
    this.countyGeometryCache = new Map();
    this.lastUpdated = null;
    this.dataMode = this.detectDataMode();
    this.provider = this.createProvider();
    
    this.init();
  }

  detectDataMode() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("mock") === "true") return "mock";
    if (urlParams.get("simulation") === "true") return "simulation";
    if (urlParams.get("admin") === "true") return "simulation";
    return "pre_election"; // Default to pre-election mode
  }

  createProvider() {
    if (this.dataMode === "mock") {
      return new MockResultsProvider();
    } else if (this.dataMode === "simulation") {
      return new SimulationResultsProvider();
    } else {
      // TODO: Switch to NBCResultsProvider when live data is available
      return new MockResultsProvider();
    }
  }

  init() {
    this.bindEvents();
    this.loadInitialData();
  }

  bindEvents() {
    // Mode toggle buttons
    document.querySelectorAll(".mode-button[data-mode]").forEach(button => {
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
    await this.updateDataStatus();
    await this.loadSummary();
    await this.loadRaceIndex();
  }

  async updateDataStatus() {
    const statusElement = document.getElementById("data-status");
    if (!statusElement) return;

    let statusText = "";
    let statusClass = "";

    switch (this.dataMode) {
      case "mock":
        statusText = "Mock data mode - for testing purposes only";
        statusClass = "mock";
        break;
      case "simulation":
        statusText = "Simulation mode - for admin testing";
        statusClass = "mock";
        break;
      case "pre_election":
        statusText = "Pre-election preview - results will appear after polls close";
        statusClass = "pre-election";
        break;
      default:
        statusText = "Loading data...";
        statusClass = "";
    }

    statusElement.textContent = statusText;
    statusElement.className = `data-status ${statusClass}`;
  }

  async switchMode(mode) {
    if (this.selectedMode === mode) return;

    this.selectedMode = mode;
    this.selectedRaceId = null;
    this.focusedRace = null;
    this.raceIndex = [];
    this.raceDetailsCache.clear();

    // Update mode buttons
    document.querySelectorAll(".mode-button[data-mode]").forEach(button => {
      button.classList.toggle("active", button.dataset.mode === mode);
    });

    // Clear focus panel
    this.clearFocus();

    // Load new data
    await this.loadSummary();
    await this.loadRaceIndex();
  }

  async loadSummary() {
    try {
      this.summaryData = await this.provider.getSummary(this.selectedMode);
      this.renderSummary();
    } catch (error) {
      console.error("Failed to load summary:", error);
      this.renderSummaryError();
    }
  }

  renderSummary() {
    const summaryBar = document.getElementById("top-summary-bar");
    if (!summaryBar || !this.summaryData) return;

    const summary = this.summaryData;
    const modeLabel = this.selectedMode === "governor" ? "Races" : "Seats";

    summaryBar.innerHTML = `
      <div class="summary-item">
        <strong>${summary.totalRaces}</strong>
        <span>Total ${modeLabel.toLowerCase()}</span>
      </div>
      <div class="summary-item">
        <strong>${summary.calledRaces}</strong>
        <span>Called</span>
      </div>
      <div class="summary-item">
        <strong>${summary.leadingRaces}</strong>
        <span>Leading</span>
      </div>
      ${summary.democraticSeats !== undefined ? `
      <div class="summary-item">
        <strong>${summary.democraticSeats}</strong>
        <span>D ${modeLabel}</span>
      </div>
      <div class="summary-item">
        <strong>${summary.republicanSeats}</strong>
        <span>R ${modeLabel}</span>
      </div>
      ` : ""}
      ${summary.netChange ? `
      <div class="summary-item">
        <strong>${summary.netChange.democratic > 0 ? "+" : ""}${summary.netChange.democratic}</strong>
        <span>D Net Change</span>
      </div>
      <div class="summary-item">
        <strong>${summary.netChange.republican > 0 ? "+" : ""}${summary.netChange.republican}</strong>
        <span>R Net Change</span>
      </div>
      ` : ""}
    `;
  }

  renderSummaryError() {
    const summaryBar = document.getElementById("top-summary-bar");
    if (!summaryBar) return;

    summaryBar.innerHTML = `
      <div class="summary-item" style="grid-column: 1 / -1;">
        <strong>Error loading summary</strong>
        <span>Please try again later</span>
      </div>
    `;
  }

  async loadRaceIndex() {
    try {
      this.raceIndex = await this.provider.getRaceIndex(this.selectedMode);
      this.renderRaceList();
    } catch (error) {
      console.error("Failed to load race index:", error);
      this.renderRaceListError();
    }
  }

  renderRaceList() {
    const raceListSection = document.getElementById("race-list-section");
    if (!raceListSection) return;

    if (this.raceIndex.length === 0) {
      raceListSection.innerHTML = `
        <p style="text-align: center; color: #c6d2ff; padding: 100px 0;">
          No races available for ${this.selectedMode}
        </p>
      `;
      return;
    }

    const raceItems = this.raceIndex.map(race => `
      <div class="race-item" data-race-id="${race.id}" style="
        padding: 12px;
        margin-bottom: 8px;
        border: 1px solid #d6d9e2;
        border-radius: 8px;
        background: rgba(7, 20, 59, 0.6);
        cursor: pointer;
        transition: all 0.2s ease;
      ">
        <div style="font-weight: 700; margin-bottom: 4px;">${race.name}</div>
        <div style="font-size: 0.85rem; color: #c6d2ff;">
          Status: ${this.formatStatus(race.status)}
          ${race.reportingPercent !== undefined ? ` • ${race.reportingPercent}% reporting` : ""}
        </div>
      </div>
    `).join("");

    raceListSection.innerHTML = raceItems;

    // Add click handlers
    raceListSection.querySelectorAll(".race-item").forEach(item => {
      item.addEventListener("click", () => {
        const raceId = item.dataset.raceId;
        this.selectRace(raceId);
      });
    });
  }

  renderRaceListError() {
    const raceListSection = document.getElementById("race-list-section");
    if (!raceListSection) return;

    raceListSection.innerHTML = `
      <p style="text-align: center; color: #c6d2ff; padding: 100px 0;">
        Error loading race list
      </p>
    `;
  }

  formatStatus(status) {
    const statusLabels = {
      pre_election: "Pre-election",
      not_started: "Not started",
      polls_closed_no_votes: "Polls closed",
      reporting: "Reporting",
      too_early: "Too early to call",
      too_close: "Too close to call",
      called: "Called",
      recount_likely: "Recount likely",
      runoff: "Runoff"
    };
    return statusLabels[status] || status;
  }

  async selectRace(raceId) {
    this.selectedRaceId = raceId;

    try {
      // Check cache first
      if (this.raceDetailsCache.has(raceId)) {
        this.focusedRace = this.raceDetailsCache.get(raceId);
      } else {
        this.focusedRace = await this.provider.getRaceDetails(raceId);
        this.raceDetailsCache.set(raceId, this.focusedRace);
      }

      this.renderFocusedRace();
    } catch (error) {
      console.error("Failed to load race details:", error);
      this.renderFocusedRaceError();
    }
  }

  renderFocusedRace() {
    const focusedPanel = document.getElementById("focused-race-panel");
    const focusedContent = document.getElementById("focused-race-content");
    
    if (!focusedPanel || !focusedContent || !this.focusedRace) return;

    focusedPanel.classList.add("active");

    const race = this.focusedRace;
    const candidates = race.candidates || [];

    const candidateRows = candidates.map(cand => `
      <div style="
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px;
        margin-bottom: 8px;
        border: 1px solid #d6d9e2;
        border-radius: 8px;
        background: rgba(7, 20, 59, 0.6);
      ">
        <div>
          <div style="font-weight: 700;">
            ${cand.name}
            ${cand.isWinner ? " ✓" : ""}
            ${cand.isIncumbent ? " (Inc.)" : ""}
            ${cand.isPlaceholder ? ` <span style="font-size: 0.8rem; color: #ffadb5;">(${cand.placeholderLabel})</span>` : ""}
          </div>
          <div style="font-size: 0.85rem; color: #c6d2ff;">Party: ${cand.party}</div>
        </div>
        <div style="text-align: right;">
          <div style="font-weight: 700; font-size: 1.2rem;">
            ${cand.percent !== undefined ? cand.percent.toFixed(1) + "%" : "N/A"}
          </div>
          <div style="font-size: 0.85rem; color: #c6d2ff;">
            ${cand.votes !== undefined ? cand.votes.toLocaleString() + " votes" : "No votes"}
          </div>
        </div>
      </div>
    `).join("");

    focusedContent.innerHTML = `
      <div style="margin-bottom: 16px;">
        <h3 style="margin: 0 0 8px;">${race.name}</h3>
        <div style="color: #c6d2ff; font-size: 0.9rem;">
          Status: ${this.formatStatus(race.status)}
          ${race.reportingPercent !== undefined ? ` • ${race.reportingPercent}% reporting` : ""}
        </div>
      </div>
      <div style="margin-bottom: 16px;">
        <h4 style="margin: 0 0 12px;">Candidates</h4>
        ${candidateRows}
      </div>
      <div style="color: #c6d2ff; font-size: 0.85rem;">
        Last updated: ${race.lastUpdated ? new Date(race.lastUpdated).toLocaleString() : "N/A"}
      </div>
    `;
  }

  renderFocusedRaceError() {
    const focusedPanel = document.getElementById("focused-race-panel");
    const focusedContent = document.getElementById("focused-race-content");
    
    if (!focusedPanel || !focusedContent) return;

    focusedPanel.classList.add("active");
    focusedContent.innerHTML = `
      <p style="color: #c6d2ff;">Error loading race details</p>
    `;
  }

  clearFocus() {
    this.selectedRaceId = null;
    this.focusedRace = null;

    const focusedPanel = document.getElementById("focused-race-panel");
    if (focusedPanel) {
      focusedPanel.classList.remove("active");
    }
  }
}

// Initialize the page when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  new ElectionNightPage();
});
