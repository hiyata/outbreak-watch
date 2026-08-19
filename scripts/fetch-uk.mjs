// Pulls England regional surveillance data from the UKHSA data dashboard API
// (api.ukhsa-dashboard.data.gov.uk) — a real, documented REST/JSON API,
// discovered via its own docs rather than network-sniffing like WHO/ECDC.
//
// The data model is a deep hierarchy: theme -> sub_theme -> topic ->
// geography_type -> geography -> metric -> paginated time series. Each
// topic can have several metrics (e.g. Influenza has hospital admission
// rate, ICU/HDU admission rate, and test positivity), and — importantly —
// metrics go stale independently of each other: some are actively
// maintained, others were discontinued years ago but still return data.
// There's no bulk "give me everything current" endpoint, so this script:
//   1. For each curated topic, checks it has "UKHSA Region" granularity.
//   2. Discovers that topic's available metrics from one region.
//   3. Picks whichever metric has the most recent data point — a stale
//      metric several years old is never preferred over a fresher one,
//      mirroring the same "don't show old data as current" principle
//      used elsewhere in this project.
//   4. Drops the topic entirely if even its freshest metric is older than
//      RECENCY_WINDOW_DAYS, rather than surface a years-old number as if
//      it were current.
//   5. Only then fetches that one metric across all 9 regions.

const API_BASE = "https://api.ukhsa-dashboard.data.gov.uk";
const RECENCY_WINDOW_DAYS = 90;

// Curated from the API's own topic listing (themes/infectious_disease/sub_themes/*/topics).
const TOPICS = [
  { subTheme: "respiratory", topic: "COVID-19" },
  { subTheme: "respiratory", topic: "Influenza" },
  { subTheme: "respiratory", topic: "RSV" },
  { subTheme: "respiratory", topic: "Adenovirus" },
  { subTheme: "respiratory", topic: "Rhinovirus" },
  { subTheme: "respiratory", topic: "hMPV" },
  { subTheme: "respiratory", topic: "Parainfluenza" },
  { subTheme: "vaccine_preventable", topic: "Measles" },
  { subTheme: "gastrointestinal", topic: "C-difficile" },
  { subTheme: "invasive_bacterial_infections", topic: "iGAS" },
  { subTheme: "vector_borne", topic: "lyme" },
  { subTheme: "childhood_illness", topic: "Scarlet-fever" },
  { subTheme: "bloodborne", topic: "Hepatitis-B" },
  { subTheme: "bloodborne", topic: "Hepatitis-C" },
  { subTheme: "bloodborne", topic: "HIV" },
  { subTheme: "contact", topic: "mpox-clade-1b" },
  { subTheme: "contact", topic: "mpox-clade-2b" },
];

function slugify(str) {
  return str
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

async function getJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": "outbreak-watch/0.1 (github.com/outbreak-watch)" } });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`UKHSA API request failed (${res.status}): ${url}`);
  }
  return res.json();
}

async function getAllPages(url) {
  const results = [];
  let next = `${url}${url.includes("?") ? "&" : "?"}page_size=300`;
  while (next) {
    const body = await getJson(next);
    if (!body) break;
    results.push(...body.results);
    next = body.next;
  }
  return results;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchTopicData(subTheme, topic) {
  const topicBase = `${API_BASE}/themes/infectious_disease/sub_themes/${subTheme}/topics/${topic}`;

  const geoTypes = await getJson(`${topicBase}/geography_types`);
  if (!geoTypes) return null;
  const hasRegion = geoTypes.some((g) => g.name === "UKHSA Region");
  if (!hasRegion) return null;

  const regionBase = `${topicBase}/geography_types/UKHSA%20Region`;
  const geographies = await getJson(`${regionBase}/geographies`);
  if (!geographies || geographies.length === 0) return null;

  // Discover metrics from the first region, then pick the freshest one.
  const firstRegionName = encodeURIComponent(geographies[0].name);
  const metrics = await getJson(`${regionBase}/geographies/${firstRegionName}/metrics`);
  if (!metrics || metrics.length === 0) return null;

  let bestMetric = null;
  let bestLatestDate = null;
  for (const m of metrics) {
    await sleep(100);
    const rows = await getAllPages(`${regionBase}/geographies/${firstRegionName}/metrics/${m.name}`);
    if (rows.length === 0) continue;
    const latest = rows.reduce((max, r) => (r.date > max ? r.date : max), "");
    if (!bestLatestDate || latest > bestLatestDate) {
      bestLatestDate = latest;
      bestMetric = m.name;
    }
  }
  if (!bestMetric) return null;

  const cutoff = new Date(Date.now() - RECENCY_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (bestLatestDate < cutoff) return null; // freshest available metric is still too stale — drop the topic

  const regions = [];
  for (const g of geographies) {
    await sleep(100);
    const rows = await getAllPages(`${regionBase}/geographies/${encodeURIComponent(g.name)}/metrics/${bestMetric}`);
    if (rows.length === 0) continue;
    rows.sort((a, b) => b.date.localeCompare(a.date));
    const latest = rows[0];
    const monthAgo = rows.find((r) => r.date <= addDays(latest.date, -28));
    regions.push({
      id: slugify(g.name),
      name: g.name,
      latest_value: latest.metric_value,
      latest_date: latest.date,
      value_4_weeks_ago: monthAgo ? monthAgo.metric_value : null,
    });
  }
  if (regions.length === 0) return null;

  return { topic, metric: bestMetric, latest_date: bestLatestDate, regions };
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const diseases = [];
  for (const { subTheme, topic } of TOPICS) {
    try {
      const result = await fetchTopicData(subTheme, topic);
      if (result) {
        diseases.push(result);
        console.log(`  ✓ ${topic}: ${result.metric} (latest ${result.latest_date}, ${result.regions.length} regions)`);
      } else {
        console.log(`  ✗ ${topic}: no current regional data, skipped`);
      }
    } catch (err) {
      console.log(`  ✗ ${topic}: ${err.message}`);
    }
    await sleep(150);
  }

  const feed = {
    generated_at: new Date().toISOString(),
    source: "UKHSA data dashboard (England regions)",
    recency_window_days: RECENCY_WINDOW_DAYS,
    disease_count: diseases.length,
    diseases,
  };

  const fs = await import("node:fs/promises");
  await fs.writeFile("data/uk-feed.json", JSON.stringify(feed, null, 2) + "\n");
  console.log(`Wrote ${diseases.length} topics to data/uk-feed.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
