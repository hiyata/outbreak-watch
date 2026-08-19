# Outbreak Watch

A global dashboard of ongoing disease outbreaks, with six modes:

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
- **England (UKHSA)** — an England-region choropleth across whichever
  notifiable diseases currently have live data (COVID-19, flu, RSV, other
  respiratory viruses, measles, C-difficile, scarlet fever — see below),
  from the UK Health Security Agency's public data API. England only —
  Scotland, Wales, and Northern Ireland have separate health agencies not
  covered here.
- **Japan (JIHS)** — a 47-prefecture choropleth across ~50 currently-active
  notifiable diseases (influenza, RSV, hand-foot-mouth disease, measles,
  rubella, syphilis, TB, dengue, mpox, and more), from the Japan Institute
  for Health Security's weekly IDWR report. Mixes two reporting styles —
  common illnesses are sentinel-site counts (a sample, not a national
  total), rarer/severe diseases are comprehensive mandatory-reporting
  counts — each disease is tagged with which kind it is.

All six modes are cross-linked and searchable together:

- **Trend charts.** Every disease/region/outbreak detail view shows its
  recent history (12 weeks for CDC/Brazil/Chile/England/Japan, the full
  update history for WHO outbreaks) instead of just a single latest number
  — CDC, Brazil, and Chile's fetch scripts pull data they were already
  discarding, UK's already-fetched pages just keep more of what they
  return, and Japan's per-week files are fetched 12 times over. Charts are
  full D3 line charts with y-axis gridlines, x-axis date labels (tick
  count scales down with chart width so mobile doesn't collide), gap
  segments for missing weeks, an end-value label, and a crosshair+tooltip
  on hover — they also re-render on window resize, since sizing off
  `container.clientWidth` once at render time otherwise left a
  desktop-width chart overflowing after rotating to mobile.
- **Growth rate & trend classification.** Every entity (a WHO outbreak,
  a CDC disease's national total, a Brazilian/Chilean/English
  region, a Japanese disease) gets a computed trend: the literal
  latest-vs-previous-period change (absolute + %), and a
  rising/falling/stable classification fit by linear regression over
  the trailing few periods rather than a two-point comparison, so one
  noisy week doesn't flip the label. WHO's case counts are cumulative,
  so its trend is computed on the first-differenced (incident) series,
  not the ever-increasing total. The two numbers are deliberately
  labeled with different timeframes ("recent trajectory" vs. "vs
  previous report") — a big prior spike can leave the window
  classified "rising" even the week after a real decline, which is
  correct (the outbreak is still elevated), not a bug, but reads as
  contradictory if the two aren't visually separated. This is a
  descriptive read of each series, not an epidemiological model — no
  Rt, no serial interval, no forecast. Brazil's InfoGripe feed already
  ships its own official trend classification (`trend_short`); it's
  shown alongside ours rather than replaced, so the two can be
  compared directly. Shared logic lives in
  [`scripts/lib/trend.mjs`](scripts/lib/trend.mjs).
- **Cross-source linking.** A WHO outbreak's detail view shows links to
  matching local data in CDC/Brazil/Chile/England/Japan when the
  outbreak's country and disease overlap with what that source tracks
  (e.g. a US avian influenza DON links to CDC's influenza surveillance);
  local-mode detail views link back to WHO the same way. Matching is a
  best-effort keyword overlap on free-text disease names — there's no
  shared disease taxonomy across six independent sources in five
  languages — so it's deliberately conservative: a missed link is
  preferred over a wrong one.
- **Unified search.** The search box in the header queries all six feeds
  at once — disease names, countries, US states, Brazilian/Chilean/English
  regions, Japanese prefectures — grouped by source, click a result to
  jump straight to it.

Live data lives in [`data/feed.json`](data/feed.json) (WHO),
[`data/cdc-feed.json`](data/cdc-feed.json) (CDC),
[`data/br-feed.json`](data/br-feed.json) (Brazil),
[`data/cl-feed.json`](data/cl-feed.json) (Chile),
[`data/uk-feed.json`](data/uk-feed.json) (England), and
[`data/jp-feed.json`](data/jp-feed.json) (Japan), regenerated every 6
hours by a GitHub Actions workflow and served straight off GitHub Pages —
no server, no database.

## Reach: mobile, accessibility, shareability

The dashboard had never actually been opened on a phone before this pass —
a nested flexbox/grid `min-width: auto` bug (each level of a flex/grid
container defaults to not shrinking below its content's natural size
unless told to) meant the mode-tab pills forced the entire page 320px
wider than the viewport on mobile, and on top of that the sidebar list
had no height cap on narrow screens, so tapping into a disease's detail
meant scrolling past all 91 CDC diseases first — a single "quick check"
page came out over 25,000px tall. Both fixed: `min-width: 0` added at
every level of the nesting chain, and the sidebar keeps a bounded,
independently-scrollable height on mobile instead of expanding to fit
all its content.

Also fixed a real WCAG failure found by calculating actual contrast
ratios rather than eyeballing it: the active-tab text color was a
hardcoded dark brown that only had 3.44:1 contrast against the light
theme's accent orange (WCAG AA requires 4.5:1 for normal-size text) —
introduced an `--accent-contrast` token that resolves differently per
theme instead of one hardcoded value for both.

Added: a keyboard skip-link (jumps past the header straight to the
data), `aria-label`s on every search/sort control (placeholder text
alone isn't a reliable accessible name — it disappears the moment you
start typing), and Open Graph/Twitter Card meta tags plus a proper
favicon so links shared in Slack/Twitter/iMessage render a real title
and description instead of a bare URL.

## Performance and reliability

**Performance:** `data/cdc-feed.json` was 2.5MB — the single largest
asset on the site, real friction on a mobile connection — because
[`fetch-cdc.mjs`](scripts/fetch-cdc.mjs) was writing a 12-week time
series *per state per disease* into the output even though the
frontend only ever charts the national total, never a per-state one.
Stopped writing the unused per-state series (still computed
internally, just not serialized) and cut the file to ~375KB, a 6.7x
reduction, with zero change in what's actually displayed.

**Reliability:** found a real bug by reading the GitHub Actions
workflow closely rather than assuming it was fine — each of the six
`fetch-*.mjs` steps ran sequentially with no `continue-on-error`, so
if *any one* source's site changed format and its script threw, that
step would halt the entire job. The commit step would never run, and
since the `deploy` job requires `update-feed` to succeed, **the whole
site would stop redeploying** — not just that one source going stale,
every source frozen at its last all-six-succeeded run, silently,
until someone noticed. Fixed with `continue-on-error: true` on each
fetch step so they're independent, plus a `data/status.json` written
every run (`if: always()`) recording which sources' most recent fetch
attempt actually succeeded. The frontend reads it and shows a visible
"⚠ update failed, showing last good data" badge on any mode whose
source is currently failing — the dashboard now tells you when it
doesn't trust its own data, instead of looking identically fine either
way.

## SEO

Added `robots.txt`, `sitemap.xml`, and a `schema.org/Dataset`
[JSON-LD block](index.html) listing all six underlying `data/*.json`
files as `DataDownload` distributions — the schema Google Dataset
Search specifically indexes, so this has a real shot at being found as
an actual data source, not just a page. Deliberately left `license`
out of that block rather than guess: this aggregates six government/
international sources with licensing terms that weren't individually
verified, and asserting a specific license without checking each one
would be a real (if easy to make) mistake for something search engines
and downstream tools might take at face value.

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
- [`scripts/fetch-uk.mjs`](scripts/fetch-uk.mjs) pulls England regional
  data from the [UKHSA data dashboard API](https://ukhsa-dashboard.data.gov.uk/access-our-data)
  — a real documented REST/JSON API, found via its own developer docs
  rather than network-sniffing (unlike WHO/ECDC). Its data model is a
  deep hierarchy (theme → sub-theme → topic → geography → metric), and
  metrics go stale independently of each other — one Influenza metric
  turned out to be 2 years stale while another for the same disease was
  current to the week — so for each curated disease the script discovers
  all its available metrics, picks whichever has the most recent data
  point, and drops the disease entirely if even its freshest metric is
  older than 90 days, rather than surface a years-old number as current.
  This is why the disease list changes run to run: 10 of the 17 curated
  diseases had current data as of this build, the rest (Hepatitis B/C,
  HIV, mpox, iGAS, Lyme) didn't and were left out.
- [`scripts/fetch-japan.mjs`](scripts/fetch-japan.mjs) pulls Japan's
  weekly IDWR report from
  [JIHS](https://id-info.jihs.go.jp/surveillance/idwr/) (Japan Institute
  for Health Security, formerly NIID) — direct Shift-JIS-encoded CSV
  downloads per week, no API, found by browsing the live site after an
  initial dead-end on an archived page. Decoded with Node's built-in
  `TextDecoder("shift_jis")` and a small hand-written CSV parser (the
  files are fully quoted, and Node has no built-in CSV support). Combines
  two source files per week — "teiten" (sentinel-site counts for common
  illnesses like flu and hand-foot-mouth disease — a sample, not a
  national total) and "zensu" (comprehensive mandatory reporting for the
  full notifiable disease list, measles/rubella/syphilis/TB/dengue/mpox
  among them) — and translates disease names via a hand-built
  [Japanese→English table](scripts/jp-diseases.mjs). Prefecture rows in
  the source are in Japan's fixed administrative order, matched by
  position against the vendored map's ISO 3166-2:JP codes rather than by
  name.
- [`.github/workflows/update-and-deploy.yml`](.github/workflows/update-and-deploy.yml)
  runs all six fetch scripts on a cron schedule, commits the refreshed
  feeds, and deploys the static site to GitHub Pages.
- [`index.html`](index.html) / [`app.js`](app.js) render the dashboard:
  a D3 choropleth map per mode (topologies vendored locally,
  D3/topojson-client loaded from CDN), a filterable/sortable list, and a
  detail panel — full update timeline in WHO mode, per-state case table in
  CDC mode, per-state SRAG detail in Brazil mode, per-region mortality
  detail in Chile mode, per-region indicator table in England mode,
  per-prefecture case table in Japan mode.

## Running locally

```sh
node scripts/fetch-who.mjs       # regenerates data/feed.json
node scripts/fetch-cdc.mjs       # regenerates data/cdc-feed.json
node scripts/fetch-infogripe.mjs # regenerates data/br-feed.json
node scripts/fetch-chile.mjs     # regenerates data/cl-feed.json
node scripts/fetch-uk.mjs        # regenerates data/uk-feed.json
node scripts/fetch-japan.mjs     # regenerates data/jp-feed.json
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
- **ECDC** (Europe's CDC equivalent) has a real, current, weekly REST API
  behind its Surveillance Atlas (`atlas.ecdc.europa.eu/public/AtlasService/rest/`
  — found datasets like `CURRENT.WNF.WEEKLY`), discovered the same way
  WHO's API was: by watching the page's own network requests. But the
  atlas is sitting behind Imperva Incapsula, a bot-detection WAF — driving
  its cascading dataset/geography/time dropdowns with a headless browser
  triggered Incapsula's challenge resources instead of real responses.
  Same failure category as ProMED and CDC HAN: even a working scrape today
  would be liable to silently break (or start returning stale/challenge
  content instead of erroring) on a future scheduled run against a WAF
  that's actively trying to detect exactly this kind of automation.
  Dropped for the same reason those were.
- **China, Japan, Korea, Australia** were checked for a CDC/InfoGripe-tier
  source (structured, current, sub-national):
  - **Japan (JIHS)** — added (see above). The institute renamed and moved
    domains since its old NIID pages, which is why an earlier pass found
    only a dead archived page; the live site
    (`id-info.jihs.go.jp/surveillance/idwr/`) publishes direct per-week
    CSV downloads, no API needed.
  - **China** — no public structured API; the CDC site is a content
    redirect into article/PDF-style publications, similar transparency
    tier to Venezuela.
  - **Korea** — KDCA's data is exposed through a real government API
    framework (`data.go.kr`), but every endpoint requires a **registered
    service key** — a manual account-signup step that can't be completed
    autonomously. Revisit if someone provides a key.
  - **Australia** — the old `data.gov.au` NNDSS dataset is a dead stub
    from 2015; the real current data has moved to Australia's new CDC
    site (`cdc.gov.au`). Retried: even a full headless Chromium browser
    gets an `ERR_HTTP2_PROTOCOL_ERROR` from every page on that domain —
    an active protocol-level rejection (almost certainly Akamai bot
    management flagging datacenter/cloud IP ranges), not a network
    hiccup. Since GitHub Actions runners are exactly that kind of IP
    range, this would very likely also fail in production even if a
    workaround were found locally. Moved from "inconclusive" to
    effectively ruled out.
  - **Taiwan** — has a real, well-documented Open Data Portal
    (`data.cdc.gov.tw`) with an API; retried and still a hard TCP-level
    timeout from the development environment on every attempt, unchanged
    from the first pass. Genuinely inconclusive — this looks like a
    network path issue rather than an active block, but there's no way
    to test further from here. Worth a retry from a different network.
  - **Germany (RKI)** — upgraded from "not attempted, SOAP looked like
    too much friction" to **confirmed working**: SurvStat is a SOAP/OLAP
    web service, not REST/JSON, but its exact request format was
    recovered from an open-source R package
    ([rsurvstat](https://github.com/bristol-vaccine-centre/rsurvstat))
    that had already reverse-engineered it — turned out to be plain XML
    over HTTP POST once the format was known, no SOAP library needed. A
    test query returned real, current (this week) COVID-19 case counts
    for all 16 German states. Not yet built into the dashboard as a
    seventh mode — the query format is proven but the full fetch
    script/frontend integration hasn't been written.
- **UK (UKHSA)** — added (see above). A second, broader pass also checked
  Canada, Germany, Singapore, Taiwan, the Netherlands, South Africa, and
  India:
  - **Canada** — PHAC's Notifiable Diseases Online exists, but the
    underlying CNDSS is historically annual-cadence, not weekly; didn't
    pursue further given UK's build already covers the "real API,
    current" bar for this round.
  - **Germany (RKI)** — SurvStat has a real web service, but it's
    SOAP/WSDL, not REST/JSON — meaningfully more integration friction
    than every other source in this project. Not attempted this round.
  - **Singapore** — `data.gov.sg`'s API returned a Cloudflare bot-challenge
    page on a plain request. Same category as ProMED/ECDC — not pursued.
  - **Taiwan** — has a real, well-documented Open Data Portal
    (`data.cdc.gov.tw`) with an API, but the domain was unreachable from
    the development environment on every attempt (like Australia) —
    inconclusive, not ruled out, worth retrying.
  - **Netherlands (RIVM)** — open data found was COVID-specific; didn't
    confirm a broader current notifiable-disease API in the time spent.
    Worth another look.
  - **South Africa (NICD)** — notification is via a mobile/paper form
    system; no public API found.
  - **India (IDSP)** — `data.gov.in` hosts IDSP outbreak datasets, but
    what was found looked like periodic historical dumps, not a live
    weekly feed; not confirmed either way.
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

Contributions adding another source are welcome — keep the per-outbreak
`{id, disease, first_seen, latest_update, update_count, countries,
is_global, latest_counts, updates}` shape in `data/feed.json` so the
frontend doesn't need to change per source.

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
trend. **England mode's unit varies by disease** — UKHSA tracks different
diseases with different indicators (test positivity %, case counts,
syndromic rates), so a "134" for one disease and a "2" for another are not
directly comparable; each list item and detail view states its unit.
England mode also only ever shows diseases with data from the last 90
days, so the list of diseases present changes over time as some go stale
and drop out. **Japan mode mixes two different reporting styles** —
sentinel-site counts (a sample from a fixed clinic network, tagged
"sentinel-site count") for common illnesses, versus comprehensive
mandatory-reporting counts (tagged "all-case reporting") for the
notifiable disease list — the former undercounts true national burden by
design, the latter doesn't; don't compare the two directly. All Japan
figures are provisional and may be revised in JIHS's later confirmed
reports. Either way, this aggregates and links to official sources; it
does not replace them. For anything clinically or epidemiologically
load-bearing, follow the outbound link and read the original report.
