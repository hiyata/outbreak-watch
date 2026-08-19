// Pulls the last 12 weeks of the CDC NNDSS ("National Notifiable Diseases
// Surveillance System") weekly tables from CDC's open data platform
// (data.cdc.gov, Socrata) and writes a per-disease, per-state breakdown
// (with a 12-week time series per state) to data/cdc-feed.json.
//
// Dataset: https://data.cdc.gov/d/x9gk-5huc ("NNDSS Weekly Data")
// Columns: m1 = current week count, m3 = cumulative YTD current year.
// A row's *_flag is "N" (not notifiable in that jurisdiction) or "U"
// (data unavailable) when the corresponding number isn't a real count —
// those rows are skipped rather than treated as zero, so an unreported
// state never silently reads as "no cases".
//
// The week-range query only looks within the current calendar year, so
// weeks 1-11 of January will have fewer than 12 points of history rather
// than wrapping into the previous MMWR year — a known, minor limitation.

import { lookupState } from "./us-states.mjs";
import { computeTrend } from "./lib/trend.mjs";

const BASE = "https://data.cdc.gov/resource/x9gk-5huc.json";
const HISTORY_WEEKS = 12;

async function socrata(params) {
  const res = await fetch(`${BASE}?${params}`, {
    headers: { "User-Agent": "outbreak-watch/0.1 (github.com/outbreak-watch)" },
  });
  if (!res.ok) throw new Error(`CDC API request failed: ${res.status} ${res.statusText}`);
  return res.json();
}

async function latestYearWeek() {
  const [{ y }] = await socrata("$select=max(year) as y");
  const [{ w }] = await socrata(`$select=max(week) as w&year=${y}`);
  return { year: Number(y), week: Number(w) };
}

function isValidCount(value, flag) {
  if (flag === "N" || flag === "U") return false;
  const n = Number(value);
  return Number.isFinite(n);
}

async function main() {
  const { year, week } = await latestYearWeek();
  const minWeek = Math.max(1, week - (HISTORY_WEEKS - 1));

  const rows = await socrata(
    `year=${year}&$where=week between ${minWeek} and ${week} AND location1 IS NOT NULL&$limit=200000` +
      `&$select=states,label,week,m1,m1_flag,m3,m3_flag`
  );

  // disease -> stateId -> { state, id, series: Map(week -> value), ytd }
  const diseases = new Map();

  for (const row of rows) {
    const state = lookupState(row.states);
    if (!state) continue; // unmapped jurisdiction (e.g. a territory not in the map file)

    if (!diseases.has(row.label)) diseases.set(row.label, new Map());
    const byState = diseases.get(row.label);

    const weekValue = isValidCount(row.m1, row.m1_flag) ? Number(row.m1) : null;
    const ytd = isValidCount(row.m3, row.m3_flag) ? Number(row.m3) : null;
    if (weekValue === null && ytd === null) continue;

    if (!byState.has(state.id)) {
      byState.set(state.id, { id: state.id, name: state.name, series: new Map(), ytd: 0 });
    }
    const entry = byState.get(state.id);
    const wk = Number(row.week);
    entry.series.set(wk, (entry.series.get(wk) ?? 0) + (weekValue ?? 0));
    // Only the latest week's row carries the authoritative YTD figure;
    // summing YTD across weeks would double count, so just take the max.
    if (ytd !== null) entry.ytd = Math.max(entry.ytd, ytd);
  }

  const diseaseList = [...diseases.entries()]
    .map(([disease, byState]) => {
      // Per-state weekly series is only needed transiently to compute the
      // national trend below — the frontend only ever charts the national
      // series, never a per-state one, so it isn't included in the output
      // (it alone made this file several MB for no reason anyone read).
      const states = [...byState.values()]
        .map((s) => {
          const series = [...s.series.entries()].sort((a, b) => a[0] - b[0]);
          const currentWeek = series.length ? series[series.length - 1][1] : 0;
          return { id: s.id, name: s.name, current_week: currentWeek, ytd: s.ytd, weeklyById: s.series };
        })
        .filter((s) => s.current_week > 0 || s.ytd > 0);

      const totalCurrentWeek = states.reduce((sum, s) => sum + s.current_week, 0);
      const totalYtd = states.reduce((sum, s) => sum + s.ytd, 0);
      const nationalSeries = [];
      for (let wk = minWeek; wk <= week; wk++) {
        const total = states.reduce((sum, s) => sum + (s.weeklyById.get(wk) ?? 0), 0);
        nationalSeries.push({ week: wk, value: total });
      }

      return {
        disease,
        total_current_week: totalCurrentWeek,
        total_ytd: totalYtd,
        states_reporting: states.length,
        national_series: nationalSeries,
        national_trend: computeTrend(nationalSeries),
        states: states
          .map(({ id, name, current_week, ytd }) => ({ id, name, current_week, ytd }))
          .sort((a, b) => b.current_week - a.current_week),
      };
    })
    .filter((d) => d.total_ytd > 0) // drop diseases with zero activity all year
    .sort((a, b) => b.total_current_week - a.total_current_week);

  const feed = {
    generated_at: new Date().toISOString(),
    source: "CDC NNDSS",
    year,
    week,
    history_weeks: HISTORY_WEEKS,
    disease_count: diseaseList.length,
    diseases: diseaseList,
  };

  const fs = await import("node:fs/promises");
  await fs.writeFile("data/cdc-feed.json", JSON.stringify(feed, null, 2) + "\n");
  console.log(`Wrote ${diseaseList.length} diseases (MMWR week ${week}, ${year}, ${HISTORY_WEEKS}wk history) to data/cdc-feed.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
