// Freeze Kalshi race-level Democratic win prices before Election Day.
// Public Trade API candlesticks — not a Kalshi forecast product.
import {writeFileSync, readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const BASE = 'https://api.elections.kalshi.com/trade-api/v2';
const AS_OF = '2026-11-02';
const AS_OF_TS = Math.floor(Date.parse(`${AS_OF}T23:00:00Z`) / 1000);
const START_TS = Math.floor(Date.parse('2026-10-20T00:00:00Z') / 1000);
const clamp = (lo, hi, v) => Math.min(hi, Math.max(lo, v));
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJson(path, {retries = 7} = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(`${BASE}/${path}`, {
        signal: AbortSignal.timeout(45000),
        headers: {accept: 'application/json'},
      });
      if (r.status === 429 || r.status >= 500) {
        await sleep(Math.min(45000, 1000 * 2 ** attempt));
        lastError = Error(`Kalshi HTTP ${r.status} for ${path}`);
        continue;
      }
      if (!r.ok) throw Error(`Kalshi HTTP ${r.status} for ${path}`);
      return r.json();
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      await sleep(Math.min(45000, 1000 * 2 ** attempt));
    }
  }
  throw lastError || Error(`Kalshi request failed for ${path}`);
}

function impliedMarginFromProb(demProb, sigma = 10) {
  const p = clamp(0.02, 0.98, demProb);
  return clamp(-22, 22, Math.log(p / (1 - p)) * (sigma / 1.55));
}

export function marketError(demProb, volume) {
  const edge = Math.min(demProb, 1 - demProb);
  const vol = Number(volume) || 0;
  const base = edge < 0.08 ? 14 : edge < 0.15 ? 12 : 10;
  const volBump = vol < 100 ? 2 : vol < 500 ? 1 : 0;
  return clamp(8, 18, base + volBump);
}

function seriesCandidates(race) {
  if (race.type === 'senate') return [`SENATE${race.state}`, `SENATE${race.state}S`];
  if (race.type === 'governor') return [`GOVPARTY${race.state}`];
  if (race.type === 'house') {
    const d = /^(AL|0)$/i.test(String(race.district)) ? 'AL'
      : String(race.district).padStart(2, '0');
    return [`HOUSE${race.state}${d}`, `KXHOUSERACE-${race.state}${d}`];
  }
  return [];
}

function pickDemMarket(markets = []) {
  return markets.find(m => /-D$/i.test(m.ticker)) ||
    markets.find(m => /democrat/i.test(`${m.yes_sub_title || ''} ${m.title || ''}`)) ||
    null;
}

function demProbFromCandle(candle) {
  const price = Number(candle?.price?.close_dollars ?? candle?.price?.mean_dollars ??
    candle?.yes_bid?.close_dollars);
  if (!Number.isFinite(price) || price < 0 || price > 1) return null;
  return price;
}

async function eventForSeries(series) {
  const j = await getJson(`events?limit=10&with_nested_markets=true&series_ticker=${encodeURIComponent(series)}`);
  return (j.events || []).find(e => e.event_ticker === `${series}-26`) ||
    (j.events || []).find(e => /-26$/.test(e.event_ticker)) ||
    null;
}

async function candleClose(series, ticker) {
  const j = await getJson(
    `series/${encodeURIComponent(series)}/markets/${encodeURIComponent(ticker)}/candlesticks` +
    `?start_ts=${START_TS}&end_ts=${AS_OF_TS}&period_interval=60`,
  );
  const rows = [...(j.candlesticks || [])].sort((a, b) => a.end_period_ts - b.end_period_ts);
  if (!rows.length) return null;
  const last = rows.at(-1);
  const demProb = demProbFromCandle(last);
  if (demProb == null) return null;
  return {
    demProb,
    volume: rows.reduce((n, c) => n + Number(c.volume_fp || 0), 0),
    openInterest: Number(last.open_interest_fp || 0),
    endPeriodTs: last.end_period_ts,
    closeDollars: last.price?.close_dollars,
  };
}

export async function fetchKalshiRaceMarkets(catalogue, {pauseMs = 150} = {}) {
  const races = {};
  const issues = [];
  let checked = 0;
  for (const race of catalogue) {
    if (!['house', 'senate', 'governor'].includes(race.type)) continue;
    checked++;
    let found = null;
    for (const series of seriesCandidates(race)) {
      try {
        const event = await eventForSeries(series);
        await sleep(pauseMs);
        if (!event) continue;
        const dem = pickDemMarket(event.markets || []);
        if (!dem?.ticker) continue;
        const seriesTicker = event.event_ticker.replace(/-26$/, '');
        let candle = await candleClose(seriesTicker, dem.ticker);
        await sleep(pauseMs);
        if (!candle && dem.ticker.startsWith('KXHOUSERACE-')) {
          const altSeries = seriesTicker.replace(/^KXHOUSERACE-/, 'HOUSE');
          const altTicker = dem.ticker.replace(/^KXHOUSERACE-/, 'HOUSE');
          candle = await candleClose(altSeries, altTicker);
          await sleep(pauseMs);
        }
        if (!candle) continue;
        if ((candle.demProb <= 0.03 || candle.demProb >= 0.97) && candle.volume < 50) continue;
        found = {
          series: seriesTicker,
          event: event.event_ticker,
          demTicker: dem.ticker,
          ...candle,
        };
        break;
      } catch (error) {
        issues.push({id: race.id, series, reason: error.message});
      }
    }
    if (!found) continue;
    const error = marketError(found.demProb, found.volume);
    races[race.id] = {
      raceId: race.id,
      demProb: Number(found.demProb.toFixed(4)),
      projectedMargin: Number(impliedMarginFromProb(found.demProb, error).toFixed(3)),
      error: Number(error.toFixed(3)),
      volume: Number(found.volume.toFixed(2)),
      openInterest: found.openInterest,
      eventTicker: found.event,
      demTicker: found.demTicker,
      series: found.series,
      candleEndTs: found.endPeriodTs,
      closeDollars: found.closeDollars,
    };
    if (checked % 20 === 0 || Object.keys(races).length % 10 === 0) {
      console.error(`kalshi-markets: ${Object.keys(races).length} frozen / ${checked} checked`);
      writeFileSync('data/results/kalshi-race-markets-2026-11-02.partial.json', JSON.stringify({
        asOf: AS_OF, races, checked, at: new Date().toISOString(),
      }));
    }
  }
  return {
    asOf: AS_OF,
    source: 'Kalshi public Trade API',
    sourceUrl: 'https://docs.kalshi.com/getting_started/quick_start_market_data',
    method: 'Democratic-contract hourly candlestick close at/before 2026-11-02T23:00Z; logit map to D−R margin. Not a Kalshi forecast product.',
    availableAt: `${AS_OF}T23:59:59.000Z`,
    counts: {checked, races: Object.keys(races).length, issues: issues.length},
    races,
    issues: issues.slice(0, 80),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const catalogue = JSON.parse(readFileSync('data/election-night-races.json', 'utf8')).races;
  const out = await fetchKalshiRaceMarkets(catalogue);
  const path = 'data/results/kalshi-race-markets-2026-11-02.json';
  writeFileSync(path, JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify({
    path,
    ...out.counts,
    ak: out.races['senate-AK'],
    oh: out.races['senate-OH'],
    sha256: createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16),
  }, null, 2));
}
