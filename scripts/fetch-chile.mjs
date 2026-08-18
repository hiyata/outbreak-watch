// Pulls Chile's weekly all-cause mortality by region from Chile's official
// open data portal (datos.gob.cl, Ministry of Health).
//
// IMPORTANT: this is all-cause mortality, not a disease-specific feed like
// the other three modes — Chile's actual notifiable-disease dataset (ENO)
// is roughly a year stale (privacy review lag), but this mortality series
// is genuinely current. It's a real, useful excess-mortality signal, just
// answering a different question ("are more people dying than expected in
// this region") rather than "how many measles cases are there."
//
// The source file pre-fills rows for the entire calendar year in advance
// with MUERTES_OBS=0 as a placeholder for weeks that haven't happened yet.
// Since nationwide weekly deaths are never actually zero, any week whose
// deaths sum to zero across every region/age/sex row is treated as an
// unpopulated placeholder, not a real report, and excluded.

const CSV_URL =
  "https://datos.gob.cl/dataset/1c2811cd-13a4-4406-b20d-cda1544b65d0/resource/90d092cc-bf19-4bcc-bfb0-22b0c5db6707/download/def_semana_epidemiologica.csv";

function slugify(str) {
  return str
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining accents left by NFKD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseCsv(text) {
  const [headerLine, ...lines] = text.trim().split("\n");
  const headers = headerLine.split("|");
  return lines.map((line) => {
    const cells = line.split("|");
    const row = {};
    headers.forEach((h, i) => (row[h] = cells[i]));
    return row;
  });
}

async function main() {
  const res = await fetch(CSV_URL, {
    headers: { "User-Agent": "outbreak-watch/0.1 (github.com/outbreak-watch)" },
  });
  if (!res.ok) throw new Error(`Chile CSV fetch failed: ${res.status} ${res.statusText}`);
  const rows = parseCsv(await res.text());

  const latestYear = rows.reduce((max, r) => Math.max(max, Number(r["ANO_ESTADISTICO"])), 0);

  const weeklyTotals = new Map();
  for (const r of rows) {
    if (Number(r["ANO_ESTADISTICO"]) !== latestYear) continue;
    const week = Number(r["SEMANA_ESTADISTICA"]);
    weeklyTotals.set(week, (weeklyTotals.get(week) ?? 0) + Number(r["MUERTES_OBS"]));
  }
  const realWeeks = [...weeklyTotals.entries()].filter(([, total]) => total > 0).map(([w]) => w);
  const latestWeek = Math.max(...realWeeks);

  // 8-week baseline (excluding the latest week itself) to flag regions
  // running meaningfully above their own recent trend.
  const baselineWeeks = realWeeks.filter((w) => w < latestWeek && w >= latestWeek - 8);

  const byRegion = new Map();
  for (const r of rows) {
    if (Number(r["ANO_ESTADISTICO"]) !== latestYear) continue;
    const week = Number(r["SEMANA_ESTADISTICA"]);
    if (week !== latestWeek && !baselineWeeks.includes(week)) continue;

    const key = slugify(r["REGION"]);
    if (!byRegion.has(key)) {
      byRegion.set(key, { id: key, name: r["REGION"], population: 0, latest_deaths: 0, baseline_deaths: [] });
    }
    const entry = byRegion.get(key);
    const deaths = Number(r["MUERTES_OBS"]);
    const pop = Number(r["POBLACION"]);

    if (week === latestWeek) {
      entry.latest_deaths += deaths;
      entry.population += pop; // population is per age/sex row; sum gives total regional population
    } else {
      entry.baseline_deaths.push(deaths);
    }
  }

  const regions = [...byRegion.values()]
    .map((r) => {
      const baselineTotal = r.baseline_deaths.reduce((a, b) => a + b, 0);
      const baselineAvg = r.baseline_deaths.length ? baselineTotal / (baselineWeeks.length || 1) : null;
      const pctVsBaseline = baselineAvg ? ((r.latest_deaths - baselineAvg) / baselineAvg) * 100 : null;
      return {
        id: r.id,
        name: r.name,
        population: r.population,
        latest_deaths: r.latest_deaths,
        baseline_avg_deaths: baselineAvg,
        pct_vs_baseline: pctVsBaseline,
      };
    })
    .sort((a, b) => (b.pct_vs_baseline ?? -Infinity) - (a.pct_vs_baseline ?? -Infinity));

  const feed = {
    generated_at: new Date().toISOString(),
    source: "Chile DEIS/MINSAL — all-cause mortality (not disease-specific)",
    metric: "Weekly all-cause deaths by region",
    epidemiological_week: latestWeek,
    epidemiological_year: latestYear,
    baseline_week_count: baselineWeeks.length,
    regions,
  };

  const fs = await import("node:fs/promises");
  await fs.writeFile("data/cl-feed.json", JSON.stringify(feed, null, 2) + "\n");
  console.log(`Wrote ${regions.length} regions (epi week ${latestWeek}, ${latestYear}) to data/cl-feed.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
