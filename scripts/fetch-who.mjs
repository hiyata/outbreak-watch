// Pulls WHO Disease Outbreak News from WHO's public OData API and writes
// a normalized feed to data/feed.json for the static site to consume.
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

async function main() {
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await fetchPage(page * PAGE_SIZE);
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break; // last page
  }

  const items = rows.map((row) => {
    const title = row.UseOverrideTitle && row.OverrideTitle ? row.OverrideTitle : row.Title;
    const summarySource = row.Summary || row.Overview || row.Epidemiology || "";
    const disease = row.EmergencyEvent?.[0]?.Title ?? null;

    return {
      id: row.Id,
      source: "WHO",
      title: title ?? "(untitled)",
      url: `https://www.who.int${row.ItemDefaultUrl}`,
      date: row.PublicationDate,
      disease,
      summary: truncate(stripHtml(summarySource)),
    };
  });

  const feed = {
    generated_at: new Date().toISOString(),
    sources: ["WHO"],
    count: items.length,
    items,
  };

  const fs = await import("node:fs/promises");
  await fs.writeFile("data/feed.json", JSON.stringify(feed, null, 2) + "\n");
  console.log(`Wrote ${items.length} items to data/feed.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
