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

const tabWhoEl = document.getElementById("tab-who");
const tabCdcEl = document.getElementById("tab-cdc");
const tabBrEl = document.getElementById("tab-br");
const tabClEl = document.getElementById("tab-cl");
const mapTitleEl = document.getElementById("map-title");
const legendWhoEl = document.getElementById("legend-who");
const legendCdcEl = document.getElementById("legend-cdc");
const legendBrEl = document.getElementById("legend-br");
const legendClEl = document.getElementById("legend-cl");
const controlsWhoEl = document.getElementById("controls-who");
const controlsCdcEl = document.getElementById("controls-cdc");
const controlsBrEl = document.getElementById("controls-br");
const controlsClEl = document.getElementById("controls-cl");
const footerWhoEl = document.getElementById("footer-who");
const footerCdcEl = document.getElementById("footer-cdc");
const footerBrEl = document.getElementById("footer-br");
const footerClEl = document.getElementById("footer-cl");

const ACTIVE_WINDOW_DAYS = 365;
const ACTIVE_CUTOFF = new Date(Date.now() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

let mode = "who"; // "who" | "cdc" | "br" | "cl"

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
    <h3 style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin: 1.5rem 0 0.6rem;">Update timeline</h3>
    ${updatesHtml}
  `;
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
    <h3 style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin: 1.5rem 0 0.6rem;">By state${d.states.length > 25 ? ` (top 25 of ${d.states.length})` : ""}</h3>
    <table class="state-table">
      <thead><tr><th>State</th><th class="num">This week</th><th class="num">YTD</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;
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
  `;
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
  `;
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

function switchMode(next) {
  if (mode === next) return;
  mode = next;

  tabWhoEl.classList.toggle("active", mode === "who");
  tabCdcEl.classList.toggle("active", mode === "cdc");
  tabBrEl.classList.toggle("active", mode === "br");
  tabClEl.classList.toggle("active", mode === "cl");
  mapTitleEl.textContent = MAP_TITLES[mode];

  whoMapWrap.style.display = mode === "who" ? "" : "none";
  cdcMapWrap.style.display = mode === "cdc" ? "" : "none";
  brMapWrap.style.display = mode === "br" ? "" : "none";
  clMapWrap.style.display = mode === "cl" ? "" : "none";
  legendWhoEl.style.display = mode === "who" ? "" : "none";
  legendCdcEl.style.display = mode === "cdc" ? "" : "none";
  legendBrEl.style.display = mode === "br" ? "" : "none";
  legendClEl.style.display = mode === "cl" ? "" : "none";
  controlsWhoEl.style.display = mode === "who" ? "" : "none";
  controlsCdcEl.style.display = mode === "cdc" ? "" : "none";
  controlsBrEl.style.display = mode === "br" ? "" : "none";
  controlsClEl.style.display = mode === "cl" ? "" : "none";
  listEl.style.display = mode === "who" ? "" : "none";
  cdcListEl.style.display = mode === "cdc" ? "" : "none";
  brListEl.style.display = mode === "br" ? "" : "none";
  clListEl.style.display = mode === "cl" ? "" : "none";
  footerWhoEl.style.display = mode === "who" ? "" : "none";
  footerCdcEl.style.display = mode === "cdc" ? "" : "none";
  footerBrEl.style.display = mode === "br" ? "" : "none";
  footerClEl.style.display = mode === "cl" ? "" : "none";

  if (mode === "cdc") renderCdcDetail();
  else if (mode === "br") renderBrDetail();
  else if (mode === "cl") renderClDetail();
  else renderDetail();
  renderHeaderStats();
}

function renderHeaderStats() {
  if (mode === "cdc" && cdcFeed) {
    headerStatsEl.innerHTML = `
      <span><b>${cdcFeed.disease_count}</b> notifiable diseases active</span>
      <span>MMWR week ${cdcFeed.week}, ${cdcFeed.year}</span>
      <span>Updated ${fmtDate(cdcFeed.generated_at)}</span>
    `;
  } else if (mode === "br" && brFeed) {
    headerStatsEl.innerHTML = `
      <span><b>${allBrStates.length}</b> states tracked</span>
      <span>Epi. week ${brFeed.epidemiological_week}, ${brFeed.epidemiological_year}</span>
      <span>Updated ${fmtDate(brFeed.generated_at)}</span>
    `;
  } else if (mode === "cl" && clFeed) {
    headerStatsEl.innerHTML = `
      <span><b>${allClRegions.length}</b> regions tracked</span>
      <span>Epi. week ${clFeed.epidemiological_week}, ${clFeed.epidemiological_year}</span>
      <span>Updated ${fmtDate(clFeed.generated_at)}</span>
    `;
  } else if (mode === "who" && allOutbreaks.length) {
    const activeCount = allOutbreaks.filter((o) => o.latest_update >= ACTIVE_CUTOFF).length;
    headerStatsEl.innerHTML = `
      <span><b>${activeCount}</b> active</span>
      <span><b>${allOutbreaks.length}</b> total tracked</span>
      <span>Updated ${fmtDate(whoGeneratedAt)}</span>
    `;
  }
}

async function init() {
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

tabWhoEl.addEventListener("click", () => switchMode("who"));
tabCdcEl.addEventListener("click", () => switchMode("cdc"));
tabBrEl.addEventListener("click", () => switchMode("br"));
tabClEl.addEventListener("click", () => switchMode("cl"));

init();
