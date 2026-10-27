(function (root) {
  const finite = (value) =>
    value !== null &&
    value !== undefined &&
    value !== "" &&
    Number.isFinite(Number(value))
      ? Number(value)
      : NaN;
  function watchMetadata(data, catalogue = []) {
    const validIds = new Set(catalogue.map((r) => r.id));
    return new Map(
      Object.entries(data?.races || {})
        .filter(
          ([id, row]) =>
            (!validIds.size || validIds.has(id)) &&
            row &&
            (row.tossup === true || row.watch === true),
        )
        .map(([id, row]) => [
          id,
          { tossup: row.tossup === true, watch: row.watch === true },
        ]),
    );
  }
  const watchLabel = (row) =>
    row?.tossup ? "Toss-up" : row?.watch ? "To watch" : "";
  function margin(row) {
    if (!row) return NaN;
    const d = finite(row.demVotes),
      r = finite(row.repVotes),
      total = finite(row.totalVotes);
    return total > 0 && d >= 0 && r >= 0 && d + r <= total
      ? ((d - r) / total) * 100
      : NaN;
  }
  function districtId(race) {
    const d = String(race?.district ?? "").toUpperCase();
    return `${race?.state}-${["AL", "0"].includes(d) ? "AL" : String(Number(d)).padStart(2, "0")}`;
  }
  function baselineMargin(race, source, datasets = {}) {
    if (
      !race ||
      !source ||
      source.id === "live" ||
      source.status !== "available" ||
      !source.appliesTo?.includes(race.type)
    )
      return NaN;
    if (race.type === "house") {
      const dataset = datasets.district;
      const row = dataset?.districts?.find((r) => r.id === districtId(race));
      // Never substitute a statewide margin, even when a district row is absent.
      if (
        !row ||
        !row.geographyVerified ||
        !race.geometryId ||
        row.geometryId !== race.geometryId ||
        dataset.marginBasis !== "all-votes"
      )
        return NaN;
      return margin(row);
    }
    const dataset = datasets.state;
    if (dataset?.marginBasis !== "all-votes") return NaN;
    const row = dataset.states?.find(
      (r) => r.state === race.state && r.valid !== false,
    );
    return margin(row);
  }
  function shift(current, baseline) {
    const a = finite(current),
      b = finite(baseline);
    return Number.isFinite(a) && Number.isFinite(b) ? a - b : NaN;
  }
  function stateLabel(state) {
    return (
      {
        UNCALLED: "Not called",
        NBC_PENDING: "Waiting to publish",
        NBC_AUTO_ACCEPTED: "Published from NBC",
        MANUAL_FEA_CALL: "FEA call",
        NBC_HELD: "Held for review",
        NBC_IGNORED: "NBC call ignored",
        MANUAL_OVERRIDE: "FEA override",
      }[state] || "Not called"
    );
  }
  function feedLabel(health = {}) {
    return health.status === "CONNECTED" && !health.stale
      ? "Connected"
      : health.status === "UNAVAILABLE"
        ? "Not connected yet"
        : "Results may be delayed";
  }
  function raceLabel(race = {}) {
    const state = race.stateName || race.state || "";
    if (race.type === "house")
      return `${state} ${["AL", "0"].includes(String(race.district)) ? "At-large" : `District ${Number(race.district)}`}`;
    return `${state} ${race.type === "senate" ? "Senate" : "Governor"}`;
  }
  function callPresentation(state = {}) {
    const manual =
      state.manualOverride || state.calls?.[0]?.source === "fea-manual";
    return {
      candidate: manual
        ? state.calls?.[0]?.candidate || "Not called"
        : state.providerCall?.candidate || state.calls?.[0]?.candidate || "",
      label: manual ? "FEA call" : "NBC call",
      nbcCandidate: manual ? state.providerCall?.candidate : null,
    };
  }
  const api = {
    finite,
    watchMetadata,
    watchLabel,
    margin,
    districtId,
    baselineMargin,
    shift,
    stateLabel,
    feedLabel,
    raceLabel,
    callPresentation,
  };
  root.FEAResultsUI = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
