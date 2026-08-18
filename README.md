# Outbreak Watch

A single, filterable feed of public disease outbreak reports. v1 pulls from
**WHO Disease Outbreak News (DON)**, normalizes it, and republishes it as a
static site with search and an "unread since your last visit" marker —
none of which WHO's own site offers.

Live data lives in [`data/feed.json`](data/feed.json), regenerated every 6
hours by a GitHub Actions workflow and served straight off GitHub Pages —
no server, no database.

## How it works

- [`scripts/fetch-who.mjs`](scripts/fetch-who.mjs) calls WHO's public
  OData API (the same one `who.int/emergencies/disease-outbreak-news`
  itself uses — no key required, discovered from the page's own network
  requests) and writes a normalized `data/feed.json`.
- [`.github/workflows/update-and-deploy.yml`](.github/workflows/update-and-deploy.yml)
  runs that script on a cron schedule, commits the refreshed feed, and
  deploys the static site to GitHub Pages.
- [`index.html`](index.html) / [`app.js`](app.js) render the feed
  client-side: search box, newest/unread sort, and a "New" badge driven by
  a timestamp stashed in `localStorage`.

## Running locally

```sh
node scripts/fetch-who.mjs   # regenerates data/feed.json
python3 -m http.server       # or any static file server, then open index.html
```

No dependencies — the fetch script uses Node's built-in `fetch`.

## Deploying your own copy

1. Push this repo to GitHub.
2. In **Settings → Pages**, set Source to **GitHub Actions**.
3. The included workflow handles the rest (initial deploy on push, then a
   refresh every 6 hours).

## Scope and honesty about what's *not* here yet

ProMED-mail and CDC's Health Alert Network were the original targets too,
but:

- **ProMED** now renders posts client-side (Next.js) with no reachable
  public API in the raw HTML — pulling it in requires a headless browser
  (e.g. Playwright) to capture the XHR its own page makes, which is heavier
  than a GitHub Actions cron job wants to be for v1. Left as a `v2` item.
- **CDC HAN**'s RSS endpoint is blocked at the edge (bot detection) for
  plain HTTP clients. Also left as a `v2` item — may need a different
  endpoint or a browser-like fetch.

Contributions adding either source (or others — ECDC, national health
ministries) are welcome; keep the normalized `{source, title, url, date,
disease, summary}` shape in `data/feed.json` so the frontend doesn't need
to change per source.

## Disclaimer

This aggregates and links to official sources; it does not replace them.
For anything clinically or epidemiologically load-bearing, follow the
outbound link and read the original WHO report.
