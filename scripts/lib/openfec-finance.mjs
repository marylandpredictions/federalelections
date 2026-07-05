function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeFinanceRecord(record = {}) {
  return {
    candidate: record.candidate || record.name || record.candidateName || null,
    party: record.party || null,
    committeeId: record.committeeId || record.committee_id || record.principalCommitteeId || null,
    receipts: finite(record.receipts ?? record.total_receipts),
    cashOnHand: finite(record.cashOnHand ?? record.cash_on_hand_end_period),
    debts: finite(record.debts ?? record.debts_owed_by_committee),
    individualContributions: finite(record.individualContributions ?? record.individual_contributions),
    filingTimestamp: record.filingTimestamp || record.coverageEndDate || record.coverage_end_date || record.updatedAt || null,
    cycle: record.cycle || 2026
  };
}

export function raceFinanceStatus(records = []) {
  const normalized = records.map(normalizeFinanceRecord).filter((record) => record.candidate || record.committeeId);
  const parties = new Set(normalized.map((record) => String(record.party || "").toUpperCase()[0]).filter((party) => party === "D" || party === "R"));
  const active = normalized.length >= 2 && parties.has("D") && parties.has("R");
  return {
    financeStatus: active ? "ACTIVE_RACE_LEVEL" : normalized.length ? "PARTIAL_RACE_LEVEL_UNUSABLE" : "UNAVAILABLE",
    usedInModel: active,
    records: normalized
  };
}
