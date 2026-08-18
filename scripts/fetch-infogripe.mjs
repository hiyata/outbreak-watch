// Pulls Brazil's SRAG (Severe Acute Respiratory Syndrome) surveillance
// data from InfoGripe — a research project run by Fiocruz (PROCC) and FGV
// (EMAp) in partnership with Brazil's Ministry of Health, published as
// plain CSVs on GitHub. This is the cleanest per-state Latin American
// health dataset found (see README for what was tried and ruled out):
// no binary file parsing, no login wall, updated weekly, all 27 states.
//
// https://github.com/infogripe/Boletim_InfoGripe

import { lookupBrState } from "./br-states.mjs";

const RAW_BASE = "https://raw.githubusercontent.com/infogripe/Boletim_InfoGripe/master/Dados/InfoGripe";

const TREND_LABELS = {
  "1,0": "Increasing",
  "0,5": "Possibly increasing",
  "0,0": "Stable",
  "-0,5": "Possibly decreasing",
  "-1,0": "Decreasing",
};

async function fetchCsv(name) {
  const res = await fetch(`${RAW_BASE}/${name}`, {
    headers: { "User-Agent": "outbreak-watch/0.1 (github.com/outbreak-watch)" },
  });
  if (!res.ok) throw new Error(`InfoGripe fetch failed for ${name}: ${res.status} ${res.statusText}`);
  const text = await res.text();
  const [headerLine, ...lines] = text.trim().split("\n");
  const headers = headerLine.split(";");
  return lines.map((line) => {
    const cells = line.split(";");
    const row = {};
    headers.forEach((h, i) => (row[h] = cells[i]));
    return row;
  });
}

// InfoGripe numbers are Brazilian-locale scientific notation, e.g. "3,81000000000000e+02"
function parseBrNumber(value) {
  if (value === undefined || value === "") return null;
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

async function main() {
  const intensityRows = await fetchCsv("estados_intensidade_sem_filtro_febre.csv");
  const seriesRows = await fetchCsv("estados_e_pais_serie_estimativas_tendencia_sem_filtro_febre.csv");

  const casosRows = seriesRows.filter((r) => r["escala"] === "casos" && r["DS_UF_SIGLA"] !== "BR");
  const latestYear = Math.max(...casosRows.map((r) => Number(r["Ano epidemiológico"])));
  const latestWeek = Math.max(
    ...casosRows.filter((r) => Number(r["Ano epidemiológico"]) === latestYear).map((r) => Number(r["Semana epidemiológica"]))
  );

  const seriesByState = new Map();
  for (const r of casosRows) {
    if (Number(r["Ano epidemiológico"]) !== latestYear || Number(r["Semana epidemiológica"]) !== latestWeek) continue;
    const state = lookupBrState(r["CO_UF"]);
    if (!state) continue;
    seriesByState.set(state.id, {
      cases_reported: parseBrNumber(r["Casos semanais reportados até a última atualização"]),
      cases_estimated: parseBrNumber(r["casos estimados"]),
      population: parseBrNumber(r["População"]),
      trend_long: TREND_LABELS[r["tendência de longo prazo"]] ?? null,
      trend_short: TREND_LABELS[r["tendência de curto prazo"]] ?? null,
    });
  }

  const intensityByState = new Map();
  for (const r of intensityRows) {
    const state = lookupBrState(r["CO_UF"]);
    if (!state) continue;
    intensityByState.set(state.id, r["intensidade"]);
  }

  const states = [...new Set([...seriesByState.keys(), ...intensityByState.keys()])]
    .map((id) => {
      const state = lookupBrState(id);
      const series = seriesByState.get(id) ?? {};
      return {
        id,
        abbr: state.abbr,
        name: state.name,
        intensity: intensityByState.get(id) ?? null,
        ...series,
      };
    })
    .sort((a, b) => (b.cases_reported ?? 0) - (a.cases_reported ?? 0));

  const feed = {
    generated_at: new Date().toISOString(),
    source: "InfoGripe (Fiocruz/FGV) — SRAG surveillance",
    disease: "Severe Acute Respiratory Syndrome (SRAG)",
    epidemiological_week: latestWeek,
    epidemiological_year: latestYear,
    states,
  };

  const fs = await import("node:fs/promises");
  await fs.writeFile("data/br-feed.json", JSON.stringify(feed, null, 2) + "\n");
  console.log(`Wrote ${states.length} states (epi week ${latestWeek}, ${latestYear}) to data/br-feed.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
