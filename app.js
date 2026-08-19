const LAST_SEEN_KEY = "outbreak-watch:last-seen";

const listEl = document.getElementById("outbreak-list");
const headerStatsEl = document.getElementById("header-stats");
const detailEl = document.getElementById("detail");
const searchEl = document.getElementById("search");
const sortEl = document.getElementById("sort");
const showHistoricalEl = document.getElementById("show-historical");
const whoMapWrap = document.getElementById("who-map-wrap");

const cdcListEl = document.getElementById("cdc-list");
const cdcSearchEl = document.getElementById("cdc-search");
const cdcSortEl = document.getElementById("cdc-sort");
const cdcMapWrap = document.getElementById("cdc-map-wrap");

const brListEl = document.getElementById("br-list");
const brSearchEl = document.getElementById("br-search");
const brSortEl = document.getElementById("br-sort");
const brMapWrap = document.getElementById("br-map-wrap");

const clListEl = document.getElementById("cl-list");
const clSearchEl = document.getElementById("cl-search");
const clSortEl = document.getElementById("cl-sort");
const clMapWrap = document.getElementById("cl-map-wrap");

const ukListEl = document.getElementById("uk-list");
const ukSearchEl = document.getElementById("uk-search");
const ukSortEl = document.getElementById("uk-sort");
const ukMapWrap = document.getElementById("uk-map-wrap");

const jpListEl = document.getElementById("jp-list");
const jpSearchEl = document.getElementById("jp-search");
const jpSortEl = document.getElementById("jp-sort");
const jpMapWrap = document.getElementById("jp-map-wrap");

const tabWhoEl = document.getElementById("tab-who");
const tabCdcEl = document.getElementById("tab-cdc");
const tabBrEl = document.getElementById("tab-br");
const tabClEl = document.getElementById("tab-cl");
const tabUkEl = document.getElementById("tab-uk");
const tabJpEl = document.getElementById("tab-jp");
const mapTitleEl = document.getElementById("map-title");
const legendWhoEl = document.getElementById("legend-who");
const legendCdcEl = document.getElementById("legend-cdc");
const legendBrEl = document.getElementById("legend-br");
const legendClEl = document.getElementById("legend-cl");
const legendUkEl = document.getElementById("legend-uk");
const legendJpEl = document.getElementById("legend-jp");
const controlsWhoEl = document.getElementById("controls-who");
const controlsCdcEl = document.getElementById("controls-cdc");
const controlsBrEl = document.getElementById("controls-br");
const controlsClEl = document.getElementById("controls-cl");
const controlsUkEl = document.getElementById("controls-uk");
const controlsJpEl = document.getElementById("controls-jp");
const footerWhoEl = document.getElementById("footer-who");
const footerCdcEl = document.getElementById("footer-cdc");
const footerBrEl = document.getElementById("footer-br");
const footerClEl = document.getElementById("footer-cl");
const footerUkEl = document.getElementById("footer-uk");
const footerJpEl = document.getElementById("footer-jp");

const ACTIVE_WINDOW_DAYS = 365;
const ACTIVE_CUTOFF = new Date(Date.now() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

let mode = "who"; // "who" | "cdc" | "br" | "cl" | "uk" | "jp"

let allOutbreaks = [];
let lastSeen = localStorage.getItem(LAST_SEEN_KEY);
let selectedId = null;
let countryHitCounts = new Map(); // map country id -> count of matching outbreaks (post-filter)
let svgSelection = null;

let cdcFeed = null;
let allDiseases = [];
let selectedDisease = null;
let cdcSvgSelection = null;
let whoGeneratedAt = null;

let brFeed = null;
let allBrStates = [];
let selectedBrState = null;
let brSvgSelection = null;

const BR_INTENSITY_COLOR = {
  Segurança: "#3f7a5c",
  "Baixo risco": "#8bb08a",
  Alerta: "#e0c34f",
  Risco: "#e0883f",
  "Alto risco": "#b8461f",
};

let clFeed = null;
let allClRegions = [];
let selectedClRegion = null;
let clSvgSelection = null;

let ukFeed = null;
let allUkDiseases = [];
let selectedUkDisease = null;
let ukSvgSelection = null;

let dataStatus = null; // data/status.json — which sources' last fetch attempt succeeded

let jpFeed = null;
let allJpDiseases = [];
let selectedJpDisease = null;
let jpSvgSelection = null;

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function fmtNumber(n) {
  return n.toLocaleString();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// Renders a small inline SVG line+area sparkline from a series of numbers.
// Points with null/undefined value show as a gap in the line rather than
// a false zero. Returns an HTML string, not a live DOM node.
function sparklineSvg(values, { width = 280, height = 56, labels = null } = {}) {
  const pad = 4;
  const nums = values.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null));
  const present = nums.filter((v) => v !== null);
  if (present.length < 2) return '<p style="color: var(--muted); font-size: 0.78rem;">Not enough data points for a trend chart yet.</p>';

  const max = Math.max(...present);
  const min = Math.min(0, ...present);
  const range = max - min || 1;
  const stepX = (width - pad * 2) / (nums.length - 1);
  const xy = nums.map((v, i) => {
    if (v === null) return null;
    const x = pad + i * stepX;
    const y = height - pad - ((v - min) / range) * (height - pad * 2);
    return [x, y];
  });

  // Break the polyline into contiguous segments so gaps (nulls) don't draw
  // a misleading straight line across missing weeks.
  const segments = [];
  let current = [];
  for (const p of xy) {
    if (p === null) {
      if (current.length) segments.push(current);
      current = [];
    } else {
      current.push(p);
    }
  }
  if (current.length) segments.push(current);

  const lines = segments
    .map((seg) => `<polyline points="${seg.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" />`)
    .join("");

  const lastPoint = [...xy].reverse().find((p) => p !== null);
  const dot = lastPoint
    ? `<circle cx="${lastPoint[0].toFixed(1)}" cy="${lastPoint[1].toFixed(1)}" r="2.5" fill="var(--accent)" />`
    : "";

  const labelHtml = labels
    ? `<div style="display:flex; justify-content:space-between; font-size:0.68rem; color:var(--muted); margin-top:0.2rem;"><span>${escapeHtml(labels[0])}</span><span>${escapeHtml(labels[labels.length - 1])}</span></div>`
    : "";

  return `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="none" style="display:block;">
      ${lines}${dot}
    </svg>
    ${labelHtml}
  `;
}

function isNewOutbreak(ob) {
  return Boolean(lastSeen && ob.latest_update > lastSeen);
}

function filteredOutbreaks() {
  const query = searchEl.value.trim().toLowerCase();
  const includeHistorical = showHistoricalEl.checked;

  let outbreaks = allOutbreaks.filter((ob) => {
    if (!includeHistorical && ob.latest_update < ACTIVE_CUTOFF) return false;
    if (!query) return true;
    const haystack = `${ob.disease} ${ob.countries.map((c) => c.name).join(" ")} ${ob.updates
      .map((u) => u.title + " " + u.summary)
      .join(" ")}`.toLowerCase();
    return haystack.includes(query);
  });

  const sort = sortEl.value;
  if (sort === "unread") {
    outbreaks = [...outbreaks].sort((a, b) => {
      const aNew = isNewOutbreak(a) ? 1 : 0;
      const bNew = isNewOutbreak(b) ? 1 : 0;
      if (aNew !== bNew) return bNew - aNew;
      return b.latest_update.localeCompare(a.latest_update);
    });
  } else if (sort === "count") {
    outbreaks = [...outbreaks].sort((a, b) => b.update_count - a.update_count);
  } else if (sort === "cases") {
    outbreaks = [...outbreaks].sort((a, b) => (b.latest_counts?.cases ?? -1) - (a.latest_counts?.cases ?? -1));
  } else {
    outbreaks = [...outbreaks].sort((a, b) => b.latest_update.localeCompare(a.latest_update));
  }

  return outbreaks;
}

function renderSidebar() {
  const outbreaks = filteredOutbreaks();

  countryHitCounts = new Map();
  for (const ob of outbreaks) {
    for (const c of ob.countries) {
      countryHitCounts.set(c.id, (countryHitCounts.get(c.id) ?? 0) + 1);
    }
  }
  paintMap();

  if (outbreaks.length === 0) {
    listEl.innerHTML = '<p id="status">No matching outbreaks.</p>';
    return;
  }

  listEl.innerHTML = outbreaks
    .map((ob) => {
      const isNew = isNewOutbreak(ob);
      const isActive = ob.id === selectedId;
      const countryLabel = ob.is_global
        ? "Multi-country / global"
        : ob.countries.map((c) => c.name).join(", ") || "Location unspecified";
      const countsLabel = ob.latest_counts
        ? `${fmtNumber(ob.latest_counts.cases)} cases${
            ob.latest_counts.deaths ? ` · ${fmtNumber(ob.latest_counts.deaths)} deaths` : ""
          }`
        : "";

      return `
        <button class="list-item${isNew ? " is-new" : ""}${isActive ? " active" : ""}" data-id="${escapeHtml(ob.id)}">
          <div class="li-title">${escapeHtml(ob.disease)}</div>
          <div class="li-meta">
            <span>${escapeHtml(countryLabel)}</span>
          </div>
          <div class="li-meta">
            <span>${ob.update_count} update${ob.update_count === 1 ? "" : "s"}</span>
            <span>·</span>
            <span>${fmtDate(ob.latest_update)}</span>
            ${countsLabel ? `<span class="li-counts">${countsLabel}</span>` : ""}
          </div>
        </button>
      `;
    })
    .join("");

  listEl.querySelectorAll(".list-item").forEach((btn) => {
    btn.addEventListener("click", () => selectOutbreak(btn.dataset.id));
  });
}

function renderDetail() {
  const ob = allOutbreaks.find((o) => o.id === selectedId);
  if (!ob) {
    detailEl.innerHTML =
      '<p style="color: var(--muted); font-size: 0.9rem;">Select an outbreak on the left, or a highlighted country on the map, to see its full update timeline.</p>';
    return;
  }

  const countryLabel = ob.is_global
    ? "Multi-country / global"
    : ob.countries.map((c) => c.name).join(", ") || "Location unspecified";

  const statsHtml = ob.latest_counts
    ? `
      <div class="stat-row">
        <div class="stat"><div class="n">${fmtNumber(ob.latest_counts.cases)}</div><div class="l">cumulative cases</div></div>
        ${
          ob.latest_counts.deaths
            ? `<div class="stat"><div class="n">${fmtNumber(ob.latest_counts.deaths)}</div><div class="l">deaths</div></div>
               <div class="stat"><div class="n">${((ob.latest_counts.deaths / ob.latest_counts.cases) * 100).toFixed(1)}%</div><div class="l">case fatality (reported)</div></div>`
            : ""
        }
      </div>
      <div class="stat-note">Extracted automatically from WHO's latest report text${
        ob.latest_counts.as_of ? `, as of ${ob.latest_counts.as_of}` : ""
      }. May be incomplete — verify against the source report.</div>
    `
    : `<p style="color: var(--muted); font-size: 0.82rem;">No parseable case/death figures found in WHO's report text for this outbreak.</p>`;

  const updatesHtml = ob.updates
    .map(
      (u) => `
        <div class="update">
          <div class="update-date">${fmtDate(u.date)}</div>
          <h3><a href="${u.url}" target="_blank" rel="noopener">${escapeHtml(u.title)}</a></h3>
          <p>${escapeHtml(u.summary)}</p>
        </div>
      `
    )
    .join("");

  const chronological = [...ob.updates].sort((a, b) => a.date.localeCompare(b.date));
  const caseSeries = chronological.map((u) => u.counts?.cases ?? null);
  const chartHtml =
    caseSeries.filter((v) => v !== null).length >= 2
      ? `
        <h3 style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin: 1.5rem 0 0.4rem;">Cumulative cases over time</h3>
        <div class="chart-box">${sparklineSvg(caseSeries, {
          labels: [fmtDate(chronological[0].date), fmtDate(chronological[chronological.length - 1].date)],
        })}</div>
      `
      : "";

  const crossLinksHtml = renderCrossLinks(ob);

  detailEl.innerHTML = `
    <div class="detail-head">
      <h2>${escapeHtml(ob.disease)}</h2>
      <div class="detail-tags">
        <span class="tag">${escapeHtml(countryLabel)}</span>
        <span class="tag">first seen ${fmtDate(ob.first_seen)}</span>
        <span class="tag">${ob.update_count} update${ob.update_count === 1 ? "" : "s"}</span>
      </div>
    </div>
    ${statsHtml}
    ${chartHtml}
    ${crossLinksHtml}
    <h3 style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin: 1.5rem 0 0.6rem;">Update timeline</h3>
    ${updatesHtml}
  `;
  bindCrossLinkClicks();
}

// ---------- Cross-source linking ----------
// Best-effort: WHO reports diseases in free text with no shared taxonomy
// across sources, so this matches on shared significant keywords (>3
// letters, common words stripped) rather than an exact disease code.
// Conservative on purpose — a missed link is better than a wrong one.

const CROSS_LINK_STOPWORDS = new Set([
  "disease", "virus", "infection", "caused", "outbreak", "syndrome", "clade",
  "acute", "severe", "novel", "recombinant", "elements", "genomic", "with",
]);

function diseaseKeywords(str) {
  return (str ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !CROSS_LINK_STOPWORDS.has(w));
}

function diseaseKeywordMatch(a, b) {
  const setA = new Set(diseaseKeywords(a));
  return diseaseKeywords(b).some((w) => setA.has(w));
}

const CROSS_LINK_SOURCES = [
  { mode: "cdc", label: "United States (CDC)", country: "United States of America" },
  { mode: "br", label: "Brazil (InfoGripe)", country: "Brazil" },
  { mode: "uk", label: "England (UKHSA)", country: "United Kingdom" },
  { mode: "cl", label: "Chile (DEIS)", country: "Chile" },
  { mode: "jp", label: "Japan (JIHS)", country: "Japan" },
];

// Returns [{mode, label, matchLabel}] — local-source cross-links relevant
// to a WHO outbreak, based on country + (for disease-specific sources)
// keyword overlap. Chile is country-only since it's not disease-specific.
function findCrossLinks(ob) {
  if (ob.is_global) return [];
  const countryNames = new Set(ob.countries.map((c) => c.name));
  const links = [];

  for (const src of CROSS_LINK_SOURCES) {
    if (!countryNames.has(src.country)) continue;

    if (src.mode === "cl") {
      if (allClRegions.length) links.push({ ...src, matchLabel: "weekly mortality data" });
      continue;
    }
    if (src.mode === "cdc" && allDiseases.length) {
      const match = allDiseases.find((d) => diseaseKeywordMatch(ob.disease, d.disease));
      if (match) links.push({ ...src, matchLabel: match.disease, target: match.disease });
    }
    if (src.mode === "br" && allBrStates.length && diseaseKeywordMatch(ob.disease, "influenza respiratory")) {
      links.push({ ...src, matchLabel: "SRAG (severe respiratory illness) surveillance" });
    }
    if (src.mode === "uk" && allUkDiseases.length) {
      const match = allUkDiseases.find((d) => diseaseKeywordMatch(ob.disease, d.topic));
      if (match) links.push({ ...src, matchLabel: match.topic, target: match.topic });
    }
    if (src.mode === "jp" && allJpDiseases.length) {
      const match = allJpDiseases.find((d) => diseaseKeywordMatch(ob.disease, d.disease));
      if (match) links.push({ ...src, matchLabel: match.disease, target: match.disease });
    }
  }
  return links;
}

function renderCrossLinks(ob) {
  const links = findCrossLinks(ob);
  if (links.length === 0) return "";

  const chips = links
    .map(
      (l) =>
        `<button class="cross-link" data-mode="${l.mode}" data-target="${escapeHtml(l.target ?? "")}">
          ${escapeHtml(l.label)} → ${escapeHtml(l.matchLabel)}
        </button>`
    )
    .join("");

  return `
    <div class="cross-links">
      <div class="cross-links-label">Also tracked locally</div>
      <div class="cross-links-row">${chips}</div>
    </div>
  `;
}

// Reverse direction: from a local-source disease, find a matching WHO
// outbreak in the same country, so CDC/Brazil/UK detail panels can link
// back to the global picture too.
function findWhoLinkBack(diseaseName, countryName) {
  if (!allOutbreaks.length) return "";
  const match = allOutbreaks.find(
    (ob) => !ob.is_global && ob.countries.some((c) => c.name === countryName) && diseaseKeywordMatch(diseaseName, ob.disease)
  );
  if (!match) return "";
  return `
    <div class="cross-links">
      <div class="cross-links-label">Also in the global outbreak feed</div>
      <div class="cross-links-row">
        <button class="cross-link" data-mode="who" data-target="${escapeHtml(match.id)}">World (WHO) → ${escapeHtml(match.disease)}</button>
      </div>
    </div>
  `;
}

// Country-only reverse link (for Chile mode, which isn't disease-specific
// so keyword matching doesn't apply — any active WHO outbreak in-country
// is potentially relevant context).
function renderCountryLinkBack(countryName) {
  if (!allOutbreaks.length) return "";
  const matches = allOutbreaks.filter((ob) => !ob.is_global && ob.countries.some((c) => c.name === countryName));
  if (matches.length === 0) return "";
  const chips = matches
    .slice(0, 5)
    .map(
      (ob) =>
        `<button class="cross-link" data-mode="who" data-target="${escapeHtml(ob.id)}">World (WHO) → ${escapeHtml(ob.disease)}</button>`
    )
    .join("");
  return `
    <div class="cross-links">
      <div class="cross-links-label">Active WHO outbreaks in this country</div>
      <div class="cross-links-row">${chips}</div>
    </div>
  `;
}

function bindCrossLinkClicks() {
  detailEl.querySelectorAll(".cross-link").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetMode = btn.dataset.mode;
      const target = btn.dataset.target;
      switchMode(targetMode);
      if (targetMode === "cdc" && target) selectDisease(target);
      else if (targetMode === "uk" && target) selectUkDisease(target);
      else if (targetMode === "jp" && target) selectJpDisease(target);
      else if (targetMode === "who" && target) selectOutbreak(target);
    });
  });
}

function selectOutbreak(id) {
  selectedId = id;
  renderSidebar();
  renderDetail();
  paintMap();
  detailEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

function hitColor(count) {
  if (count >= 3) return "var(--map-hit-3)";
  if (count === 2) return "var(--map-hit-2)";
  if (count === 1) return "var(--map-hit-1)";
  return "var(--map-land)";
}

function paintMap() {
  if (!svgSelection) return;
  const selectedOb = allOutbreaks.find((o) => o.id === selectedId);
  const selectedCountryIds = new Set((selectedOb?.countries ?? []).map((c) => c.id));

  svgSelection.attr("fill", function () {
    const id = this.getAttribute("data-id");
    return hitColor(countryHitCounts.get(id) ?? 0);
  });
  svgSelection
    .classed("has-outbreak", function () {
      return (countryHitCounts.get(this.getAttribute("data-id")) ?? 0) > 0;
    })
    .classed("selected", function () {
      return selectedCountryIds.has(this.getAttribute("data-id"));
    });
}

async function initMap() {
  const topo = await d3.json("data/countries-110m.json");
  const geo = topojson.feature(topo, topo.objects.countries);

  const width = whoMapWrap.clientWidth || 640;
  const height = width * 0.55;
  const projection = d3.geoNaturalEarth1().fitSize([width - 4, height - 4], geo);
  const pathGenerator = d3.geoPath(projection);

  const svg = d3
    .select(whoMapWrap)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  const paths = svg
    .append("g")
    .selectAll("path")
    .data(geo.features)
    .join("path")
    .attr("class", "country-path")
    .attr("data-id", (d) => String(d.id).padStart(3, "0"))
    .attr("d", pathGenerator)
    .attr("fill", "var(--map-land)");

  paths.append("title").text((d) => d.properties.name);
  svgSelection = paths;

  svgSelection.on("click", function (event, d) {
    const id = String(d.id).padStart(3, "0");
    const count = countryHitCounts.get(id) ?? 0;
    if (count === 0) return;
    const match = filteredOutbreaks().find((ob) => ob.countries.some((c) => c.id === id));
    if (match) selectOutbreak(match.id);
  });

  paintMap();
}

// ---------- CDC (US states) mode ----------

function filteredDiseases() {
  const query = cdcSearchEl.value.trim().toLowerCase();
  let diseases = allDiseases.filter((d) => !query || d.disease.toLowerCase().includes(query));

  const sort = cdcSortEl.value;
  if (sort === "ytd") {
    diseases = [...diseases].sort((a, b) => b.total_ytd - a.total_ytd);
  } else if (sort === "states") {
    diseases = [...diseases].sort((a, b) => b.states_reporting - a.states_reporting);
  } else {
    diseases = [...diseases].sort((a, b) => b.total_current_week - a.total_current_week);
  }
  return diseases;
}

function renderCdcSidebar() {
  const diseases = filteredDiseases();

  if (diseases.length === 0) {
    cdcListEl.innerHTML = '<p id="cdc-status">No matching diseases.</p>';
    return;
  }

  cdcListEl.innerHTML = diseases
    .map((d) => {
      const isActive = d.disease === selectedDisease;
      return `
        <button class="list-item${isActive ? " active" : ""}" data-disease="${escapeHtml(d.disease)}">
          <div class="li-title">${escapeHtml(d.disease)}</div>
          <div class="li-meta">
            <span>${d.states_reporting} state${d.states_reporting === 1 ? "" : "s"} reporting</span>
          </div>
          <div class="li-meta">
            <span class="li-counts">${fmtNumber(d.total_current_week)} this week</span>
            <span>·</span>
            <span>${fmtNumber(d.total_ytd)} YTD</span>
          </div>
        </button>
      `;
    })
    .join("");

  cdcListEl.querySelectorAll(".list-item").forEach((btn) => {
    btn.addEventListener("click", () => selectDisease(btn.dataset.disease));
  });
}

function renderCdcDetail() {
  const d = allDiseases.find((x) => x.disease === selectedDisease);
  if (!d) {
    detailEl.innerHTML =
      '<p style="color: var(--muted); font-size: 0.9rem;">Select a notifiable disease on the left, or a highlighted state on the map, to see its state-by-state breakdown.</p>';
    return;
  }

  const rowsHtml = d.states
    .slice(0, 25)
    .map(
      (s) => `
        <tr>
          <td>${escapeHtml(s.name)}</td>
          <td class="num">${fmtNumber(s.current_week)}</td>
          <td class="num">${fmtNumber(s.ytd)}</td>
        </tr>
      `
    )
    .join("");

  const trendHtml = d.national_series
    ? `
      <h3 style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin: 1.5rem 0 0.4rem;">National weekly trend</h3>
      <div class="chart-box">${sparklineSvg(
        d.national_series.map((p) => p.value),
        { labels: [`wk ${d.national_series[0].week}`, `wk ${d.national_series[d.national_series.length - 1].week}`] }
      )}</div>
    `
    : "";

  const whoLink = findWhoLinkBack(d.disease, "United States of America");

  detailEl.innerHTML = `
    <div class="detail-head">
      <h2>${escapeHtml(d.disease)}</h2>
      <div class="detail-tags">
        <span class="tag">MMWR week ${cdcFeed.week}, ${cdcFeed.year}</span>
        <span class="tag">${d.states_reporting} states reporting</span>
      </div>
    </div>
    <div class="stat-row">
      <div class="stat"><div class="n">${fmtNumber(d.total_current_week)}</div><div class="l">cases this week (provisional)</div></div>
      <div class="stat"><div class="n">${fmtNumber(d.total_ytd)}</div><div class="l">cumulative cases this year</div></div>
    </div>
    <div class="stat-note">Source: CDC NNDSS weekly tables. Most recent week is provisional and will revise upward as more reports come in.</div>
    ${trendHtml}
    ${whoLink}
    <h3 style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin: 1.5rem 0 0.6rem;">By state${d.states.length > 25 ? ` (top 25 of ${d.states.length})` : ""}</h3>
    <table class="state-table">
      <thead><tr><th>State</th><th class="num">This week</th><th class="num">YTD</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;
  bindCrossLinkClicks();
}

function selectDisease(disease) {
  selectedDisease = disease;
  renderCdcSidebar();
  renderCdcDetail();
  paintCdcMap();
  detailEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

function paintCdcMap() {
  if (!cdcSvgSelection) return;
  const d = allDiseases.find((x) => x.disease === selectedDisease);
  const byState = new Map((d?.states ?? []).map((s) => [s.id, s.current_week]));
  const max = Math.max(1, ...[...byState.values()]);
  const scale = d3.scaleSequential(d3.interpolateOranges).domain([0, max]);

  cdcSvgSelection
    .attr("fill", function () {
      const id = this.getAttribute("data-id");
      if (!d) return "var(--map-land)";
      return byState.has(id) ? scale(byState.get(id)) : "var(--map-land)";
    })
    .classed("has-outbreak", function () {
      return d ? byState.has(this.getAttribute("data-id")) : false;
    });
}

async function initCdcMap() {
  const topo = await d3.json("data/us-states-10m.json");
  const geo = topojson.feature(topo, topo.objects.states);

  const width = cdcMapWrap.clientWidth || 640;
  const height = width * 0.62;
  const projection = d3.geoAlbersUsa().fitSize([width - 4, height - 4], geo);
  const pathGenerator = d3.geoPath(projection);

  const svg = d3
    .select(cdcMapWrap)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  const paths = svg
    .append("g")
    .selectAll("path")
    .data(geo.features)
    .join("path")
    .attr("class", "country-path")
    .attr("data-id", (d) => String(d.id).padStart(2, "0"))
    .attr("d", pathGenerator)
    .attr("fill", "var(--map-land)");

  paths.append("title").text((d) => d.properties.name);
  cdcSvgSelection = paths;

  cdcSvgSelection.on("click", function (event, feature) {
    const id = String(feature.id).padStart(2, "0");
    const d = allDiseases.find((x) => x.disease === selectedDisease);
    if (!d || !d.states.some((s) => s.id === id)) return;
    // clicking a state while a disease is selected just keeps that disease selected;
    // clicking with none selected picks the state's top disease this week
    if (!selectedDisease) {
      const top = [...allDiseases]
        .map((x) => ({ x, s: x.states.find((s) => s.id === id) }))
        .filter((r) => r.s)
        .sort((a, b) => b.s.current_week - a.s.current_week)[0];
      if (top) selectDisease(top.x.disease);
    }
  });

  paintCdcMap();
}

// ---------- Brazil (InfoGripe) mode ----------

function fmtIncidence(cases, population) {
  if (cases == null || !population) return null;
  return (cases / population) * 100000;
}

function filteredBrStates() {
  const query = brSearchEl.value.trim().toLowerCase();
  let states = allBrStates.filter((s) => !query || s.name.toLowerCase().includes(query) || s.abbr.toLowerCase().includes(query));

  const intensityRank = { "Alto risco": 4, Risco: 3, Alerta: 2, "Baixo risco": 1, Segurança: 0 };
  const sort = brSortEl.value;
  if (sort === "intensity") {
    states = [...states].sort((a, b) => (intensityRank[b.intensity] ?? -1) - (intensityRank[a.intensity] ?? -1));
  } else if (sort === "name") {
    states = [...states].sort((a, b) => a.name.localeCompare(b.name));
  } else {
    states = [...states].sort((a, b) => (b.cases_reported ?? 0) - (a.cases_reported ?? 0));
  }
  return states;
}

function renderBrSidebar() {
  const states = filteredBrStates();

  if (states.length === 0) {
    brListEl.innerHTML = '<p id="br-status">No matching states.</p>';
    return;
  }

  brListEl.innerHTML = states
    .map((s) => {
      const isActive = s.id === selectedBrState;
      return `
        <button class="list-item${isActive ? " active" : ""}" data-id="${escapeHtml(s.id)}">
          <div class="li-title">${escapeHtml(s.name)} (${escapeHtml(s.abbr)})</div>
          <div class="li-meta">
            <span>${escapeHtml(s.intensity ?? "No data")}</span>
          </div>
          <div class="li-meta">
            <span class="li-counts">${s.cases_reported != null ? fmtNumber(s.cases_reported) + " cases" : "No data"}</span>
            ${s.trend_short ? `<span>· ${escapeHtml(s.trend_short)}</span>` : ""}
          </div>
        </button>
      `;
    })
    .join("");

  brListEl.querySelectorAll(".list-item").forEach((btn) => {
    btn.addEventListener("click", () => selectBrState(btn.dataset.id));
  });
}

function renderBrDetail() {
  const s = allBrStates.find((x) => x.id === selectedBrState);
  if (!s) {
    detailEl.innerHTML =
      '<p style="color: var(--muted); font-size: 0.9rem;">Select a state on the left, or on the map, for its SRAG surveillance detail.</p>';
    return;
  }

  const incidence = fmtIncidence(s.cases_reported, s.population);

  detailEl.innerHTML = `
    <div class="detail-head">
      <h2>${escapeHtml(s.name)}</h2>
      <div class="detail-tags">
        <span class="tag">Epi. week ${brFeed.epidemiological_week}, ${brFeed.epidemiological_year}</span>
        <span class="tag" style="border-color: ${BR_INTENSITY_COLOR[s.intensity] ?? "var(--border)"}">${escapeHtml(s.intensity ?? "No data")}</span>
      </div>
    </div>
    <div class="stat-row">
      <div class="stat"><div class="n">${s.cases_reported != null ? fmtNumber(s.cases_reported) : "—"}</div><div class="l">SRAG cases reported this week</div></div>
      ${
        s.cases_estimated != null
          ? `<div class="stat"><div class="n">${fmtNumber(Math.round(s.cases_estimated))}</div><div class="l">nowcast estimate</div></div>`
          : ""
      }
      ${incidence != null ? `<div class="stat"><div class="n">${incidence.toFixed(2)}</div><div class="l">per 100,000 population</div></div>` : ""}
    </div>
    <div class="stat-note">
      Trend: ${escapeHtml(s.trend_short ?? "unknown")} (short-term), ${escapeHtml(s.trend_long ?? "unknown")} (long-term).
      Source: InfoGripe (Fiocruz/FGV). Most recent week is provisional.
    </div>
    ${
      s.series && s.series.length >= 2
        ? `
          <h3 style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin: 1.5rem 0 0.4rem;">Weekly cases, last ${s.series.length} weeks</h3>
          <div class="chart-box">${sparklineSvg(
            s.series.map((p) => p.value),
            { labels: [`wk ${s.series[0].week}`, `wk ${s.series[s.series.length - 1].week}`] }
          )}</div>
        `
        : ""
    }
    ${findWhoLinkBack("influenza respiratory syndrome", "Brazil")}
  `;
  bindCrossLinkClicks();
}

function selectBrState(id) {
  selectedBrState = id;
  renderBrSidebar();
  renderBrDetail();
  paintBrMap();
  detailEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

function paintBrMap() {
  if (!brSvgSelection) return;
  const byState = new Map(allBrStates.map((s) => [s.id, s]));

  brSvgSelection
    .attr("fill", function () {
      const id = this.getAttribute("data-id");
      const s = byState.get(id);
      return s?.intensity ? BR_INTENSITY_COLOR[s.intensity] ?? "var(--map-land)" : "var(--map-land)";
    })
    .classed("has-outbreak", function () {
      return byState.has(this.getAttribute("data-id"));
    })
    .classed("selected", function () {
      return this.getAttribute("data-id") === selectedBrState;
    });
}

async function initBrMap() {
  const geo = await d3.json("data/br-states-geo.json");

  const width = brMapWrap.clientWidth || 640;
  const height = width * 0.9;
  const projection = d3.geoMercator().fitSize([width - 4, height - 4], geo);
  const pathGenerator = d3.geoPath(projection);

  const svg = d3
    .select(brMapWrap)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  const byState = new Map(allBrStates.map((s) => [s.id, s]));

  const paths = svg
    .append("g")
    .selectAll("path")
    .data(geo.features)
    .join("path")
    .attr("class", "country-path")
    .attr("data-id", (d) => String(d.properties.codarea).padStart(2, "0"))
    .attr("d", pathGenerator)
    .attr("fill", "var(--map-land)");

  paths.append("title").text((d) => {
    const s = byState.get(String(d.properties.codarea).padStart(2, "0"));
    return s ? s.name : d.properties.codarea;
  });
  brSvgSelection = paths;

  brSvgSelection.on("click", function (event, feature) {
    const id = String(feature.properties.codarea).padStart(2, "0");
    if (!byState.has(id)) return;
    selectBrState(id);
  });

  paintBrMap();
}

const MAP_TITLES = {
  who: "Active outbreaks by country",
  cdc: "US notifiable diseases by state",
  br: "Brazil SRAG risk level by state",
  cl: "Chile all-cause mortality by region",
  uk: "England notifiable diseases by region",
  jp: "Japan notifiable diseases by prefecture",
};

// ---------- Chile (DEIS) mode ----------

function filteredClRegions() {
  const query = clSearchEl.value.trim().toLowerCase();
  let regions = allClRegions.filter((r) => !query || r.name.toLowerCase().includes(query));

  const sort = clSortEl.value;
  if (sort === "deaths") {
    regions = [...regions].sort((a, b) => b.latest_deaths - a.latest_deaths);
  } else if (sort === "name") {
    regions = [...regions].sort((a, b) => a.name.localeCompare(b.name));
  } else {
    regions = [...regions].sort((a, b) => (b.pct_vs_baseline ?? -Infinity) - (a.pct_vs_baseline ?? -Infinity));
  }
  return regions;
}

function clColor(pct) {
  if (pct == null) return "var(--map-land)";
  const scale = d3.scaleDiverging(d3.interpolateRdBu).domain([40, 0, -40]);
  return scale(pct);
}

function renderClSidebar() {
  const regions = filteredClRegions();

  if (regions.length === 0) {
    clListEl.innerHTML = '<p id="cl-status">No matching regions.</p>';
    return;
  }

  clListEl.innerHTML = regions
    .map((r) => {
      const isActive = r.id === selectedClRegion;
      const pctLabel = r.pct_vs_baseline != null ? `${r.pct_vs_baseline > 0 ? "+" : ""}${r.pct_vs_baseline.toFixed(1)}% vs baseline` : "";
      return `
        <button class="list-item${isActive ? " active" : ""}" data-id="${escapeHtml(r.id)}">
          <div class="li-title">${escapeHtml(r.name)}</div>
          <div class="li-meta">
            <span class="li-counts">${fmtNumber(r.latest_deaths)} deaths this week</span>
            ${pctLabel ? `<span>· ${pctLabel}</span>` : ""}
          </div>
        </button>
      `;
    })
    .join("");

  clListEl.querySelectorAll(".list-item").forEach((btn) => {
    btn.addEventListener("click", () => selectClRegion(btn.dataset.id));
  });
}

function renderClDetail() {
  const r = allClRegions.find((x) => x.id === selectedClRegion);
  if (!r) {
    detailEl.innerHTML =
      '<p style="color: var(--muted); font-size: 0.9rem;">Select a region on the left, or on the map, for its mortality detail.</p>';
    return;
  }

  const incidence = fmtIncidence(r.latest_deaths, r.population);

  detailEl.innerHTML = `
    <div class="detail-head">
      <h2>${escapeHtml(r.name)}</h2>
      <div class="detail-tags">
        <span class="tag">Epi. week ${clFeed.epidemiological_week}, ${clFeed.epidemiological_year}</span>
        <span class="tag">All-cause mortality</span>
      </div>
    </div>
    <div class="stat-row">
      <div class="stat"><div class="n">${fmtNumber(r.latest_deaths)}</div><div class="l">deaths this week</div></div>
      ${
        r.baseline_avg_deaths != null
          ? `<div class="stat"><div class="n">${r.baseline_avg_deaths.toFixed(0)}</div><div class="l">${clFeed.baseline_week_count}-week baseline avg</div></div>`
          : ""
      }
      ${incidence != null ? `<div class="stat"><div class="n">${incidence.toFixed(1)}</div><div class="l">per 100,000 population</div></div>` : ""}
    </div>
    <div class="stat-note">
      <strong>All-cause mortality, not disease-specific.</strong> The most recent week's
      count is almost always an undercount (deaths take time to register), so this
      region's ${r.pct_vs_baseline != null ? `${r.pct_vs_baseline.toFixed(1)}% vs. baseline` : "comparison"}
      figure should be read as provisional, not a confirmed trend. Source: DEIS/MINSAL.
    </div>
    ${
      r.series && r.series.length >= 2
        ? `
          <h3 style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin: 1.5rem 0 0.4rem;">Weekly deaths, last ${r.series.length} weeks</h3>
          <div class="chart-box">${sparklineSvg(
            r.series.map((p) => p.value),
            { labels: [`wk ${r.series[0].week}`, `wk ${r.series[r.series.length - 1].week}`] }
          )}</div>
        `
        : ""
    }
    ${renderCountryLinkBack("Chile")}
  `;
  bindCrossLinkClicks();
}

function selectClRegion(id) {
  selectedClRegion = id;
  renderClSidebar();
  renderClDetail();
  paintClMap();
  detailEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

function paintClMap() {
  if (!clSvgSelection) return;
  const byRegion = new Map(allClRegions.map((r) => [r.id, r]));

  clSvgSelection
    .attr("fill", function () {
      const id = this.getAttribute("data-id");
      const r = byRegion.get(id);
      return r ? clColor(r.pct_vs_baseline) : "var(--map-land)";
    })
    .classed("has-outbreak", function () {
      return byRegion.has(this.getAttribute("data-id"));
    })
    .classed("selected", function () {
      return this.getAttribute("data-id") === selectedClRegion;
    });
}

async function initClMap() {
  const topo = await d3.json("data/cl-regions-topo.json");
  const objectName = Object.keys(topo.objects)[0];
  const geo = topojson.feature(topo, topo.objects[objectName]);

  const width = clMapWrap.clientWidth || 640;
  const height = width * 1.35;
  const projection = d3.geoMercator().fitSize([width - 4, height - 4], geo);
  const pathGenerator = d3.geoPath(projection);

  const svg = d3
    .select(clMapWrap)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  const byRegion = new Map(allClRegions.map((r) => [r.id, r]));

  const paths = svg
    .append("g")
    .selectAll("path")
    .data(geo.features)
    .join("path")
    .attr("class", "country-path")
    .attr("data-id", (d) => d.properties.region_key)
    .attr("d", pathGenerator)
    .attr("fill", "var(--map-land)");

  paths.append("title").text((d) => {
    const r = byRegion.get(d.properties.region_key);
    return r ? r.name : d.properties.display_name;
  });
  clSvgSelection = paths;

  clSvgSelection.on("click", function (event, feature) {
    const id = feature.properties.region_key;
    if (!byRegion.has(id)) return;
    selectClRegion(id);
  });

  paintClMap();
}

// ---------- England (UKHSA) mode ----------

function ukNationalTotal(disease, field) {
  return disease.regions.reduce((sum, r) => sum + (r[field] ?? 0), 0);
}

function ukTrendPct(disease) {
  const now = ukNationalTotal(disease, "latest_value");
  const before = ukNationalTotal(disease, "value_4_weeks_ago");
  if (!before) return now > 0 ? Infinity : 0;
  return ((now - before) / before) * 100;
}

function filteredUkDiseases() {
  const query = ukSearchEl.value.trim().toLowerCase();
  let diseases = allUkDiseases.filter((d) => !query || d.topic.toLowerCase().includes(query));

  const sort = ukSortEl.value;
  if (sort === "trend") {
    diseases = [...diseases].sort((a, b) => ukTrendPct(b) - ukTrendPct(a));
  } else if (sort === "name") {
    diseases = [...diseases].sort((a, b) => a.topic.localeCompare(b.topic));
  } else {
    diseases = [...diseases].sort((a, b) => ukNationalTotal(b, "latest_value") - ukNationalTotal(a, "latest_value"));
  }
  return diseases;
}

function ukMetricUnit(metricName) {
  if (metricName.includes("positivity")) return "% test positivity";
  if (metricName.includes("Rate")) return "rate";
  if (metricName.includes("cases")) return "cases";
  return "value";
}

function renderUkSidebar() {
  const diseases = filteredUkDiseases();

  if (diseases.length === 0) {
    ukListEl.innerHTML = '<p id="uk-status">No matching diseases.</p>';
    return;
  }

  ukListEl.innerHTML = diseases
    .map((d) => {
      const isActive = d.topic === selectedUkDisease;
      const total = ukNationalTotal(d, "latest_value");
      const trend = ukTrendPct(d);
      const trendLabel = Number.isFinite(trend) ? `${trend > 0 ? "+" : ""}${trend.toFixed(0)}% vs 4wk ago` : "new activity";
      return `
        <button class="list-item${isActive ? " active" : ""}" data-topic="${escapeHtml(d.topic)}">
          <div class="li-title">${escapeHtml(d.topic)}</div>
          <div class="li-meta"><span>${escapeHtml(ukMetricUnit(d.metric))}</span></div>
          <div class="li-meta">
            <span class="li-counts">${fmtNumber(Math.round(total * 100) / 100)}</span>
            <span>· ${trendLabel}</span>
          </div>
        </button>
      `;
    })
    .join("");

  ukListEl.querySelectorAll(".list-item").forEach((btn) => {
    btn.addEventListener("click", () => selectUkDisease(btn.dataset.topic));
  });
}

function renderUkDetail() {
  const d = allUkDiseases.find((x) => x.topic === selectedUkDisease);
  if (!d) {
    detailEl.innerHTML =
      '<p style="color: var(--muted); font-size: 0.9rem;">Select a disease on the left, or a region on the map, for its regional breakdown.</p>';
    return;
  }

  const rowsHtml = [...d.regions]
    .sort((a, b) => b.latest_value - a.latest_value)
    .map(
      (r) => `
        <tr>
          <td>${escapeHtml(r.name)}</td>
          <td class="num">${fmtNumber(r.latest_value)}</td>
          <td class="num">${r.value_4_weeks_ago != null ? fmtNumber(r.value_4_weeks_ago) : "—"}</td>
        </tr>
      `
    )
    .join("");

  detailEl.innerHTML = `
    <div class="detail-head">
      <h2>${escapeHtml(d.topic)}</h2>
      <div class="detail-tags">
        <span class="tag">${escapeHtml(ukMetricUnit(d.metric))}</span>
        <span class="tag">as of ${fmtDate(d.latest_date)}</span>
        <span class="tag">England only</span>
      </div>
    </div>
    <div class="stat-note">
      Metric: <code>${escapeHtml(d.metric)}</code>. UKHSA publishes several indicators
      per disease (test positivity, hospital admissions, syndromic rates, case counts);
      this is whichever one currently has the most recent data for this disease, so the
      unit differs disease to disease — always check before comparing across diseases.
    </div>
    ${ukNationalTrendChart(d)}
    ${findWhoLinkBack(d.topic, "United Kingdom")}
    <h3 style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin: 1.5rem 0 0.6rem;">By region</h3>
    <table class="state-table">
      <thead><tr><th>Region</th><th class="num">Latest</th><th class="num">4 weeks ago</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;
  bindCrossLinkClicks();
}

function ukNationalTrendChart(d) {
  const withSeries = d.regions.filter((r) => r.series && r.series.length >= 2);
  if (withSeries.length === 0) return "";
  const length = Math.min(...withSeries.map((r) => r.series.length));
  const isRate = ukMetricUnit(d.metric) !== "cases"; // % positivity / rate metrics should average across regions, not sum
  const points = [];
  for (let i = 0; i < length; i++) {
    const values = withSeries.map((r) => r.series[r.series.length - length + i]?.value ?? 0);
    const total = values.reduce((a, b) => a + b, 0);
    points.push(isRate ? total / values.length : total);
  }
  const dates = withSeries[0].series.slice(-length).map((p) => p.date);
  const label = isRate ? "England average, recent trend" : "England total, recent trend";
  return `
    <h3 style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin: 1.5rem 0 0.4rem;">${label}</h3>
    <div class="chart-box">${sparklineSvg(points, { labels: [fmtDate(dates[0]), fmtDate(dates[dates.length - 1])] })}</div>
  `;
}

function selectUkDisease(topic) {
  selectedUkDisease = topic;
  renderUkSidebar();
  renderUkDetail();
  paintUkMap();
  detailEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

function paintUkMap() {
  if (!ukSvgSelection) return;
  const d = allUkDiseases.find((x) => x.topic === selectedUkDisease);
  const byRegion = new Map((d?.regions ?? []).map((r) => [r.id, r.latest_value]));
  const max = Math.max(1, ...[...byRegion.values()]);
  const scale = d3.scaleSequential(d3.interpolateOranges).domain([0, max]);

  ukSvgSelection
    .attr("fill", function () {
      const id = this.getAttribute("data-id");
      if (!d) return "var(--map-land)";
      return byRegion.has(id) ? scale(byRegion.get(id)) : "var(--map-land)";
    })
    .classed("has-outbreak", function () {
      return d ? byRegion.has(this.getAttribute("data-id")) : false;
    });
}

async function initUkMap() {
  const topo = await d3.json("data/uk-regions-topo.json");
  const objectName = Object.keys(topo.objects)[0];
  const geo = topojson.feature(topo, topo.objects[objectName]);

  const width = ukMapWrap.clientWidth || 640;
  const height = width * 1.3;
  const projection = d3.geoMercator().fitSize([width - 4, height - 4], geo);
  const pathGenerator = d3.geoPath(projection);

  const svg = d3
    .select(ukMapWrap)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  const byRegionName = new Map();

  const paths = svg
    .append("g")
    .selectAll("path")
    .data(geo.features)
    .join("path")
    .attr("class", "country-path")
    .attr("data-id", (d) => d.properties.region_key)
    .attr("d", pathGenerator)
    .attr("fill", "var(--map-land)");

  paths.append("title").text((d) => d.properties.display_name);
  ukSvgSelection = paths;

  ukSvgSelection.on("click", function (event, feature) {
    const id = feature.properties.region_key;
    const match = filteredUkDiseases().find((d) => d.regions.some((r) => r.id === id));
    if (match) selectUkDisease(match.topic);
  });

  paintUkMap();
}

// ---------- Japan (JIHS) mode ----------

let jpPrefNames = new Map(); // pref_id ("01".."47") -> display name, populated when the map loads

function jpPrefName(id) {
  return jpPrefNames.get(id) ?? `Prefecture ${id}`;
}

function jpTrendPct(d) {
  const series = d.national_series;
  if (!series || series.length < 2) return 0;
  const now = series[series.length - 1].value ?? 0;
  const before = series[0].value;
  if (!before) return now > 0 ? Infinity : 0;
  return ((now - before) / before) * 100;
}

function filteredJpDiseases() {
  const query = jpSearchEl.value.trim().toLowerCase();
  let diseases = allJpDiseases.filter((d) => !query || d.disease.toLowerCase().includes(query));

  const sort = jpSortEl.value;
  if (sort === "trend") {
    diseases = [...diseases].sort((a, b) => jpTrendPct(b) - jpTrendPct(a));
  } else if (sort === "name") {
    diseases = [...diseases].sort((a, b) => a.disease.localeCompare(b.disease));
  } else {
    diseases = [...diseases].sort((a, b) => (b.latest_total ?? 0) - (a.latest_total ?? 0));
  }
  return diseases;
}

function renderJpSidebar() {
  const diseases = filteredJpDiseases();

  if (diseases.length === 0) {
    jpListEl.innerHTML = '<p id="jp-status">No matching diseases.</p>';
    return;
  }

  jpListEl.innerHTML = diseases
    .map((d) => {
      const isActive = d.disease === selectedJpDisease;
      const trend = jpTrendPct(d);
      const trendLabel = Number.isFinite(trend) ? `${trend > 0 ? "+" : ""}${trend.toFixed(0)}% vs 12wk ago` : "new activity";
      return `
        <button class="list-item${isActive ? " active" : ""}" data-disease="${escapeHtml(d.disease)}">
          <div class="li-title">${escapeHtml(d.disease)}</div>
          <div class="li-meta"><span>${d.category === "sentinel" ? "sentinel-site count" : "all-case reporting"}</span></div>
          <div class="li-meta">
            <span class="li-counts">${fmtNumber(d.latest_total)}</span>
            <span>· ${trendLabel}</span>
          </div>
        </button>
      `;
    })
    .join("");

  jpListEl.querySelectorAll(".list-item").forEach((btn) => {
    btn.addEventListener("click", () => selectJpDisease(btn.dataset.disease));
  });
}

function renderJpDetail() {
  const d = allJpDiseases.find((x) => x.disease === selectedJpDisease);
  if (!d) {
    detailEl.innerHTML =
      '<p style="color: var(--muted); font-size: 0.9rem;">Select a disease on the left, or a prefecture on the map, for its prefecture-by-prefecture breakdown.</p>';
    return;
  }

  const rowsHtml = [...d.prefectures]
    .sort((a, b) => (b.current_week ?? 0) - (a.current_week ?? 0))
    .slice(0, 25)
    .map(
      (p) => `
        <tr>
          <td>${escapeHtml(jpPrefName(p.id))}</td>
          <td class="num">${p.current_week != null ? fmtNumber(p.current_week) : "—"}</td>
        </tr>
      `
    )
    .join("");

  const chartHtml = d.national_series && d.national_series.filter((p) => p.value !== null).length >= 2
    ? `
      <h3 style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin: 1.5rem 0 0.4rem;">National weekly trend</h3>
      <div class="chart-box">${sparklineSvg(
        d.national_series.map((p) => p.value),
        { labels: [`wk ${d.national_series[0].week}`, `wk ${d.national_series[d.national_series.length - 1].week}`] }
      )}</div>
    `
    : "";

  detailEl.innerHTML = `
    <div class="detail-head">
      <h2>${escapeHtml(d.disease)}</h2>
      <div class="detail-tags">
        <span class="tag">${d.category === "sentinel" ? "Sentinel-site surveillance" : "All-case reporting"}</span>
        <span class="tag">week ${d.latest_week}, ${jpFeed.year}</span>
        <span class="tag">${d.prefectures_reporting} of 47 prefectures with cases</span>
      </div>
    </div>
    <div class="stat-row">
      <div class="stat"><div class="n">${fmtNumber(d.latest_total)}</div><div class="l">${d.category === "sentinel" ? "cases (sentinel sites)" : "cases (all-case reporting)"}</div></div>
    </div>
    <div class="stat-note">
      ${
        d.category === "sentinel"
          ? "Sentinel-site count: reported from a fixed network of clinics, not a national total — actual case counts nationwide are higher. Useful for tracking trend direction, not absolute burden."
          : "All-case (mandatory) reporting: this is a comprehensive national count, not sampled."
      }
      Source: JIHS IDWR, provisional and subject to revision.
    </div>
    ${chartHtml}
    ${findWhoLinkBack(d.disease, "Japan")}
    <h3 style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin: 1.5rem 0 0.6rem;">By prefecture${d.prefectures.length > 25 ? ` (top 25 of ${d.prefectures.length})` : ""}</h3>
    <table class="state-table">
      <thead><tr><th>Prefecture</th><th class="num">This week</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;
  bindCrossLinkClicks();
}

function selectJpDisease(disease) {
  selectedJpDisease = disease;
  renderJpSidebar();
  renderJpDetail();
  paintJpMap();
  detailEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

function paintJpMap() {
  if (!jpSvgSelection) return;
  const d = allJpDiseases.find((x) => x.disease === selectedJpDisease);
  const byPref = new Map((d?.prefectures ?? []).map((p) => [p.id, p.current_week ?? 0]));
  const max = Math.max(1, ...[...byPref.values()]);
  const scale = d3.scaleSequential(d3.interpolateOranges).domain([0, max]);

  jpSvgSelection
    .attr("fill", function () {
      const id = this.getAttribute("data-id");
      if (!d) return "var(--map-land)";
      return byPref.has(id) ? scale(byPref.get(id)) : "var(--map-land)";
    })
    .classed("has-outbreak", function () {
      return d ? byPref.has(this.getAttribute("data-id")) : false;
    });
}

async function initJpMap() {
  const topo = await d3.json("data/jp-prefectures-topo.json");
  const objectName = Object.keys(topo.objects)[0];
  const geo = topojson.feature(topo, topo.objects[objectName]);

  geo.features.forEach((f) => jpPrefNames.set(f.properties.pref_id, f.properties.display_name));

  const width = jpMapWrap.clientWidth || 640;
  const height = width * 1.1;
  const projection = d3.geoMercator().fitSize([width - 4, height - 4], geo);
  const pathGenerator = d3.geoPath(projection);

  const svg = d3
    .select(jpMapWrap)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  const paths = svg
    .append("g")
    .selectAll("path")
    .data(geo.features)
    .join("path")
    .attr("class", "country-path")
    .attr("data-id", (d) => d.properties.pref_id)
    .attr("d", pathGenerator)
    .attr("fill", "var(--map-land)");

  paths.append("title").text((d) => d.properties.display_name);
  jpSvgSelection = paths;

  jpSvgSelection.on("click", function (event, feature) {
    const id = feature.properties.pref_id;
    const match = filteredJpDiseases().find((d) => d.prefectures.some((p) => p.id === id));
    if (match) selectJpDisease(match.disease);
  });

  paintJpMap();
}

function switchMode(next) {
  if (mode === next) return;
  mode = next;

  tabWhoEl.classList.toggle("active", mode === "who");
  tabCdcEl.classList.toggle("active", mode === "cdc");
  tabBrEl.classList.toggle("active", mode === "br");
  tabClEl.classList.toggle("active", mode === "cl");
  tabUkEl.classList.toggle("active", mode === "uk");
  tabJpEl.classList.toggle("active", mode === "jp");
  mapTitleEl.textContent = MAP_TITLES[mode];

  whoMapWrap.style.display = mode === "who" ? "" : "none";
  cdcMapWrap.style.display = mode === "cdc" ? "" : "none";
  brMapWrap.style.display = mode === "br" ? "" : "none";
  clMapWrap.style.display = mode === "cl" ? "" : "none";
  ukMapWrap.style.display = mode === "uk" ? "" : "none";
  jpMapWrap.style.display = mode === "jp" ? "" : "none";
  legendWhoEl.style.display = mode === "who" ? "" : "none";
  legendCdcEl.style.display = mode === "cdc" ? "" : "none";
  legendBrEl.style.display = mode === "br" ? "" : "none";
  legendClEl.style.display = mode === "cl" ? "" : "none";
  legendUkEl.style.display = mode === "uk" ? "" : "none";
  legendJpEl.style.display = mode === "jp" ? "" : "none";
  controlsWhoEl.style.display = mode === "who" ? "" : "none";
  controlsCdcEl.style.display = mode === "cdc" ? "" : "none";
  controlsBrEl.style.display = mode === "br" ? "" : "none";
  controlsClEl.style.display = mode === "cl" ? "" : "none";
  controlsUkEl.style.display = mode === "uk" ? "" : "none";
  controlsJpEl.style.display = mode === "jp" ? "" : "none";
  listEl.style.display = mode === "who" ? "" : "none";
  cdcListEl.style.display = mode === "cdc" ? "" : "none";
  brListEl.style.display = mode === "br" ? "" : "none";
  clListEl.style.display = mode === "cl" ? "" : "none";
  ukListEl.style.display = mode === "uk" ? "" : "none";
  jpListEl.style.display = mode === "jp" ? "" : "none";
  footerWhoEl.style.display = mode === "who" ? "" : "none";
  footerCdcEl.style.display = mode === "cdc" ? "" : "none";
  footerBrEl.style.display = mode === "br" ? "" : "none";
  footerClEl.style.display = mode === "cl" ? "" : "none";
  footerUkEl.style.display = mode === "uk" ? "" : "none";
  footerJpEl.style.display = mode === "jp" ? "" : "none";

  if (mode === "cdc") renderCdcDetail();
  else if (mode === "br") renderBrDetail();
  else if (mode === "cl") renderClDetail();
  else if (mode === "uk") renderUkDetail();
  else if (mode === "jp") renderJpDetail();
  else renderDetail();
  renderHeaderStats();
}

// The dashboard's data updates on a 6-hour cron with no human watching it
// run — if a source's site changes format and its fetch script starts
// failing, the page would otherwise look completely normal while quietly
// showing data that's stopped updating. This surfaces that failure state
// instead of hiding it: data/status.json records whether each source's
// most recent fetch attempt actually succeeded (see the workflow's
// continue-on-error steps), independent of whether the displayed data
// itself is still the last good run.
function sourceHealthBadge(sourceId) {
  if (!dataStatus) return "";
  const entry = dataStatus.sources.find((s) => s.id === sourceId);
  if (!entry || entry.outcome === "success") return "";
  return `<span class="health-warning" title="The most recent scheduled update for this source failed — showing the last successful data.">⚠ update failed, showing last good data</span>`;
}

function renderHeaderStats() {
  if (mode === "cdc" && cdcFeed) {
    headerStatsEl.innerHTML = `
      <span><b>${cdcFeed.disease_count}</b> notifiable diseases active</span>
      <span>MMWR week ${cdcFeed.week}, ${cdcFeed.year}</span>
      <span>Updated ${fmtDate(cdcFeed.generated_at)}</span>
      ${sourceHealthBadge("cdc")}
    `;
  } else if (mode === "br" && brFeed) {
    headerStatsEl.innerHTML = `
      <span><b>${allBrStates.length}</b> states tracked</span>
      <span>Epi. week ${brFeed.epidemiological_week}, ${brFeed.epidemiological_year}</span>
      <span>Updated ${fmtDate(brFeed.generated_at)}</span>
      ${sourceHealthBadge("br")}
    `;
  } else if (mode === "cl" && clFeed) {
    headerStatsEl.innerHTML = `
      <span><b>${allClRegions.length}</b> regions tracked</span>
      <span>Epi. week ${clFeed.epidemiological_week}, ${clFeed.epidemiological_year}</span>
      <span>Updated ${fmtDate(clFeed.generated_at)}</span>
      ${sourceHealthBadge("cl")}
    `;
  } else if (mode === "uk" && ukFeed) {
    headerStatsEl.innerHTML = `
      <span><b>${allUkDiseases.length}</b> diseases tracked</span>
      <span>England, 9 regions</span>
      <span>Updated ${fmtDate(ukFeed.generated_at)}</span>
      ${sourceHealthBadge("uk")}
    `;
  } else if (mode === "jp" && jpFeed) {
    headerStatsEl.innerHTML = `
      <span><b>${allJpDiseases.length}</b> diseases tracked</span>
      <span>Japan, 47 prefectures, week ${jpFeed.week}</span>
      <span>Updated ${fmtDate(jpFeed.generated_at)}</span>
      ${sourceHealthBadge("jp")}
    `;
  } else if (mode === "who" && allOutbreaks.length) {
    const activeCount = allOutbreaks.filter((o) => o.latest_update >= ACTIVE_CUTOFF).length;
    headerStatsEl.innerHTML = `
      <span><b>${activeCount}</b> active</span>
      <span><b>${allOutbreaks.length}</b> total tracked</span>
      <span>Updated ${fmtDate(whoGeneratedAt)}</span>
      ${sourceHealthBadge("who")}
    `;
  }
}

async function init() {
  try {
    const res = await fetch("data/status.json", { cache: "no-store" });
    if (res.ok) dataStatus = await res.json();
  } catch {
    // status.json may not exist yet (e.g. local dev before any deploy) — silently skip
  }

  try {
    const res = await fetch("data/feed.json", { cache: "no-store" });
    const feed = await res.json();
    allOutbreaks = feed.outbreaks;
    whoGeneratedAt = feed.generated_at;
    renderHeaderStats();

    renderSidebar();
    renderDetail();
    await initMap();

    const newest = allOutbreaks.reduce((max, o) => (o.latest_update > max ? o.latest_update : max), "");
    if (newest) localStorage.setItem(LAST_SEEN_KEY, newest);
  } catch (err) {
    listEl.innerHTML = '<p id="status">Could not load feed. Try again shortly.</p>';
    console.error(err);
  }

  try {
    const res = await fetch("data/cdc-feed.json", { cache: "no-store" });
    cdcFeed = await res.json();
    allDiseases = cdcFeed.diseases;
    renderCdcSidebar();
    await initCdcMap();
  } catch (err) {
    cdcListEl.innerHTML = '<p id="cdc-status">Could not load CDC feed. Try again shortly.</p>';
    console.error(err);
  }

  try {
    const res = await fetch("data/br-feed.json", { cache: "no-store" });
    brFeed = await res.json();
    allBrStates = brFeed.states;
    renderBrSidebar();
    await initBrMap();
  } catch (err) {
    brListEl.innerHTML = '<p id="br-status">Could not load Brazil feed. Try again shortly.</p>';
    console.error(err);
  }

  try {
    const res = await fetch("data/cl-feed.json", { cache: "no-store" });
    clFeed = await res.json();
    allClRegions = clFeed.regions;
    renderClSidebar();
    await initClMap();
  } catch (err) {
    clListEl.innerHTML = '<p id="cl-status">Could not load Chile feed. Try again shortly.</p>';
    console.error(err);
  }

  try {
    const res = await fetch("data/uk-feed.json", { cache: "no-store" });
    ukFeed = await res.json();
    allUkDiseases = ukFeed.diseases;
    renderUkSidebar();
    await initUkMap();
  } catch (err) {
    ukListEl.innerHTML = '<p id="uk-status">Could not load England feed. Try again shortly.</p>';
    console.error(err);
  }

  try {
    const res = await fetch("data/jp-feed.json", { cache: "no-store" });
    jpFeed = await res.json();
    allJpDiseases = jpFeed.diseases;
    renderJpSidebar();
    await initJpMap();
  } catch (err) {
    jpListEl.innerHTML = '<p id="jp-status">Could not load Japan feed. Try again shortly.</p>';
    console.error(err);
  }
}

searchEl.addEventListener("input", () => {
  renderSidebar();
});
sortEl.addEventListener("change", () => {
  renderSidebar();
});
showHistoricalEl.addEventListener("change", () => {
  renderSidebar();
});

cdcSearchEl.addEventListener("input", () => {
  renderCdcSidebar();
});
cdcSortEl.addEventListener("change", () => {
  renderCdcSidebar();
});

brSearchEl.addEventListener("input", () => {
  renderBrSidebar();
});
brSortEl.addEventListener("change", () => {
  renderBrSidebar();
});

clSearchEl.addEventListener("input", () => {
  renderClSidebar();
});
clSortEl.addEventListener("change", () => {
  renderClSidebar();
});

ukSearchEl.addEventListener("input", () => {
  renderUkSidebar();
});
ukSortEl.addEventListener("change", () => {
  renderUkSidebar();
});

jpSearchEl.addEventListener("input", () => {
  renderJpSidebar();
});
jpSortEl.addEventListener("change", () => {
  renderJpSidebar();
});

tabWhoEl.addEventListener("click", () => switchMode("who"));
tabCdcEl.addEventListener("click", () => switchMode("cdc"));
tabBrEl.addEventListener("click", () => switchMode("br"));
tabClEl.addEventListener("click", () => switchMode("cl"));
tabUkEl.addEventListener("click", () => switchMode("uk"));
tabJpEl.addEventListener("click", () => switchMode("jp"));

// ---------- Unified search ----------

const globalSearchEl = document.getElementById("global-search");
const globalSearchResultsEl = document.getElementById("global-search-results");
const GSR_LIMIT_PER_SOURCE = 6;

function globalSearch(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const groups = [];

  const whoMatches = allOutbreaks
    .filter((ob) => `${ob.disease} ${ob.countries.map((c) => c.name).join(" ")}`.toLowerCase().includes(q))
    .slice(0, GSR_LIMIT_PER_SOURCE)
    .map((ob) => ({
      label: ob.disease,
      sub: ob.is_global ? "Multi-country / global" : ob.countries.map((c) => c.name).join(", "),
      action: () => { switchMode("who"); selectOutbreak(ob.id); },
    }));
  if (whoMatches.length) groups.push({ label: "World (WHO)", items: whoMatches });

  const cdcMatches = allDiseases
    .filter((d) => d.disease.toLowerCase().includes(q))
    .slice(0, GSR_LIMIT_PER_SOURCE)
    .map((d) => ({
      label: d.disease,
      sub: `${d.states_reporting} states reporting`,
      action: () => { switchMode("cdc"); selectDisease(d.disease); },
    }));
  if (cdcMatches.length) groups.push({ label: "United States (CDC)", items: cdcMatches });

  const brMatches = allBrStates
    .filter((s) => s.name.toLowerCase().includes(q))
    .slice(0, GSR_LIMIT_PER_SOURCE)
    .map((s) => ({
      label: s.name,
      sub: s.intensity ?? "No data",
      action: () => { switchMode("br"); selectBrState(s.id); },
    }));
  if (brMatches.length) groups.push({ label: "Brazil (InfoGripe)", items: brMatches });

  const clMatches = allClRegions
    .filter((r) => r.name.toLowerCase().includes(q))
    .slice(0, GSR_LIMIT_PER_SOURCE)
    .map((r) => ({
      label: r.name,
      sub: `${fmtNumber(r.latest_deaths)} deaths this week`,
      action: () => { switchMode("cl"); selectClRegion(r.id); },
    }));
  if (clMatches.length) groups.push({ label: "Chile (DEIS)", items: clMatches });

  const ukMatches = allUkDiseases
    .filter((d) => d.topic.toLowerCase().includes(q))
    .slice(0, GSR_LIMIT_PER_SOURCE)
    .map((d) => ({
      label: d.topic,
      sub: ukMetricUnit(d.metric),
      action: () => { switchMode("uk"); selectUkDisease(d.topic); },
    }));
  if (ukMatches.length) groups.push({ label: "England (UKHSA)", items: ukMatches });

  const jpMatches = allJpDiseases
    .filter((d) => d.disease.toLowerCase().includes(q))
    .slice(0, GSR_LIMIT_PER_SOURCE)
    .map((d) => ({
      label: d.disease,
      sub: d.category === "sentinel" ? "sentinel-site count" : "all-case reporting",
      action: () => { switchMode("jp"); selectJpDisease(d.disease); },
    }));
  if (jpMatches.length) groups.push({ label: "Japan (JIHS)", items: jpMatches });

  return groups;
}

function renderGlobalSearchResults() {
  const groups = globalSearch(globalSearchEl.value);

  if (globalSearchEl.value.trim() === "") {
    globalSearchResultsEl.hidden = true;
    globalSearchResultsEl.innerHTML = "";
    return;
  }

  if (groups.length === 0) {
    globalSearchResultsEl.innerHTML = '<div class="gsr-empty">No matches across any source.</div>';
    globalSearchResultsEl.hidden = false;
    return;
  }

  globalSearchResultsEl.innerHTML = groups
    .map(
      (g) => `
        <div class="gsr-group-label">${escapeHtml(g.label)}</div>
        ${g.items
          .map(
            (item, i) => `
              <button class="gsr-item" data-group="${escapeHtml(g.label)}" data-index="${i}">
                ${escapeHtml(item.label)}
                <span class="gsr-sub">${escapeHtml(item.sub)}</span>
              </button>
            `
          )
          .join("")}
      `
    )
    .join("");
  globalSearchResultsEl.hidden = false;

  globalSearchResultsEl.querySelectorAll(".gsr-item").forEach((btn) => {
    const group = groups.find((g) => g.label === btn.dataset.group);
    const item = group?.items[Number(btn.dataset.index)];
    if (!item) return;
    btn.addEventListener("click", () => {
      item.action();
      globalSearchResultsEl.hidden = true;
      globalSearchEl.value = "";
    });
  });
}

globalSearchEl.addEventListener("input", renderGlobalSearchResults);
globalSearchEl.addEventListener("focus", renderGlobalSearchResults);
document.addEventListener("click", (e) => {
  if (!e.target.closest(".global-search-wrap")) globalSearchResultsEl.hidden = true;
});
globalSearchEl.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    globalSearchResultsEl.hidden = true;
    globalSearchEl.blur();
  }
});

init();
