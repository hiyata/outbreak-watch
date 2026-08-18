const LAST_SEEN_KEY = "outbreak-watch:last-seen";

const listEl = document.getElementById("outbreak-list");
const headerStatsEl = document.getElementById("header-stats");
const detailEl = document.getElementById("detail");
const searchEl = document.getElementById("search");
const sortEl = document.getElementById("sort");
const mapContainer = document.getElementById("map-container");

let allOutbreaks = [];
let lastSeen = localStorage.getItem(LAST_SEEN_KEY);
let selectedId = null;
let countryHitCounts = new Map(); // map country id -> count of matching outbreaks (post-filter)
let svgSelection = null;
let pathGenerator = null;

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
  let outbreaks = allOutbreaks.filter((ob) => {
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

  const width = mapContainer.clientWidth || 640;
  const height = width * 0.55;
  const projection = d3.geoNaturalEarth1().fitSize([width - 4, height - 4], geo);
  pathGenerator = d3.geoPath(projection);

  const svg = d3
    .select(mapContainer)
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

async function init() {
  try {
    const res = await fetch("data/feed.json", { cache: "no-store" });
    const feed = await res.json();
    allOutbreaks = feed.outbreaks;

    headerStatsEl.innerHTML = `
      <span><b>${feed.outbreak_count}</b> outbreaks tracked</span>
      <span><b>${feed.update_count}</b> reports</span>
      <span>Updated ${fmtDate(feed.generated_at)}</span>
    `;

    renderSidebar();
    renderDetail();
    await initMap();

    const newest = allOutbreaks.reduce((max, o) => (o.latest_update > max ? o.latest_update : max), "");
    if (newest) localStorage.setItem(LAST_SEEN_KEY, newest);
  } catch (err) {
    listEl.innerHTML = '<p id="status">Could not load feed. Try again shortly.</p>';
    console.error(err);
  }
}

searchEl.addEventListener("input", () => {
  renderSidebar();
});
sortEl.addEventListener("change", () => {
  renderSidebar();
});

init();
