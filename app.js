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
// Renders a real line chart (axes, gridlines, hover tooltip) into an
// already-in-DOM container. Detail panels build their HTML as one big
// string via innerHTML, so charts are rendered in a second pass: the
// template leaves a `<div class="chart-box" data-chart-id="...">`
// placeholder, then the caller invokes this against that element once
// it actually exists in the DOM (see renderTrendChartInto below).
//
// points: [{ x: <string label>, y: number|null }] — null y draws a gap,
// never a false zero or an interpolated line across missing weeks.
let chartInstanceCounter = 0;
const chartRegistry = new Map();

function renderTrendChart(container, points, opts = {}) {
  chartRegistry.set(container, { points, opts });
  const { color = "var(--accent)", valueFormat = fmtNumber } = opts;
  const validCount = points.filter((p) => p.y !== null && Number.isFinite(p.y)).length;
  if (validCount < 2) {
    container.innerHTML = '<p style="color: var(--muted); font-size: 0.82rem; margin: 0.5rem 0;">Not enough data points for a trend chart yet.</p>';
    return;
  }

  container.innerHTML = "";
  const margin = { top: 20, right: 16, bottom: 30, left: 56 };
  const width = Math.max(container.clientWidth || 560, 280);
  const height = 240;
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const presentValues = points.filter((p) => p.y !== null).map((p) => p.y);
  const yMaxData = Math.max(...presentValues);
  const yMinData = Math.min(0, ...presentValues);

  const x = d3.scalePoint(points.map((_, i) => i), [0, innerW]).padding(0.5);
  const y = d3.scaleLinear([yMinData, yMaxData], [innerH, 0]).nice(4);

  const svg = d3.select(container).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("width", "100%").attr("height", height).style("display", "block").style("overflow", "visible");

  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  // Gridlines + y-axis labels, snapped to clean numbers by scale.nice().
  const yTicks = y.ticks(4);
  const isSmallScale = yTicks.every((t) => Number.isInteger(t * 10));
  const fmtTick = (v) => (Number.isInteger(v) ? fmtNumber(v) : v.toFixed(isSmallScale ? 1 : 2));

  g.selectAll(".gridline")
    .data(yTicks)
    .join("line")
    .attr("x1", 0)
    .attr("x2", innerW)
    .attr("y1", (d) => y(d))
    .attr("y2", (d) => y(d))
    .attr("stroke", "var(--border)")
    .attr("stroke-width", 1);

  g.selectAll(".y-label")
    .data(yTicks)
    .join("text")
    .attr("x", -10)
    .attr("y", (d) => y(d))
    .attr("dy", "0.32em")
    .attr("text-anchor", "end")
    .attr("fill", "var(--muted)")
    .attr("font-size", 11)
    .text(fmtTick);

  // A handful of evenly-spaced x-axis labels rather than one per point —
  // with 12+ points, one-per-tick collides into an unreadable smear. The
  // count also has to shrink with the chart's own width (mobile), or wide
  // date strings like "May 17, 2026" overlap into an unreadable smear too.
  const n = points.length;
  const longestLabel = Math.max(...points.map((p) => String(p.x).length), 1);
  const estLabelWidth = longestLabel * 6.2 + 16;
  const maxTicksByWidth = Math.max(2, Math.floor(innerW / estLabelWidth));
  const tickCount = Math.min(6, n, maxTicksByWidth);
  const tickIndices = [...new Set(Array.from({ length: tickCount }, (_, i) => Math.round((i * (n - 1)) / Math.max(1, tickCount - 1))))];

  g.selectAll(".x-label")
    .data(tickIndices)
    .join("text")
    .attr("x", (i) => x(i))
    .attr("y", innerH + 22)
    .attr("text-anchor", "middle")
    .attr("fill", "var(--muted)")
    .attr("font-size", 11)
    .text((i) => points[i].x);

  g.append("line").attr("x1", 0).attr("x2", innerW).attr("y1", innerH).attr("y2", innerH).attr("stroke", "var(--border)").attr("stroke-width", 1);

  // Segment into contiguous runs so a null (missing week) draws a gap,
  // never a straight line interpolated across data that isn't there.
  const segments = [];
  let current = [];
  points.forEach((p, i) => {
    if (p.y === null || !Number.isFinite(p.y)) {
      if (current.length) segments.push(current);
      current = [];
    } else {
      current.push([i, p.y]);
    }
  });
  if (current.length) segments.push(current);

  const baseline = Math.min(innerH, y(Math.max(0, yMinData)));
  const lineGen = d3.line().x((d) => x(d[0])).y((d) => y(d[1])).curve(d3.curveMonotoneX);
  const areaGen = d3.area().x((d) => x(d[0])).y0(baseline).y1((d) => y(d[1])).curve(d3.curveMonotoneX);

  for (const seg of segments) {
    g.append("path").attr("d", areaGen(seg)).attr("fill", color).attr("opacity", 0.1);
    g.append("path").attr("d", lineGen(seg)).attr("fill", "none").attr("stroke", color).attr("stroke-width", 2).attr("stroke-linecap", "round").attr("stroke-linejoin", "round");
  }

  const lastValidIndex = [...points].map((p, i) => ({ ...p, i })).reverse().find((p) => p.y !== null && Number.isFinite(p.y));
  if (lastValidIndex) {
    g.append("circle")
      .attr("cx", x(lastValidIndex.i))
      .attr("cy", y(lastValidIndex.y))
      .attr("r", 5)
      .attr("fill", color)
      .attr("stroke", "var(--panel-2)")
      .attr("stroke-width", 2);
    g.append("text")
      .attr("x", x(lastValidIndex.i))
      .attr("y", y(lastValidIndex.y) - 12)
      .attr("text-anchor", lastValidIndex.i > n * 0.8 ? "end" : "middle")
      .attr("fill", "var(--text)")
      .attr("font-size", 12.5)
      .attr("font-weight", 700)
      .text(valueFormat(lastValidIndex.y));
  }

  // Hover: a crosshair that snaps to the nearest point, plus a tooltip.
  // Built once per chart instance and positioned with plain CSS so it
  // works the same in every detail panel that uses this component.
  chartInstanceCounter += 1;
  const tooltipId = `chart-tip-${chartInstanceCounter}`;
  container.style.position = "relative";
  const tooltip = d3.select(container).append("div").attr("id", tooltipId).attr("class", "chart-tooltip").style("opacity", 0);

  const crosshair = g.append("line").attr("class", "chart-crosshair").attr("y1", 0).attr("y2", innerH).style("opacity", 0);
  const hoverDot = g.append("circle").attr("r", 4).attr("fill", color).attr("stroke", "var(--panel-2)").attr("stroke-width", 2).style("opacity", 0);

  const indices = points.map((_, i) => i);
  svg
    .append("rect")
    .attr("x", margin.left)
    .attr("y", margin.top)
    .attr("width", innerW)
    .attr("height", innerH)
    .attr("fill", "transparent")
    .style("cursor", "crosshair")
    .on("pointermove", (event) => {
      const [mx] = d3.pointer(event, g.node());
      const i = d3.least(indices, (a) => Math.abs(x(a) - mx));
      const p = points[i];
      crosshair.attr("x1", x(i)).attr("x2", x(i)).style("opacity", 1);
      if (p.y !== null && Number.isFinite(p.y)) {
        hoverDot.attr("cx", x(i)).attr("cy", y(p.y)).style("opacity", 1);
      } else {
        hoverDot.style("opacity", 0);
      }
      tooltip
        .style("opacity", 1)
        .style("left", `${margin.left + x(i)}px`)
        .style("top", `${margin.top + (p.y !== null ? y(p.y) : innerH / 2)}px`)
        .html(
          `<div class="chart-tooltip-value">${p.y !== null && Number.isFinite(p.y) ? valueFormat(p.y) : "No data"}</div><div class="chart-tooltip-label"></div>`
        );
      tooltip.select(".chart-tooltip-label").text(p.x);
    })
    .on("pointerleave", () => {
      crosshair.style("opacity", 0);
      hoverDot.style("opacity", 0);
      tooltip.style("opacity", 0);
    });
}

// Builds the placeholder markup a detail-panel template embeds; the
// caller renders the actual chart into it via renderTrendChartInto once
// the HTML has been inserted into the DOM (SVG/d3 can't render into an
// element that doesn't exist yet).
function chartPlaceholder(id) {
  return `<div class="chart-box" id="${id}"></div>`;
}

function renderTrendChartInto(id, points, opts) {
  const el = document.getElementById(id);
  if (el) renderTrendChart(el, points, opts);
}

// Charts size themselves off container.clientWidth at render time, so a
// window resize (rotation, dev-tools split, browser resize) leaves the old
// width baked into the SVG until something re-renders it.
let chartResizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(chartResizeTimer);
  chartResizeTimer = setTimeout(() => {
    for (const [container, { points, opts }] of chartRegistry) {
      if (!container.isConnected) {
        chartRegistry.delete(container);
        continue;
      }
      renderTrendChart(container, points, opts);
    }
  }, 150);
});

// trend.trend classifies the recent window (a handful of reports) by
// regression slope, which can read "rising" even after a single down-tick —
// real behavior when a big prior spike still dominates the window, not a
// bug. percent_change is the separate, literal latest-vs-previous-report
// number, so the two are always labeled with different timeframes rather
// than presented as if they were describing the same thing.
const TREND_META = {
  rising: { icon: "▲", label: "Rising", cls: "trend-rising" },
  falling: { icon: "▼", label: "Falling", cls: "trend-falling" },
  stable: { icon: "●", label: "Stable", cls: "trend-stable" },
};

// Full pill for a detail-panel header: icon + word + the window size the
// classification was computed over, plus the single-report % change as a
// distinctly-labeled secondary fact so the two never look contradictory.
function trendTag(trend, { windowText } = {}) {
  if (!trend || !TREND_META[trend.trend]) return "";
  const meta = TREND_META[trend.trend];
  const pct = trend.percent_change;
  const pctText = pct === null || pct === undefined ? "" : ` <span class="trend-pct">(${pct > 0 ? "+" : ""}${pct}% ${windowText ? `over the last ${windowText}` : "vs previous report"})</span>`;
  const title = windowText ? `Recent trajectory over the last ${windowText}` : `Recent trajectory over the last ${trend.window_size} reports`;
  return `<span class="tag trend-tag ${meta.cls}" title="${title}">${meta.icon} ${meta.label}</span>${pctText}`;
}

// Compact icon-only badge for list rows. Shape (▲/▼/●) carries identity
// on its own, color is secondary — never color-alone.
function trendIcon(trend, { windowText } = {}) {
  if (!trend || !TREND_META[trend.trend]) return "";
  const meta = TREND_META[trend.trend];
  const title = windowText ? `${meta.label} — last ${windowText}` : `${meta.label} — last ${trend.window_size} reports`;
  return `<span class="trend-icon ${meta.cls}" title="${title}" aria-label="${title}">${meta.icon}</span>`;
}

// UK's per-topic national figure is a client-side aggregate across regions
// (summed or averaged depending on whether the metric is a rate — see
// ukNationalTrend), so it has no fetch-time trend of its own the way a
// single series does. This classifies it from the same 4-weeks-ago percent
// comparison the UK sidebar already computes, using the same +-10% band as
// computeTrend so the icon means the same thing everywhere in the app.
function trendFromPct(pct) {
  if (!Number.isFinite(pct)) return null;
  const trend = pct > 10 ? "rising" : pct < -10 ? "falling" : "stable";
  return { trend, percent_change: Math.round(pct * 10) / 10 };
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
            ${countsLabel ? `<span class="li-counts">${countsLabel}${trendIcon(ob.trend)}</span>` : ""}
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
  const casePoints = chronological.map((u) => ({ x: fmtDate(u.date), y: u.counts?.cases ?? null }));
  const chartHtml =
    casePoints.filter((p) => p.y !== null).length >= 2
      ? `
        <h3 style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin: 1.5rem 0 0.4rem;">Cumulative cases over time</h3>
        ${chartPlaceholder("who-trend-chart")}
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
        ${trendTag(ob.trend)}
      </div>
    </div>
    ${statsHtml}
    ${chartHtml}
    ${crossLinksHtml}
    <div id="strain-panel-wrap"></div>
    <h3 style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin: 1.5rem 0 0.6rem;">Update timeline</h3>
    ${updatesHtml}
  `;
  renderTrendChartInto("who-trend-chart", casePoints, { valueFormat: fmtNumber });
  bindCrossLinkClicks();
  loadAndRenderStrainPanel(ob.id);
}

// ---------- Strain / variant matching ----------
// data/strains/<outbreak-id>.json only exists for the small allowlist of
// pathogens scripts/fetch-strains.mjs knows how to align (see that file) —
// most outbreaks won't have one, which is expected, not an error. A 404
// here just means "no strain panel for this outbreak."

const strainDataCache = new Map(); // outbreakId -> parsed JSON | null
const genomeAnnotationCache = new Map(); // pathogenId -> parsed JSON | null

async function loadStrainData(outbreakId) {
  if (strainDataCache.has(outbreakId)) return strainDataCache.get(outbreakId);
  let data = null;
  try {
    const res = await fetch(`data/strains/${outbreakId}.json`, { cache: "no-store" });
    if (res.ok) data = await res.json();
  } catch {
    // network hiccup or no such file — treated the same as "no data"
  }
  strainDataCache.set(outbreakId, data);
  return data;
}

async function loadGenomeAnnotation(pathogenId) {
  if (genomeAnnotationCache.has(pathogenId)) return genomeAnnotationCache.get(pathogenId);
  let data = null;
  try {
    const res = await fetch(`data/strains/_genomes/${pathogenId}.json`, { cache: "no-store" });
    if (res.ok) data = await res.json();
  } catch {
    // ignore
  }
  genomeAnnotationCache.set(pathogenId, data);
  return data;
}

async function loadAndRenderStrainPanel(outbreakId) {
  const data = await loadStrainData(outbreakId);
  if (selectedId !== outbreakId) return; // user selected something else while this was in flight
  const wrap = document.getElementById("strain-panel-wrap");
  if (!wrap) return;

  if (!data || !data.matches?.length) {
    wrap.innerHTML = "";
    return;
  }

  const genome = await loadGenomeAnnotation(data.pathogen);
  if (selectedId !== outbreakId) return;
  const wrapNow = document.getElementById("strain-panel-wrap");
  if (!wrapNow) return;

  wrapNow.innerHTML = `
    <h3 style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin: 1.5rem 0 0.4rem;">
      Sequenced strain match${data.matches.length === 1 ? "" : "es"}
    </h3>
    <p class="muted-note" style="margin: 0 0 0.8rem;">
      Matched to this outbreak by country and collection date against public NCBI GenBank sequences —
      a heuristic association, not an official confirmation. See
      <a href="about.html#strains">methodology</a>.
    </p>
    <div id="strain-panel-body"></div>
  `;
  renderStrainPanel(document.getElementById("strain-panel-body"), data, genome);
}

function renderGenomeSvg(genome, mutations) {
  const width = 760;
  const height = 60;
  const trackY = 26;
  const trackH = 14;
  const len = genome.genomeLength;
  const mutatedGenes = new Set(mutations.map((m) => m.gene));

  const geneRects = genome.genes
    .map((g) => {
      const x1 = (Math.min(g.start, g.end) / len) * width;
      const x2 = (Math.max(g.start, g.end) / len) * width;
      const w = Math.max(x2 - x1, 0.6);
      const hit = mutatedGenes.has(g.name);
      const fill = hit ? "var(--accent)" : "var(--panel-2)";
      const label = `${g.name}${g.product ? " — " + g.product : ""}`;
      return `<rect class="genome-gene${hit ? " has-mut" : ""}" x="${x1.toFixed(2)}" y="${trackY}" width="${w.toFixed(2)}" height="${trackH}" fill="${fill}" data-tip="${escapeHtml(label)}"></rect>`;
    })
    .join("");

  const markers = mutations
    .map((m) => {
      const gene = genome.genes.find((g) => g.name === m.gene);
      if (!gene) return "";
      const aaLen = Math.max(1, Math.round((Math.abs(gene.end - gene.start) + 1) / 3));
      let frac = (m.position - 1) / aaLen;
      if (gene.strand === "-") frac = 1 - frac;
      frac = Math.min(1, Math.max(0, frac));
      const geneX1 = (Math.min(gene.start, gene.end) / len) * width;
      const geneX2 = (Math.max(gene.start, gene.end) / len) * width;
      const x = geneX1 + frac * (geneX2 - geneX1);
      const label = `${m.gene} ${m.change}${gene.product ? " — " + gene.product : ""}`;
      // Two overlapping lines (a wider pale halo under a thin dark core) so
      // the tick stays visible whether it lands on a mutated (orange) gene
      // rect or the plain background — a single flat color disappears
      // against one or the other depending on theme.
      return (
        `<line class="genome-mut-halo" x1="${x.toFixed(2)}" y1="${trackY - 5}" x2="${x.toFixed(2)}" y2="${trackY + trackH + 5}"></line>` +
        `<line class="genome-mut" x1="${x.toFixed(2)}" y1="${trackY - 5}" x2="${x.toFixed(2)}" y2="${trackY + trackH + 5}" data-tip="${escapeHtml(label)}"></line>`
      );
    })
    .join("");

  const geneCount = mutatedGenes.size;
  const summaryHtml = `
    <div class="genome-summary">
      <span><strong>${fmtNumber(mutations.length)}</strong> amino-acid difference${mutations.length === 1 ? "" : "s"}</span>
      <span>across <strong>${fmtNumber(geneCount)}</strong> gene${geneCount === 1 ? "" : "s"}</span>
      <span class="muted-note">of ${fmtNumber(genome.genes.length)} annotated</span>
    </div>
  `;

  return `
    ${summaryHtml}
    <div class="genome-map-wrap">
      <svg class="genome-map" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Genome map with mutation positions">
        <rect x="0" y="${trackY}" width="${width}" height="${trackH}" rx="2" fill="var(--border)" opacity="0.35"></rect>
        ${geneRects}
        ${markers}
        <text x="0" y="${trackY + trackH + 14}" class="genome-axis-label">0 bp</text>
        <text x="${width}" y="${trackY + trackH + 14}" class="genome-axis-label" text-anchor="end">${fmtNumber(len)} bp</text>
      </svg>
    </div>
    <div class="genome-legend">
      <span><span class="legend-swatch" style="background: var(--accent);"></span> gene with differences</span>
      <span><span class="legend-swatch" style="background: var(--panel-2); border: 1px solid var(--border);"></span> gene unchanged</span>
      <span><span class="legend-tick"></span> individual substitution — hover for detail</span>
    </div>
  `;
}

// Custom hover tooltip for the genome map (SVG's native <title> has an
// inconsistent, sluggish browser tooltip) — reuses the site's existing
// .chart-tooltip look from the trend charts so it feels like one system.
function attachGenomeTooltips(container) {
  const wrap = container.querySelector(".genome-map-wrap");
  if (!wrap) return;
  wrap.style.position = "relative";
  const tooltip = document.createElement("div");
  tooltip.className = "chart-tooltip";
  tooltip.style.opacity = 0;
  tooltip.style.transform = "translate(-50%, calc(-100% - 12px))";
  wrap.appendChild(tooltip);

  wrap.querySelectorAll("[data-tip]").forEach((el) => {
    el.addEventListener("mouseenter", () => {
      tooltip.innerHTML = `<div class="chart-tooltip-value">${escapeHtml(el.dataset.tip)}</div>`;
      tooltip.style.opacity = 1;
    });
    el.addEventListener("mousemove", (e) => {
      const rect = wrap.getBoundingClientRect();
      tooltip.style.left = `${e.clientX - rect.left}px`;
      tooltip.style.top = `${e.clientY - rect.top}px`;
    });
    el.addEventListener("mouseleave", () => {
      tooltip.style.opacity = 0;
    });
  });
}

const MUTATION_GROUPS_COLLAPSED = 12;

function renderMutationGroup(genome, geneName, muts) {
  const gene = genome.genes.find((g) => g.name === geneName);
  const product = gene?.product;
  const sorted = [...muts].sort((a, b) => a.position - b.position);
  const tags = sorted.map((m) => `<span class="mut-tag">${escapeHtml(m.change)}</span>`).join("");
  return `
    <div class="gene-mut-group">
      <div class="gene-mut-head">
        <strong>${escapeHtml(geneName)}</strong>
        ${
          product
            ? `<span class="gene-product">${escapeHtml(product)}</span>`
            : `<span class="gene-product muted">function not annotated in this dataset</span>`
        }
      </div>
      <div class="gene-mut-tags">${tags}</div>
    </div>
  `;
}

// Renders into `container` directly (rather than returning a string) so a
// long list — a divergent clade can easily touch 100+ mutated genes — can
// be collapsed behind a "show all" toggle instead of dumping a huge wall
// of near-identical boxes on first paint.
function renderMutationList(container, genome, mutations) {
  const byGene = new Map();
  for (const m of mutations) {
    if (!byGene.has(m.gene)) byGene.set(m.gene, []);
    byGene.get(m.gene).push(m);
  }
  const groups = [...byGene.entries()].sort((a, b) => {
    const ga = genome.genes.find((g) => g.name === a[0]);
    const gb = genome.genes.find((g) => g.name === b[0]);
    return (ga?.start ?? 0) - (gb?.start ?? 0);
  });

  const visible = groups.slice(0, MUTATION_GROUPS_COLLAPSED);
  const rest = groups.slice(MUTATION_GROUPS_COLLAPSED);

  container.innerHTML = visible.map(([name, muts]) => renderMutationGroup(genome, name, muts)).join("");

  if (rest.length) {
    const moreBtn = document.createElement("button");
    moreBtn.className = "show-more-genes-btn";
    moreBtn.textContent = `Show ${rest.length} more gene${rest.length === 1 ? "" : "s"} with differences`;
    moreBtn.addEventListener("click", () => {
      container.insertAdjacentHTML(
        "beforeend",
        rest.map(([name, muts]) => renderMutationGroup(genome, name, muts)).join("")
      );
      moreBtn.remove();
    });
    container.appendChild(moreBtn);
  }
}

function renderStrainPanel(container, strainData, genome) {
  const matches = strainData.matches;
  let activeIdx = 0;

  function paint() {
    const m = matches[activeIdx];
    const mutations = m.alignment?.mutations ?? [];

    const tabsHtml =
      matches.length > 1
        ? `<div class="strain-tabs">${matches
            .map((mm, i) => `<button class="strain-tab${i === activeIdx ? " active" : ""}" data-idx="${i}">${escapeHtml(mm.accession)}</button>`)
            .join("")}</div>`
        : "";

    const badge =
      m.confidence === "confirmed"
        ? `<span class="tag" style="border-color: var(--ok); color: var(--ok);">country + date match</span>`
        : `<span class="tag" style="border-color: var(--warning); color: var(--warning);">country match, date uncertain</span>`;

    const metaHtml = `
      <div class="detail-tags" style="margin-bottom: 0.7rem;">
        <a class="tag" href="https://www.ncbi.nlm.nih.gov/nuccore/${encodeURIComponent(m.accession)}" target="_blank" rel="noopener">${escapeHtml(m.accession)} ↗</a>
        <span class="tag">${escapeHtml(m.country)}</span>
        <span class="tag">collected ${escapeHtml(m.collectionDate ?? "unknown date")}</span>
        ${m.alignment?.clade ? `<span class="tag">clade ${escapeHtml(m.alignment.clade)}</span>` : ""}
        ${badge}
      </div>
    `;

    const hasMutations = genome && mutations.length;
    const emptyHtml = `<p class="muted-note">No amino-acid differences from the reference were called for this sequence${
      m.alignment?.qcStatus ? ` (QC: ${escapeHtml(m.alignment.qcStatus)})` : ""
    }.</p>`;

    container.innerHTML = `
      ${tabsHtml}
      ${metaHtml}
      ${hasMutations ? renderGenomeSvg(genome, mutations) : emptyHtml}
      ${hasMutations ? '<div class="gene-mut-list" id="gene-mut-list"></div>' : ""}
    `;
    container.querySelectorAll(".strain-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeIdx = Number(btn.dataset.idx);
        paint();
      });
    });
    if (hasMutations) {
      attachGenomeTooltips(container);
      renderMutationList(document.getElementById("gene-mut-list"), genome, mutations);
    }
  }

  paint();
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
            <span class="li-counts">${fmtNumber(d.total_current_week)} this week${trendIcon(d.national_trend)}</span>
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

  const cdcTrendPoints = d.national_series ? d.national_series.map((p) => ({ x: `wk ${p.week}`, y: p.value })) : [];
  const trendHtml = d.national_series
    ? `
      <h3 style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin: 1.5rem 0 0.4rem;">National weekly trend</h3>
      ${chartPlaceholder("cdc-trend-chart")}
    `
    : "";

  const whoLink = findWhoLinkBack(d.disease, "United States of America");

  detailEl.innerHTML = `
    <div class="detail-head">
      <h2>${escapeHtml(d.disease)}</h2>
      <div class="detail-tags">
        <span class="tag">MMWR week ${cdcFeed.week}, ${cdcFeed.year}</span>
        <span class="tag">${d.states_reporting} states reporting</span>
        ${trendTag(d.national_trend)}
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
  renderTrendChartInto("cdc-trend-chart", cdcTrendPoints, { valueFormat: fmtNumber });
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
            <span class="li-counts">${s.cases_reported != null ? fmtNumber(s.cases_reported) + " cases" : "No data"}${trendIcon(s.trend)}</span>
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
        ${s.trend_short ? `<span class="tag">InfoGripe: ${escapeHtml(s.trend_short)}</span>` : ""}
        ${trendTag(s.trend)}
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
          ${chartPlaceholder("br-trend-chart")}
        `
        : ""
    }
    ${findWhoLinkBack("influenza respiratory syndrome", "Brazil")}
  `;
  if (s.series && s.series.length >= 2) {
    renderTrendChartInto("br-trend-chart", s.series.map((p) => ({ x: `wk ${p.week}`, y: p.value })), { valueFormat: fmtNumber });
  }
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
            <span class="li-counts">${fmtNumber(r.latest_deaths)} deaths this week${trendIcon(r.trend)}</span>
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
        ${trendTag(r.trend)}
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
          ${chartPlaceholder("cl-trend-chart")}
        `
        : ""
    }
    ${renderCountryLinkBack("Chile")}
  `;
  if (r.series && r.series.length >= 2) {
    renderTrendChartInto("cl-trend-chart", r.series.map((p) => ({ x: `wk ${p.week}`, y: p.value })), { valueFormat: fmtNumber });
  }
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
      const trendPct = ukTrendPct(d);
      const trendLabel = Number.isFinite(trendPct) ? `${trendPct > 0 ? "+" : ""}${trendPct.toFixed(0)}% vs 4wk ago` : "new activity";
      return `
        <button class="list-item${isActive ? " active" : ""}" data-topic="${escapeHtml(d.topic)}">
          <div class="li-title">${escapeHtml(d.topic)}</div>
          <div class="li-meta"><span>${escapeHtml(ukMetricUnit(d.metric))}</span></div>
          <div class="li-meta">
            <span class="li-counts">${fmtNumber(Math.round(total * 100) / 100)}${trendIcon(trendFromPct(trendPct), { windowText: "4 weeks" })}</span>
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

  const ukTrend = ukNationalTrend(d);
  const ukTrendPoints = ukTrend?.points ?? null;
  const ukTrendLabel = ukTrend?.label ?? "";

  detailEl.innerHTML = `
    <div class="detail-head">
      <h2>${escapeHtml(d.topic)}</h2>
      <div class="detail-tags">
        <span class="tag">${escapeHtml(ukMetricUnit(d.metric))}</span>
        <span class="tag">as of ${fmtDate(d.latest_date)}</span>
        <span class="tag">England only</span>
        ${trendTag(trendFromPct(ukTrendPct(d)), { windowText: "4 weeks" })}
      </div>
    </div>
    <div class="stat-note">
      Metric: <code>${escapeHtml(d.metric)}</code>. UKHSA publishes several indicators
      per disease (test positivity, hospital admissions, syndromic rates, case counts);
      this is whichever one currently has the most recent data for this disease, so the
      unit differs disease to disease — always check before comparing across diseases.
    </div>
    ${ukTrendPoints ? `<h3 style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin: 1.5rem 0 0.4rem;">${ukTrendLabel}</h3>${chartPlaceholder("uk-trend-chart")}` : ""}
    ${findWhoLinkBack(d.topic, "United Kingdom")}
    <h3 style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin: 1.5rem 0 0.6rem;">By region</h3>
    <table class="state-table">
      <thead><tr><th>Region</th><th class="num">Latest</th><th class="num">4 weeks ago</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;
  if (ukTrendPoints) renderTrendChartInto("uk-trend-chart", ukTrendPoints, { valueFormat: fmtNumber });
  bindCrossLinkClicks();
}

// Returns { points, label } for the England-wide trend, or null if no
// region has enough history yet. Rate/percentage metrics (test
// positivity etc.) are averaged across regions; raw case-count metrics
// are summed — averaging a count or summing a rate would both be wrong.
function ukNationalTrend(d) {
  const withSeries = d.regions.filter((r) => r.series && r.series.length >= 2);
  if (withSeries.length === 0) return null;
  const length = Math.min(...withSeries.map((r) => r.series.length));
  const isRate = ukMetricUnit(d.metric) !== "cases";
  const points = [];
  for (let i = 0; i < length; i++) {
    const values = withSeries.map((r) => r.series[r.series.length - length + i]?.value ?? 0);
    const total = values.reduce((a, b) => a + b, 0);
    const date = withSeries[0].series[withSeries[0].series.length - length + i]?.date;
    points.push({ x: fmtDate(date), y: isRate ? total / values.length : total });
  }
  const label = isRate ? "England average, recent trend" : "England total, recent trend";
  return { points, label };
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
            <span class="li-counts">${fmtNumber(d.latest_total)}${trendIcon(d.national_trend)}</span>
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

  const jpTrendPoints = d.national_series ? d.national_series.map((p) => ({ x: `wk ${p.week}`, y: p.value })) : [];
  const hasJpTrend = jpTrendPoints.filter((p) => p.y !== null).length >= 2;
  const chartHtml = hasJpTrend
    ? `
      <h3 style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin: 1.5rem 0 0.4rem;">National weekly trend</h3>
      ${chartPlaceholder("jp-trend-chart")}
    `
    : "";

  detailEl.innerHTML = `
    <div class="detail-head">
      <h2>${escapeHtml(d.disease)}</h2>
      <div class="detail-tags">
        <span class="tag">${d.category === "sentinel" ? "Sentinel-site surveillance" : "All-case reporting"}</span>
        <span class="tag">week ${d.latest_week}, ${jpFeed.year}</span>
        <span class="tag">${d.prefectures_reporting} of 47 prefectures with cases</span>
        ${trendTag(d.national_trend)}
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
  if (hasJpTrend) renderTrendChartInto("jp-trend-chart", jpTrendPoints, { valueFormat: fmtNumber });
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
