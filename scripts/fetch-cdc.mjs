// Pulls the latest week of the CDC NNDSS ("National Notifiable Diseases
// Surveillance System") weekly tables from CDC's open data platform
// (data.cdc.gov, Socrata) and writes a per-disease, per-state breakdown to
// data/cdc-feed.json.
//
// Dataset: https://data.cdc.gov/d/x9gk-5huc ("NNDSS Weekly Data")
// Columns: m1 = current week count, m3 = cumulative YTD current year.
// A row's *_flag is "N" (not notifiable in that jurisdiction) or "U"
// (data unavailable) when the corresponding number isn't a real count —
// those rows are skipped rather than treated as zero, so an unreported
// state never silently reads as "no cases".

import { lookupState } from "./us-states.mjs";

const BASE = "https://data.cdc.gov/resource/x9gk-5huc.json";

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

  const rows = await socrata(
    `year=${year}&week=${week}&$where=location1 IS NOT NULL&$limit=10000` +
      `&$select=states,label,m1,m1_flag,m3,m3_flag`
  );

  // disease -> Map(stateId -> { state, id, current_week, ytd })
  const diseases = new Map();

  for (const row of rows) {
    const state = lookupState(row.states);
    if (!state) continue; // unmapped jurisdiction (e.g. a territory not in the map file)

    if (!diseases.has(row.label)) diseases.set(row.label, new Map());
    const byState = diseases.get(row.label);

    const currentWeek = isValidCount(row.m1, row.m1_flag) ? Number(row.m1) : null;
    const ytd = isValidCount(row.m3, row.m3_flag) ? Number(row.m3) : null;
    if (currentWeek === null && ytd === null) continue;

    // "New York City" and "New York" are reported as separate NNDSS
    // jurisdictions that both map to the New York state map region —
    // sum them so the state total isn't missing NYC's cases.
    const existing = byState.get(state.id);
    if (existing) {
      existing.current_week = (existing.current_week ?? 0) + (currentWeek ?? 0);
      existing.ytd = (existing.ytd ?? 0) + (ytd ?? 0);
    } else {
      byState.set(state.id, { id: state.id, name: state.name, current_week: currentWeek ?? 0, ytd: ytd ?? 0 });
    }
  }

  const diseaseList = [...diseases.entries()]
    .map(([disease, byState]) => {
      const states = [...byState.values()].filter((s) => s.current_week > 0 || s.ytd > 0);
      const totalCurrentWeek = states.reduce((sum, s) => sum + s.current_week, 0);
      const totalYtd = states.reduce((sum, s) => sum + s.ytd, 0);
      return {
        disease,
        total_current_week: totalCurrentWeek,
        total_ytd: totalYtd,
        states_reporting: states.length,
        states: states.sort((a, b) => b.current_week - a.current_week),
      };
    })
    .filter((d) => d.total_ytd > 0) // drop diseases with zero activity all year
    .sort((a, b) => b.total_current_week - a.total_current_week);

  const feed = {
    generated_at: new Date().toISOString(),
    source: "CDC NNDSS",
    year,
    week,
    disease_count: diseaseList.length,
    diseases: diseaseList,
  };

  const fs = await import("node:fs/promises");
  await fs.writeFile("data/cdc-feed.json", JSON.stringify(feed, null, 2) + "\n");
  console.log(`Wrote ${diseaseList.length} diseases (MMWR week ${week}, ${year}) to data/cdc-feed.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
