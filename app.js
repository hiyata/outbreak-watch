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

const tabWhoEl = document.getElementById("tab-who");
const tabCdcEl = document.getElementById("tab-cdc");
const mapTitleEl = document.getElementById("map-title");
const legendWhoEl = document.getElementById("legend-who");
const legendCdcEl = document.getElementById("legend-cdc");
const controlsWhoEl = document.getElementById("controls-who");
const controlsCdcEl = document.getElementById("controls-cdc");
const footerWhoEl = document.getElementById("footer-who");
const footerCdcEl = document.getElementById("footer-cdc");

const ACTIVE_WINDOW_DAYS = 365;
const ACTIVE_CUTOFF = new Date(Date.now() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

let mode = "who"; // "who" | "cdc"

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

function switchMode(next) {
  if (mode === next) return;
  mode = next;

  const isCdc = mode === "cdc";
  tabWhoEl.classList.toggle("active", !isCdc);
  tabCdcEl.classList.toggle("active", isCdc);
  mapTitleEl.textContent = isCdc ? "US notifiable diseases by state" : "Active outbreaks by country";
  whoMapWrap.style.display = isCdc ? "none" : "";
  cdcMapWrap.style.display = isCdc ? "" : "none";
  legendWhoEl.style.display = isCdc ? "none" : "";
  legendCdcEl.style.display = isCdc ? "" : "none";
  controlsWhoEl.style.display = isCdc ? "none" : "";
  controlsCdcEl.style.display = isCdc ? "" : "none";
  listEl.style.display = isCdc ? "none" : "";
  cdcListEl.style.display = isCdc ? "" : "none";
  footerWhoEl.style.display = isCdc ? "none" : "";
  footerCdcEl.style.display = isCdc ? "" : "none";

  if (isCdc) {
    renderCdcDetail();
    renderHeaderStats();
  } else {
    renderDetail();
    renderHeaderStats();
  }
}

function renderHeaderStats() {
  if (mode === "cdc" && cdcFeed) {
    headerStatsEl.innerHTML = `
      <span><b>${cdcFeed.disease_count}</b> notifiable diseases active</span>
      <span>MMWR week ${cdcFeed.week}, ${cdcFeed.year}</span>
      <span>Updated ${fmtDate(cdcFeed.generated_at)}</span>
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

tabWhoEl.addEventListener("click", () => switchMode("who"));
tabCdcEl.addEventListener("click", () => switchMode("cdc"));

init();
