import { createHash } from "node:crypto";

const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 20);
// Optional GitHub backup is public data, never a copy of private control state.
export function publishedCallBackup(payload){return {version:1,description:'Published projections only. Pending decisions, overrides, audit and results history require durable server storage.',races:Object.fromEntries(Object.entries(payload.races||{}).map(([id,state])=>[id,{calls:(state.calls||[]).map(call=>Object.fromEntries(['candidate','status','calledAt','provider','source','providerTimestamp'].filter(k=>call[k]!==undefined).map(k=>[k,call[k]])))}]))};}
// Public summaries only. Private pending providerCall never enters this feed.
export function publicRace(race) {
  const keys = [
    "id",
    "type",
    "state",
    "district",
    "electionName",
    "title",
    "electionDate",
    "electionScope",
    "electionFormat",
    "rosterVerified",
    "rosterReviewed",
    "rosterIncomplete",
    "candidates",
    "calls",
    "status",
    "countyCount",
    "hasBreakdown",
    "expectedVotePercent",
    "estimatedVoteReporting",
    "reportingPercent",
    "percentReporting",
    "lastUpdated",
    "updatedAt",
    "provider",
    "detailVersion",
  ];
  const result = Object.fromEntries(
    keys
      .filter((key) => race[key] !== undefined)
      .map((key) => [key, race[key]]),
  );
  result.candidates = (race.candidates || []).map((candidate) =>
    Object.fromEntries(
      [
        "id",
        "name",
        "party",
        "partyCode",
        "partyLabels",
        "aliases",
        "writeIn",
        "ballotStatus",
        "summaryVisible",
        "votes",
        "percent",
        "incumbent",
        "isWinner",
        "winner",
        "callStatus",
        "callLabel",
      ]
        .filter((key) => candidate[key] !== undefined)
        .map((key) => [key, candidate[key]]),
    ),
  );
  return result;
}
export function publicProvider(provider = {}) {
  return {
    name: provider.name,
    status: provider.status,
    stale: provider.stale,
    lastUpstreamUpdate: provider.lastUpstreamUpdate || null,
  };
}
export class ResultsChangeFeed {
  constructor({ capacity = 120 } = {}) {
    this.capacity = capacity;
    this.snapshots = new Map();
  }
  update(data) {
    // The server replaces immutable cache snapshots. Checking a version must
    // not rehash the national result once for every viewer.
    if (data === this.lastInput) return this.current;
    this.lastInput = data;
    const races = data.groups
      .flatMap((group) => group.races || [])
      .map(publicRace);
    const versions = Object.fromEntries(
      races.map((race) => {
        const { lastUpdated, updatedAt, ...meaningful } = race;
        return [race.id, hash(meaningful)];
      }),
    );
    const provider = publicProvider(data.provider);
    const version = hash([versions, provider]);
    if (version === this.current?.version) return this.current;
    const snapshot = {
      version,
      updatedAt: new Date().toISOString(),
      provider,
      versions,
      races: new Map(
        races.map((race) => [
          race.id,
          this.current?.versions[race.id] === versions[race.id]
            ? this.current.races.get(race.id)
            : { ...race, version: versions[race.id] },
        ]),
      ),
    };
    this.current = snapshot;
    this.snapshots.set(version, snapshot);
    while (this.snapshots.size > this.capacity)
      this.snapshots.delete(this.snapshots.keys().next().value);
    return snapshot;
  }
  metadata() {
    const { version, updatedAt } = this.current;
    return { version, updatedAt };
  }
  full(data) {
    const s = this.current;
    return {
      ...this.metadata(),
      generatedAt: s.updatedAt,
      provider: s.provider,
      refreshSeconds: data.refreshSeconds,
      groups: data.groups.map((group) => ({
        state: group.state,
        stateName: group.stateName,
        races: group.races.map((race) => s.races.get(race.id)),
      })),
    };
  }
  changes(since) {
    const previous = this.snapshots.get(since),
      current = this.current;
    if (!previous) return { ...this.metadata(), reset: true };
    const races = [...current.races.values()].filter(
      (race) => previous.versions[race.id] !== race.version,
    );
    return {
      ...this.metadata(),
      reset: false,
      races,
      removedRaceIds: [...previous.races.keys()].filter(
        (id) => !current.races.has(id),
      ),
      ...(JSON.stringify(previous.provider) !== JSON.stringify(current.provider)
        ? { provider: current.provider }
        : {}),
    };
  }
}
