# Outbreak Watch

A global dashboard of ongoing disease outbreaks: a world map highlighting
affected countries, a sidebar ranking outbreaks by recency/updates/cases,
and a detail view with the full chronological update timeline per
outbreak — case counts climbing update to update, not just a flat list of
reports. v1 pulls from **WHO Disease Outbreak News (DON)**.

Live data lives in [`data/feed.json`](data/feed.json), regenerated every 6
hours by a GitHub Actions workflow and served straight off GitHub Pages —
no server, no database.

## How it's different from WHO's own DON page

- **Outbreaks, not reports.** WHO publishes one report per update; this
  groups them (via WHO's own `EmergencyEvent` linkage) into one card per
  outbreak with a timeline, so you can see an outbreak's case count grow
  over months instead of hunting down every individual bulletin.
- **A map.** Countries are extracted from report titles and highlighted by
  how many active outbreaks they have.
- **Case/death counts surfaced up front**, extracted from WHO's report
  text so you don't have to open every PDF to find the numbers.
- **Unread tracking**, so you can tell what's new since your last visit.

## How it works

- [`scripts/fetch-who.mjs`](scripts/fetch-who.mjs) calls WHO's public
  OData API (the same one `who.int/emergencies/disease-outbreak-news`
  itself uses — no key required, discovered from the page's own network
  requests), groups reports into outbreaks, and writes `data/feed.json`.
- [`scripts/countries.mjs`](scripts/countries.mjs) matches country names
  in report titles against the exact id/name pairs in the vendored
  [`data/countries-110m.json`](data/countries-110m.json) map file (so a
  matched country is guaranteed to correspond to a real map region — no
  separate ISO-code table that could drift out of sync). Only matches full
  country names/well-known short forms, never bare ambiguous substrings
  like "Congo" or "Korea" — an unmatched country is left off the map
  rather than risk mislabeling where an outbreak is.
- [`scripts/extract-numbers.mjs`](scripts/extract-numbers.mjs) does
  best-effort regex extraction of case/death counts from WHO's free-text
  report fields, preferring a single sentence that names both figures
  together (so they can't get mismatched from two different fields/dates).
  Returns nothing rather than a low-confidence guess — the frontend never
  fabricates a number.
- [`.github/workflows/update-and-deploy.yml`](.github/workflows/update-and-deploy.yml)
  runs the fetch script on a cron schedule, commits the refreshed feed, and
  deploys the static site to GitHub Pages.
- [`index.html`](index.html) / [`app.js`](app.js) render the dashboard:
  a D3 choropleth map (topology vendored locally, D3/topojson-client
  loaded from CDN), a filterable/sortable outbreak list, and a detail
  panel with the full update timeline per outbreak.

## Running locally

```sh
node scripts/fetch-who.mjs   # regenerates data/feed.json
python3 -m http.server       # or any static file server, then open index.html
```

No dependencies for the fetch script — it uses Node's built-in `fetch`.

## Deploying your own copy

1. Push this repo to GitHub.
2. In **Settings → Pages**, set Source to **GitHub Actions**.
3. The included workflow handles the rest (initial deploy on push, then a
   refresh every 6 hours).

## Scope and honesty about what's *not* here yet

ProMED-mail and CDC's Health Alert Network were original targets too, but:

- **ProMED** requires login for everything now — even its search page
  redirects to an auth wall, with no anonymous access left at all. There's
  no ethical, unattended way to scrape it for a public open-source project
  without storing a personal login as a CI secret. Dropped, not just
  deferred.
- **CDC HAN**'s RSS endpoint is blocked at the edge (bot detection) for
  plain HTTP clients. Left as a `v2` item — may need a different endpoint
  or a browser-like fetch.

Contributions adding another source (ECDC, national health ministries) are
welcome — keep the per-outbreak `{id, disease, first_seen, latest_update,
update_count, countries, is_global, latest_counts, updates}` shape in
`data/feed.json` so the frontend doesn't need to change per source.

## Disclaimer

Country tags and case/death counts are extracted automatically from WHO's
report text and may be incomplete, delayed, or occasionally wrong — this
aggregates and links to official sources, it does not replace them. For
anything clinically or epidemiologically load-bearing, follow the outbound
link and read the original WHO report.
