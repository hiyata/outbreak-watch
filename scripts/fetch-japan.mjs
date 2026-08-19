// Pulls Japan's weekly infectious disease surveillance data (IDWR —
// Infectious Diseases Weekly Report) from JIHS (Japan Institute for
// Health Security, formerly NIID). Published as direct Shift-JIS CSV
// downloads per week, no API — found by browsing the actual site after
// an initial archived-page dead end.
//
// Two source files per week:
//   - "teiten" (sentinel-site surveillance): common circulating illness
//     (flu, RSV, hand-foot-mouth, etc.), reported as both a raw count and
//     a rate per sentinel site.
//   - "zensu" (mandatory all-case reporting): the full notifiable disease
//     list (measles, rubella, syphilis, TB, dengue, mpox, etc.) — mostly
//     zero in any given week since it includes many rare/severe diseases
//     alongside the common ones.
//
// Both are 47-prefecture-by-disease matrices. Prefecture rows are in
// Japan's standard administrative order (Hokkaido...Okinawa), which is
// matched by position against the vendored map's ISO 3166-2:JP codes
// (JP-01..JP-47) rather than by name — see data/jp-prefectures-topo.json.

import { TEITEN_DISEASES, ZENSU_DISEASES } from "./jp-diseases.mjs";
import { computeTrend } from "./lib/trend.mjs";

const BASE = "https://id-info.jihs.go.jp/surveillance/idwr/provisional";
const HISTORY_WEEKS = 12;
const PREFECTURE_COUNT = 47;

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": "outbreak-watch/0.1 (github.com/outbreak-watch)" } });
  if (!res.ok) return null;
  const buf = await res.arrayBuffer();
  return new TextDecoder("shift_jis").decode(buf);
}

// Minimal CSV parser: handles quoted fields (which this source always
// uses), embedded commas/quotes within them.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c !== ""));
}

async function discoverLatestWeek(year) {
  const res = await fetch(`${BASE}/${year}/index.html`, {
    headers: { "User-Agent": "outbreak-watch/0.1 (github.com/outbreak-watch)" },
  });
  if (!res.ok) return null;
  const html = await res.text();
  const weeks = [...html.matchAll(/href="\.\/(\d{2})\/index\.html"/g)].map((m) => Number(m[1]));
  if (weeks.length === 0) return null;
  return Math.max(...weeks);
}

// Parses one week's file (teiten or zensu shape: row 2 = disease names
// spanning 2 cols each, row 4 = national total, rows 5..51 = prefectures
// 1..47 in order) into { diseaseName: { national: number|null, prefectures: [number|null x47] } }.
function parseWeekFile(rows, diseaseDict) {
  const diseaseRow = rows[2];
  const dataStartRow = 4; // row 4 = national total ("総数"), rows 5.. = prefectures
  const result = new Map();

  for (let col = 1; col < diseaseRow.length; col += 2) {
    const jaName = diseaseRow[col];
    if (!jaName || !diseaseDict[jaName]) continue; // skip the "定当"/"累積" sub-columns and unknown diseases
    const enName = diseaseDict[jaName];

    const parseCell = (cell) => {
      if (cell === undefined || cell === "-" || cell === "") return null;
      const n = Number(cell.replace(/,/g, ""));
      return Number.isFinite(n) ? n : null;
    };

    const national = parseCell(rows[dataStartRow]?.[col]);
    const prefectures = [];
    for (let p = 0; p < PREFECTURE_COUNT; p++) {
      prefectures.push(parseCell(rows[dataStartRow + 1 + p]?.[col]));
    }
    result.set(enName, { national, prefectures });
  }
  return result;
}

async function fetchWeek(year, week) {
  const wk = String(week).padStart(2, "0");
  const [teitenText, zensuText] = await Promise.all([
    fetchText(`${BASE}/${year}/${wk}/${year}-${wk}-teiten.csv`),
    fetchText(`${BASE}/${year}/${wk}/${year}-${wk}-zensu.csv`),
  ]);
  const parsed = new Map();
  if (teitenText) for (const [k, v] of parseWeekFile(parseCsv(teitenText), TEITEN_DISEASES)) parsed.set(k, { ...v, category: "sentinel" });
  if (zensuText) for (const [k, v] of parseWeekFile(parseCsv(zensuText), ZENSU_DISEASES)) parsed.set(k, { ...v, category: "all-case" });
  return parsed;
}

async function main() {
  const year = new Date().getUTCFullYear();
  const latestWeek = await discoverLatestWeek(year);
  if (!latestWeek) throw new Error("Could not discover the latest published week from the JIHS year index page");

  const weeksToFetch = [];
  for (let w = Math.max(1, latestWeek - HISTORY_WEEKS + 1); w <= latestWeek; w++) weeksToFetch.push(w);

  const byWeek = new Map();
  for (const w of weeksToFetch) {
    byWeek.set(w, await fetchWeek(year, w));
  }

  // disease -> { category, prefectureSeries: Map(prefIndex -> [{week,value}]), nationalSeries: [{week,value}] }
  const diseases = new Map();
  for (const w of weeksToFetch) {
    const weekData = byWeek.get(w);
    for (const [disease, entry] of weekData) {
      if (!diseases.has(disease)) {
        diseases.set(disease, {
          category: entry.category,
          nationalSeries: [],
          prefectureSeries: Array.from({ length: PREFECTURE_COUNT }, () => []),
        });
      }
      const d = diseases.get(disease);
      d.nationalSeries.push({ week: w, value: entry.national });
      entry.prefectures.forEach((v, i) => d.prefectureSeries[i].push({ week: w, value: v }));
    }
  }

  const diseaseList = [...diseases.entries()]
    .map(([disease, d]) => {
      const latest = d.nationalSeries[d.nationalSeries.length - 1];
      const prefectures = d.prefectureSeries
        .map((series, i) => {
          const id = String(i + 1).padStart(2, "0");
          const lastPoint = series[series.length - 1];
          return {
            id,
            current_week: lastPoint?.value ?? null,
            series,
          };
        })
        .filter((p) => p.series.some((pt) => pt.value !== null && pt.value > 0));

      return {
        disease,
        category: d.category,
        latest_week: latestWeek,
        latest_total: latest?.value ?? null,
        national_series: d.nationalSeries,
        national_trend: computeTrend(d.nationalSeries),
        prefectures_reporting: prefectures.length,
        prefectures,
      };
    })
    .filter((d) => (d.latest_total ?? 0) > 0)
    .sort((a, b) => (b.latest_total ?? 0) - (a.latest_total ?? 0));

  const feed = {
    generated_at: new Date().toISOString(),
    source: "JIHS (Japan Institute for Health Security) — IDWR weekly report",
    year,
    week: latestWeek,
    history_weeks: weeksToFetch.length,
    disease_count: diseaseList.length,
    diseases: diseaseList,
  };

  const fs = await import("node:fs/promises");
  await fs.writeFile("data/jp-feed.json", JSON.stringify(feed, null, 2) + "\n");
  console.log(`Wrote ${diseaseList.length} diseases (week ${latestWeek}, ${year}, ${weeksToFetch.length}wk history) to data/jp-feed.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
