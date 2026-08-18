// Pulls WHO Disease Outbreak News from WHO's public OData API, groups
// individual reports into outbreaks (using WHO's own EmergencyEvent
// grouping, where present), and writes data/feed.json for the static
// site to consume.
//
// API discovered from https://www.who.int/emergencies/disease-outbreak-news
// (network request the page itself makes — no key required).

const PAGE_SIZE = 100; // WHO's API 400s above ~100
const MAX_PAGES = 5; // 500 most recent DONs is plenty for this feed

function whoApiUrl(skip) {
  return (
    "https://www.who.int/api/emergencies/diseaseoutbreaknews" +
    "?sf_provider=dynamicProvider372&sf_culture=en" +
    "&%24orderby=PublicationDateAndTime%20desc" +
    "&%24expand=EmergencyEvent" +
    `&%24top=${PAGE_SIZE}&%24skip=${skip}&%24format=json`
  );
}

function stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(text, max = 320) {
  if (text.length <= max) return text;
  return text.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

async function fetchPage(skip) {
  const res = await fetch(whoApiUrl(skip), {
    headers: { "User-Agent": "outbreak-watch/0.1 (github.com/outbreak-watch)" },
  });
  if (!res.ok) {
    throw new Error(`WHO API request failed: ${res.status} ${res.statusText}`);
  }
  const body = await res.json();
  return body.value ?? [];
}

function normalizeUpdate(row) {
  const title = row.UseOverrideTitle && row.OverrideTitle ? row.OverrideTitle : row.Title;
  const summarySource = row.Summary || row.Overview || row.Epidemiology || "";
  return {
    id: row.Id,
    title: title ?? "(untitled)",
    url: `https://www.who.int${row.ItemDefaultUrl}`,
    date: row.PublicationDate,
    summary: truncate(stripHtml(summarySource)),
  };
}

// WHO tags related reports with a shared EmergencyEvent (a single object,
// not an array — e.g. every DON in the same Ebola outbreak points at the
// same EmergencyEvent.EventId). Reports without one are one-off events;
// each becomes its own single-update "outbreak".
function groupIntoOutbreaks(rows) {
  const groups = new Map();

  for (const row of rows) {
    const event = row.EmergencyEvent;
    const key = event?.EventId ?? `standalone:${row.Id}`;
    const disease = event?.Title ?? (row.UseOverrideTitle && row.OverrideTitle ? row.OverrideTitle : row.Title);

    if (!groups.has(key)) {
      groups.set(key, {
        id: key,
        disease,
        first_seen: event?.EmergencyEventStartDate ?? row.PublicationDate,
        updates: [],
      });
    }
    groups.get(key).updates.push(normalizeUpdate(row));
  }

  const outbreaks = [...groups.values()].map((g) => {
    const updates = g.updates.sort((a, b) => b.date.localeCompare(a.date));
    return {
      id: g.id,
      disease: g.disease,
      first_seen: g.first_seen,
      latest_update: updates[0].date,
      update_count: updates.length,
      updates,
    };
  });

  outbreaks.sort((a, b) => b.latest_update.localeCompare(a.latest_update));
  return outbreaks;
}

async function main() {
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await fetchPage(page * PAGE_SIZE);
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break; // last page
  }

  const outbreaks = groupIntoOutbreaks(rows);

  const feed = {
    generated_at: new Date().toISOString(),
    sources: ["WHO"],
    outbreak_count: outbreaks.length,
    update_count: rows.length,
    outbreaks,
  };

  const fs = await import("node:fs/promises");
  await fs.writeFile("data/feed.json", JSON.stringify(feed, null, 2) + "\n");
  console.log(`Wrote ${outbreaks.length} outbreaks (${rows.length} updates) to data/feed.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
