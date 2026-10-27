import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { NbcProvider } from "./nbc-provider.mjs";
import { createHash } from "node:crypto";
const numberSetting = (value, fallback, min) =>
  Number.isFinite(Number(value)) && Number(value) >= min
    ? Number(value)
    : fallback;
async function json(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw e;
  }
}
async function atomic(path, value) {
  await mkdir(join(path, ".."), { recursive: true });
  const temp = `${path}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + "\n");
  await rename(temp, path);
}
export class ResultsControl {
  constructor({
    root = process.cwd(),
    now = () => Date.now(),
    provider,
    graceSeconds = process.env.NBC_CALL_GRACE_SECONDS,
    pollSeconds = process.env.NBC_POLL_SECONDS,
    staleSeconds = process.env.NBC_STALE_SECONDS,
  } = {}) {
    Object.assign(this, { root, now, provider });
    this.graceSeconds = numberSetting(graceSeconds, 30, 0);
    this.pollSeconds = numberSetting(pollSeconds, 45, 15);
    this.staleSeconds = numberSetting(staleSeconds, 180, 30);
    this.queue = Promise.resolve();
    this.failures = 0;
    this.nextPoll = 0;
  }
  serial(fn) {
    const task = this.queue.then(async () => {
      const calls = structuredClone(this.calls),
        runtime = structuredClone(this.runtime);
      try {
        return await fn();
      } catch (error) {
        this.calls = calls;
        this.runtime = runtime;
        throw error;
      }
    });
    this.queue = task.catch(() => {});
    return task;
  }
  async init() {
    this.catalogue = (
      await json(join(this.root, "data/election-night-races.json"), {
        races: [],
      })
    ).races;
    this.config = await json(join(this.root, "data/results-provider.json"), {
      sources: [],
    });
    this.provider ||= new NbcProvider(this.config);
    this.calls = await json(join(this.root, "data/result-calls.json"), {
      races: {},
    });
    this.calls.races ||= {};
    this.calls.automation ||= { paused: false };
    for (const [id, s] of Object.entries(this.calls.races))
      if (
        this.catalogue.some((r) => r.id === id) &&
        s.calls?.length &&
        !s.callState
      ) {
        s.manualOverride = true;
        s.callState = "MANUAL_FEA_CALL";
      }
    this.runtime = await json(join(this.root, ".runtime/results-state.json"), {
      races: {},
      health: {},
      audit: [],
    });
    this.runtime.audit ||= [];
    this.commitVisibleState();
    return this;
  }
  commitVisibleState() {
    this.visible = {
      calls: structuredClone(this.calls),
      runtime: structuredClone(this.runtime),
    };
  }
  record(race, action, previous, next, candidate = "", actor = "system") {
    this.runtime.audit.push({
      timestamp: new Date(this.now()).toISOString(),
      race,
      candidate,
      action,
      source: actor === "system" || action === "publish-now" ? "NBC" : "FEA",
      actor,
      previousState: previous,
      newState: next,
    });
  }
  state(id) {
    return (this.calls.races[id] ||= { calls: [], callState: "UNCALLED" });
  }
  async save() {
    const callsPath = join(this.root, "data/result-calls.json");
    const previous = await json(callsPath, { races: {} });
    await atomic(callsPath, this.calls);
    try {
      await atomic(
        join(this.root, ".runtime/results-state.json"),
        this.runtime,
      );
    } catch (error) {
      try {
        await atomic(callsPath, previous);
      } catch (rollback) {
        throw new Error(
          `Call persistence failed and rollback failed. Stop automation and inspect disk: ${rollback.message}`,
        );
      }
      throw error;
    }
    this.commitVisibleState();
  }
  async poll() {
    if (this.now() < this.nextPoll) return;
    return this.serial(async () => {
      if (this.now() < this.nextPoll) return;
      const h = this.runtime.health;
      h.lastAttempt = new Date(this.now()).toISOString();
      try {
        const races = await this.provider.fetchResults(this.catalogue);
        if (!Array.isArray(races) || !races.length)
          throw Error("Provider returned no normalized races");
        const seen = new Set();
        for (const r of races) {
          if (
            !this.catalogue.some((c) => c.id === r.id) ||
            seen.has(r.id) ||
            !Array.isArray(r.candidates) ||
            !r.candidates.length ||
            r.candidates.some(
              (c) => !c.name || !Number.isSafeInteger(c.votes) || c.votes < 0,
            )
          )
            throw Error("Invalid normalized provider result");
          if (
            r.providerCall &&
            !r.candidates.some((c) => c.name === r.providerCall.candidate)
          )
            throw Error("Provider call candidate missing");
          seen.add(r.id);
        }
        let changed = false;
        for (const r of races) {
          const prior = this.runtime.races[r.id];
          // Fetch time is deliberately excluded: a successful request is not a new result.
          const signature = createHash("sha256")
            .update(
              JSON.stringify([
                r.candidates,
                r.expectedVotePercent,
                r.reportingPercent,
                r.providerCall,
                r.counties,
              ]),
            )
            .digest("hex");
          if (signature !== prior?._signature) changed = true;
          this.runtime.races[r.id] = { ...r, _signature: signature };
          if (r.providerCall) {
            if (!r.candidates.some((c) => c.name === r.providerCall.candidate))
              throw Error("Provider call candidate missing");
            const s = this.state(r.id);
            const fingerprint = `${r.providerRaceId}:${r.providerCall.candidate}`;
            if (s.manualOverride && s.upstreamFingerprint !== fingerprint) {
              s.providerCall = {
                ...r.providerCall,
                detectedAt: new Date(this.now()).toISOString(),
              };
              s.upstreamFingerprint = fingerprint;
              this.record(
                r.id,
                "detected-during-override",
                s.callState,
                s.callState,
                r.providerCall.candidate,
              );
            }
            if (!s.manualOverride && s.upstreamFingerprint !== fingerprint) {
              const before = s.callState || "UNCALLED";
              // Published calls are sticky. A conflicting upstream correction requires human review.
              const conflict = !!s.calls?.length;
              Object.assign(s, {
                providerCall: {
                  ...r.providerCall,
                  detectedAt: new Date(this.now()).toISOString(),
                },
                upstreamFingerprint: fingerprint,
                attentionReason: conflict
                  ? "NBC changed its projection. Published call retained for review."
                  : "",
                callState: conflict ? "NBC_HELD" : "NBC_PENDING",
                publishAt: new Date(
                  this.now() + this.graceSeconds * 1000,
                ).toISOString(),
              });
              this.record(
                r.id,
                conflict ? "upstream-conflict-held" : "detected",
                before,
                s.callState,
                r.providerCall.candidate,
              );
            }
          } else {
            const s = this.calls.races[r.id];
            if (
              s &&
              ["NBC_PENDING", "NBC_AUTO_ACCEPTED"].includes(s.callState)
            ) {
              const before = s.callState;
              s.callState = "NBC_HELD";
              s.attentionReason =
                "NBC projection no longer present. Existing published call retained; review source.";
              this.record(
                r.id,
                "upstream-projection-absent-held",
                before,
                "NBC_HELD",
              );
            }
          }
        }
        const timestamps = races
          .map((r) => Date.parse(r.lastUpdated || ""))
          .filter(Number.isFinite);
        Object.assign(h, {
          lastSuccess: new Date(this.now()).toISOString(),
          lastUpstreamUpdate: timestamps.length
            ? new Date(Math.max(...timestamps)).toISOString()
            : null,
          error: null,
          connection: "connected",
        });
        if (changed) h.lastChangedResult = new Date(this.now()).toISOString();
        this.failures = 0;
      } catch (e) {
        this.failures++;
        Object.assign(h, {
          connection: e.message.startsWith("No verified NBC")
            ? "unavailable"
            : "failed",
          error: e.message,
        });
      }
      this.nextPoll =
        this.now() +
        Math.min(
          600000,
          this.pollSeconds * 1000 * 2 ** Math.min(this.failures, 4),
        );
      await this.acceptExpired();
      await this.save();
    });
  }
  health({ working = false } = {}) {
    const state = working ? this : this.visible;
    const h = state.runtime.health;
    const stale =
      !h.lastSuccess ||
      this.now() - Date.parse(h.lastSuccess) > this.staleSeconds * 1000 ||
      !h.lastUpstreamUpdate ||
      this.now() - Date.parse(h.lastUpstreamUpdate) > this.staleSeconds * 1000;
    const values = Object.entries(state.calls.races)
      .filter(([id]) => this.catalogue.some((r) => r.id === id))
      .map(([, s]) => s);
    return {
      ...h,
      stale,
      status:
        h.connection === "unavailable"
          ? "UNAVAILABLE"
          : h.connection === "failed"
            ? "CONNECTION FAILED"
            : !h.lastSuccess
              ? "UNAVAILABLE"
              : stale
                ? "DATA STALE"
                : "CONNECTED",
      automation: state.calls.automation.paused
        ? "PAUSED"
        : stale || h.connection !== "connected"
          ? "DEGRADED"
          : "ACTIVE",
      pollSeconds: this.pollSeconds,
      graceSeconds: this.graceSeconds,
      nextAttemptAt: new Date(this.nextPoll).toISOString(),
      sources: this.config.sources.map((s) => ({
        url: s.url,
        status: s.status,
      })),
      pending: values.filter((s) => s.callState === "NBC_PENDING").length,
      overrides: values.filter((s) => s.manualOverride).length,
      counts: Object.fromEntries(
        ["house", "senate", "governor"].map((type) => [
          type,
          Object.values(state.runtime.races).filter((r) => r.type === type)
            .length,
        ]),
      ),
    };
  }
  publish(id, s, source) {
    const before = s.callState;
    s.calls = [
      {
        candidate: s.providerCall.candidate,
        status: "projected",
        calledAt: new Date(this.now()).toISOString(),
        source,
        provider: "NBC",
        providerTimestamp: s.providerCall.providerTimestamp,
      },
    ];
    s.callState = "NBC_AUTO_ACCEPTED";
    s.manualOverride = false;
    this.record(
      id,
      source === "nbc-auto" ? "auto-accepted" : "publish-now",
      before,
      s.callState,
      s.providerCall.candidate,
      source === "nbc-auto" ? "system" : "admin",
    );
  }
  async acceptExpired() {
    if (this.health({ working: true }).automation !== "ACTIVE") return;
    for (const [id, s] of Object.entries(this.calls.races))
      if (
        s.callState === "NBC_PENDING" &&
        this.now() >= Date.parse(s.publishAt)
      )
        this.publish(id, s, "nbc-auto");
  }
  async tick() {
    if (
      this.health().automation !== "ACTIVE" ||
      !Object.values(this.visible.calls.races).some(
        (s) =>
          s.callState === "NBC_PENDING" &&
          this.now() >= Date.parse(s.publishAt),
      )
    )
      return;
    return this.serial(async () => {
      const before = this.runtime.audit.length;
      await this.acceptExpired();
      if (before !== this.runtime.audit.length) await this.save();
    });
  }
  async action({ action, raceId, calls }) {
    return this.serial(async () => {
      if (["pause", "resume", "hold-all", "return-all"].includes(action)) {
        if (action === "pause" || action === "resume")
          this.calls.automation.paused = action === "pause";
        for (const [id, s] of Object.entries(this.calls.races)) {
          if (action === "hold-all" && s.callState === "NBC_PENDING") {
            this.record(
              id,
              action,
              s.callState,
              "NBC_HELD",
              s.providerCall?.candidate,
              "admin",
            );
            s.callState = "NBC_HELD";
          }
          if (
            action === "return-all" &&
            !s.manualOverride &&
            ["NBC_HELD", "NBC_IGNORED"].includes(s.callState)
          ) {
            this.resetAuto(id, s);
          }
        }
        this.record("*", action, "", "", "", "admin");
      } else {
        const race = this.catalogue.find((r) => r.id === raceId);
        if (!race) throw Error("Unknown general-election race");
        const s = this.state(raceId);
        const before = s.callState || "UNCALLED";
        if (action === "manual") {
          const roster =
            this.runtime.races[raceId]?.candidates || race.candidates;
          if (
            !Array.isArray(calls) ||
            calls.length > 1 ||
            calls.some(
              (c) =>
                !roster.some((r) => r.name === c.candidate && !r.placeholder) ||
                !["projected", "winner", "advances", "advanced"].includes(
                  c.status,
                ),
            ) ||
            new Set(calls.map((c) => c.candidate)).size !== calls.length
          )
            throw Error("Choose valid candidates and call types");
          s.calls = calls.map((c) => ({
            candidate: c.candidate,
            status: c.status,
            calledAt: new Date(this.now()).toISOString(),
            source: "fea-manual",
          }));
          s.manualOverride = true;
          s.callState = s.providerCall ? "MANUAL_OVERRIDE" : "MANUAL_FEA_CALL";
        } else if (action === "auto") this.resetAuto(raceId, s);
        else {
          if (!s.providerCall) throw Error("No explicit NBC projection");
          if (s.manualOverride)
            throw Error(
              "Return this race to NBC auto before accepting upstream calls",
            );
          if (action === "publish") {
            if (!["NBC_PENDING", "NBC_HELD"].includes(s.callState))
              throw Error("Call already handled");
            this.publish(raceId, s, "nbc-accepted");
          } else if (action === "hold") s.callState = "NBC_HELD";
          else if (action === "ignore") s.callState = "NBC_IGNORED";
          else throw Error("Unknown action");
        }
        if (action !== "publish")
          this.record(
            raceId,
            action,
            before,
            s.callState,
            s.calls?.[0]?.candidate || s.providerCall?.candidate,
            "admin",
          );
      }
      await this.save();
      return this.adminSnapshot();
    });
  }
  resetAuto(id, s) {
    const before = s.callState;
    s.manualOverride = false;
    // Explicit return-to-auto clears the FEA call and starts a fresh grace window.
    s.calls = [];
    s.providerCall = this.runtime.races[id]?.providerCall
      ? {
          ...this.runtime.races[id].providerCall,
          detectedAt: new Date(this.now()).toISOString(),
        }
      : null;
    s.callState = s.providerCall ? "NBC_PENDING" : "UNCALLED";
    s.upstreamFingerprint = s.providerCall
      ? `${this.runtime.races[id].providerRaceId}:${s.providerCall.candidate}`
      : null;
    s.publishAt = new Date(this.now() + this.graceSeconds * 1000).toISOString();
    this.record(
      id,
      "return-auto",
      before,
      s.callState,
      s.providerCall?.candidate,
      "admin",
    );
  }
  results({ details = false } = {}) {
    const races = this.catalogue.map((base) => {
      const raw = this.visible.runtime.races[base.id] || base;
      const s = this.visible.calls.races[base.id] || {};
      const calls = s.calls || [];
      const { _signature, providerCall, counties, ...safe } = raw;
      return {
        ...safe,
        countyCount: counties?.length || 0,
        hasBreakdown: !!counties?.length,
        ...(details ? { counties: counties || [] } : {}),
        type: base.type,
        electionDate: "2026-11-03",
        electionScope: "General",
        callState: s.callState || "UNCALLED",
        calls,
        status: calls.length ? "called" : "uncalled",
        candidates: (raw.candidates || []).map((c) => {
          const call = calls.find((k) => k.candidate === c.name);
          return {
            ...c,
            isWinner: !!call,
            winner: !!call,
            callStatus: call?.status || "",
            callLabel: call
              ? call.provider === "NBC"
                ? "NBC projects"
                : "FEA projects"
              : "",
          };
        }),
      };
    });
    return {
      generatedAt: new Date(this.now()).toISOString(),
      refreshSeconds: this.pollSeconds,
      provider: {
        name: "NBC News",
        ...this.health(),
        attribution:
          "Vote data via NBC when available. Projections attributed to NBC; manual calls attributed to FEA.",
      },
      groups: ["house", "senate", "governor"].map((type) => ({
        state: type,
        stateName: type,
        races: races.filter((r) => r.type === type),
      })),
    };
  }
  adminSnapshot() {
    return {
      health: this.health(),
      serverTime: new Date(this.now()).toISOString(),
      states: Object.fromEntries(
        Object.entries(this.visible.calls.races).filter(([id]) =>
          this.catalogue.some((r) => r.id === id),
        ),
      ),
      audit: this.visible.runtime.audit.slice(-500).reverse(),
      races: this.results().groups.flatMap((g) => g.races),
    };
  }
}
let instance;
export async function getResultsControl() {
  return (instance ||= new ResultsControl().init());
}
