// Builds a static RSS 2.0 feed from WHO's Disease Outbreak News updates
// (data/feed.json) so the dashboard can be followed passively from any
// feed reader instead of requiring a repeat visit. WHO's updates are the
// only source here that are genuine dated articles (title/summary/URL) —
// the other five sources are recurring numeric counts, and re-publishing
// the same "cases this week: 1,234" item every fetch cycle would just
// spam a subscriber's reader, so this feed is WHO-only by design.
//
// Run after fetch-who.mjs (reads its output, data/feed.json) as part of
// the same workflow step.

const SITE_URL = "https://hiyata.github.io/outbreak-watch";
const MAX_ITEMS = 60;

function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toRfc822(iso) {
  return new Date(iso).toUTCString();
}

async function main() {
  const fs = await import("node:fs/promises");
  const feed = JSON.parse(await fs.readFile("data/feed.json", "utf8"));

  // Flatten every outbreak's updates into one dated list, most recent first —
  // an RSS item per WHO report, not per outbreak, since a single outbreak
  // publishes several updates over time and each one is real news.
  const items = feed.outbreaks
    .flatMap((ob) =>
      ob.updates.map((u) => ({
        ...u,
        disease: ob.disease,
        countries: ob.is_global ? "Multi-country / global" : ob.countries.map((c) => c.name).join(", "),
      }))
    )
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_ITEMS);

  const itemsXml = items
    .map((u) => {
      const countLine = u.counts?.cases
        ? ` (${u.counts.cases.toLocaleString()} cases${u.counts.deaths ? `, ${u.counts.deaths.toLocaleString()} deaths` : ""} reported as of this update)`
        : "";
      return `
    <item>
      <title>${escapeXml(u.title)}</title>
      <link>${escapeXml(u.url)}</link>
      <guid isPermaLink="false">${escapeXml(u.id)}</guid>
      <pubDate>${toRfc822(u.date)}</pubDate>
      <category>${escapeXml(u.disease)}</category>
      <description>${escapeXml(`${u.countries} — ${u.summary}${countLine}`)}</description>
    </item>`;
    })
    .join("");

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Outbreak Watch — WHO Disease Outbreak News</title>
    <link>${SITE_URL}/</link>
    <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml" />
    <description>New and updated WHO Disease Outbreak News reports, aggregated by Outbreak Watch. Updated daily.</description>
    <language>en</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <generator>outbreak-watch scripts/build-rss.mjs</generator>${itemsXml}
  </channel>
</rss>
`;

  await fs.writeFile("feed.xml", rss);
  console.log(`Wrote ${items.length} items to feed.xml`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
