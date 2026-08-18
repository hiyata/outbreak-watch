# Outbreak Watch

A global dashboard of ongoing disease outbreaks, with four modes:

- **World (WHO)** — a world map highlighting affected countries, a sidebar
  ranking outbreaks by recency/updates/cases, and a detail view with the
  full chronological update timeline per outbreak — case counts climbing
  update to update, not just a flat list of reports.
- **United States (CDC)** — a US state choropleth built from CDC's NNDSS
  weekly surveillance data: real structured case counts by state and
  disease, not text-mined, updated weekly.
- **Brazil (InfoGripe)** — a Brazilian-state choropleth of SRAG (severe
  acute respiratory illness) risk level and case counts, from Fiocruz/FGV's
  InfoGripe project — real structured per-state data, updated weekly.
- **Chile (DEIS)** — a Chilean-region choropleth of all-cause mortality vs.
  each region's own recent baseline. Not disease-specific (see below for
  why this is the one exception to the "outbreak" framing) — it's the only
  other Latin American national dataset found that was both structured
  and genuinely current, from Chile's Ministry of Health.

Live data lives in [`data/feed.json`](data/feed.json) (WHO),
[`data/cdc-feed.json`](data/cdc-feed.json) (CDC),
[`data/br-feed.json`](data/br-feed.json) (Brazil), and
[`data/cl-feed.json`](data/cl-feed.json) (Chile), regenerated every 6 hours
by a GitHub Actions workflow and served straight off GitHub Pages — no
server, no database.

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
- **Active by default.** WHO's DON archive goes back years, and most of it
  is long-resolved — showing all of it by default made the dashboard read
  as "current" when ~90% of entries hadn't been updated in over a year.
  The default view now only shows outbreaks updated in the last 12
  months, with a "show historical" toggle for the rest. (We tried
  detecting explicit outbreak-closure language instead, but WHO's own text
  can say an outbreak "ended" for one country while it's still active and
  worsening in another — e.g. Uganda's portion of the 2026 Bundibugyo Ebola
  outbreak was declared over while DRC's was still climbing. A recency
  cutoff can't misclassify an active outbreak as resolved the way text
  matching can, so it's the safer default here.)
- **Real structured data for the US**, not text-mined — CDC's NNDSS gives
  actual per-state weekly case counts, not something extracted from prose.

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
- [`scripts/fetch-cdc.mjs`](scripts/fetch-cdc.mjs) pulls the latest
  complete MMWR week from CDC's NNDSS weekly tables
  ([data.cdc.gov](https://data.cdc.gov/d/x9gk-5huc), Socrata open-data
  API), matches jurisdiction names against
  [`data/us-states-10m.json`](data/us-states-10m.json) via
  [`scripts/us-states.mjs`](scripts/us-states.mjs) (same
  guaranteed-real-map-region approach as `countries.mjs`), sums New York
  City into New York state, and skips any state/disease row flagged "not
  notifiable" or "data unavailable" rather than treating it as zero, and
  writes `data/cdc-feed.json`.
- [`scripts/fetch-infogripe.mjs`](scripts/fetch-infogripe.mjs) pulls
  Brazil's SRAG surveillance data from
  [InfoGripe](https://github.com/infogripe/Boletim_InfoGripe) — a
  Fiocruz/FGV research project published as plain CSVs on GitHub, no
  binary parsing or login required, unlike DATASUS's raw `.dbc` files (see
  below) — parses the Brazilian-locale numbers, and matches state codes
  against [`data/br-states-geo.json`](data/br-states-geo.json) (Brazil's
  official IBGE geographic API) via
  [`scripts/br-states.mjs`](scripts/br-states.mjs).
- [`scripts/fetch-chile.mjs`](scripts/fetch-chile.mjs) pulls Chile's
  weekly all-cause mortality CSV from
  [datos.gob.cl](https://datos.gob.cl/dataset/defunciones-por-semana-epidemiologica)
  (Ministry of Health). The source file pre-fills placeholder rows for
  the entire calendar year in advance with zero deaths for weeks that
  haven't happened yet; since nationwide weekly deaths are never really
  zero, any week whose total sums to zero is treated as an unpopulated
  placeholder and excluded, rather than shown as a real (and wildly
  misleading) data point. Region names are matched via a fixed table
  baked directly into the vendored
  [`data/cl-regions-topo.json`](data/cl-regions-topo.json) at build time
  (see the script's comments) since Chile's 16 regions are a small, static
  set not worth a runtime matcher for.
- [`.github/workflows/update-and-deploy.yml`](.github/workflows/update-and-deploy.yml)
  runs all four fetch scripts on a cron schedule, commits the refreshed
  feeds, and deploys the static site to GitHub Pages.
- [`index.html`](index.html) / [`app.js`](app.js) render the dashboard:
  a D3 choropleth map per mode (topologies vendored locally,
  D3/topojson-client loaded from CDN), a filterable/sortable list, and a
  detail panel — full update timeline in WHO mode, per-state case table in
  CDC mode, per-state SRAG detail in Brazil mode, per-region mortality
  detail in Chile mode.

## Running locally

```sh
node scripts/fetch-who.mjs       # regenerates data/feed.json
node scripts/fetch-cdc.mjs       # regenerates data/cdc-feed.json
node scripts/fetch-infogripe.mjs # regenerates data/br-feed.json
node scripts/fetch-chile.mjs     # regenerates data/cl-feed.json
python3 -m http.server           # or any static file server, then open index.html
```

No dependencies for the fetch script — it uses Node's built-in `fetch`.

## Deploying your own copy

1. Push this repo to GitHub.
2. In **Settings → Pages**, set Source to **GitHub Actions**.
3. The included workflow handles the rest (initial deploy on push, then a
   refresh every 6 hours).

## Scope and honesty about what's *not* here yet

- **ProMED** requires login for everything now — even its search page
  redirects to an auth wall, with no anonymous access left at all. There's
  no ethical, unattended way to scrape it for a public open-source project
  without storing a personal login as a CI secret. Dropped, not just
  deferred.
- **CDC HAN**'s RSS endpoint is blocked at the edge (bot detection) for
  plain HTTP clients. Left as a `v2` item — may need a different endpoint
  or a browser-like fetch.
- **A full Latin America layer (all countries, state/province-level) was
  scoped and largely ruled out.** Unlike the US, there's no single regional
  API as clean as CDC's. What was checked, and why each was or wasn't
  added:
  - **PAHO** (WHO's regional office for the Americas) publishes
    country-level dengue data for 46 countries/territories, with
    subnational breakdown for a subset (Mexico, Bolivia, Costa Rica,
    Ecuador, Honduras, Nicaragua, Panama, Venezuela) — but the backend
    behind that subnational data (`www3.paho.org/data/...`) was returning
    502s on every attempt, too unreliable to build an automated pipeline
    on.
  - **Brazil (InfoGripe)** — added (see above). DATASUS/SINAN itself
    distributes state-level data as compressed binary `.dbc` files (no
    REST API, needs Python tooling like
    [PySUS](https://github.com/AlertaDengue/PySUS)), but InfoGripe
    publishes the same underlying surveillance data as plain CSVs.
  - **Chile (DEIS)** — added (see above), but only all-cause mortality is
    current; the actual notifiable-disease dataset (ENO) is roughly a
    year stale (anonymization review lag).
  - **Argentina (SNVS)** — real government open-data portal
    (`datos.salud.gob.ar`), but published as periodic XLSX snapshots, not
    a live API; the most recent respiratory-surveillance file was 5
    months stale, and the newest snapshot is XLSX-only (would need a
    binary-parsing dependency this project doesn't otherwise have). Not
    added.
  - **Colombia (SIVIGILA)** — has an open-data portal, but the current
    national dataset is frozen: last real update October 2024, case data
    only through 2022. Not added.
  - **Mexico, Ecuador** — both publish surveillance only as PDF bulletins
    ("boletines"/"gacetas"), no structured API found. Not added.
  - **Venezuela** — resumed publishing an epidemiological bulletin in
    April 2026 after a 10-year gap; even now it covers only 5 of 30+
    notifiable diseases, national totals only, PDF-only, no state
    breakdown. Not added.
  - **Paraguay** — the open-data site doesn't expose a working API
    (returns an HTML page, not data, at the API endpoint). Not added.
  - **Uruguay** — has a real, working CKAN catalog, but every dataset the
    Ministry of Health has published there was checked and none of them
    is disease surveillance (hospital discharges, vaccination records,
    defibrillator locations, etc.). Not added — there's currently nothing
    to add.

  Contributions covering more countries/regions are welcome, but expect
  each one to need its own investigation — there's no shortcut that covers
  a whole region at once the way the WHO and CDC integrations did for
  their scopes. Check this list first so you don't repeat a dead end.

Contributions adding another source (ECDC, additional national health
ministries) are welcome — keep the per-outbreak `{id, disease, first_seen,
latest_update, update_count, countries, is_global, latest_counts,
updates}` shape in `data/feed.json` so the frontend doesn't need to change
per source.

## Disclaimer

WHO-side country tags and case/death counts are extracted automatically
from report text and may be incomplete, delayed, or occasionally wrong.
CDC-, Brazil-, and Chile-side numbers are structured data straight from
their respective sources, but the most recent week in each is always
provisional and revises as more reports come in — a blank state for a
disease in CDC mode means "not notifiable there or data unavailable," not
"zero cases." Brazil's risk levels ("intensidade") are Fiocruz's own
population-adjusted classification, not raw case counts, and cover SRAG
only, not a general outbreak feed. **Chile mode is all-cause mortality,
not a specific disease** — it answers "are more people dying than usual
in this region," not "what disease is spreading," and its most recent
week is close to always an undercount since deaths take time to register,
so treat the "vs. baseline" figure as provisional rather than a confirmed
trend. Either way, this aggregates and links to official sources; it does
not replace them. For anything clinically or epidemiologically
load-bearing, follow the outbound link and read the original report.
