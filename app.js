// Outbreak Watch frontend. Every data source is a "mode" in the MODES
// registry below: each mode describes how to load its feed, list and
// search its items, render a detail view, and color/label its map. All
// shared behavior — URL routing, lazy feed loading, sidebar rendering, map
// drawing, tooltips, keyboard access, the watchlist and the cross-source
// overview — is written once against that interface, so adding a source
// means adding one mode object plus its controls/legend/footer markup in
// index.html, not another copy of every function.

const ACTIVE_WINDOW_DAYS = 365;
const ACTIVE_CUTOFF = new Date(Date.now() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

const headerStatsEl = document.getElementById("header-stats");
const detailEl = document.getElementById("detail");
const mapTitleEl = document.getElementById("map-title");
const modeTabsEl = document.getElementById("mode-tabs");
const mapContainerEl = document.getElementById("map-container");
const sidebarEl = document.getElementById("sidebar");

let currentModeId = "who";
let dataStatus = null; // data/status.json — which sources' last fetch attempt succeeded

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function fmtNumber(n) {
  return n.toLocaleString();
}

function fmtRate(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n >= 100 ? fmtNumber(Math.round(n)) : n >= 10 ? n.toFixed(1) : n.toFixed(2);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function per100k(count, population) {
  if (count == null || !population) return null;
  return (count / population) * 100000;
}

const SECTION_HEADING_STYLE = "font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin: 1.5rem 0 0.4rem;";

// ---------- Storage ----------
// localStorage can be unavailable (private windows, blocked site data) or
// throw on access; everything stored here is a per-viewer convenience, so
// failures just mean the feature starts empty rather than breaking the page.

function storeGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function storeSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore — see above
  }
}

// "Since your last visit" needs a baseline that survives refreshes: the
// old approach overwrote the last-seen marker on every page load, so a
// single refresh wiped out every "new" badge. Instead, the first load in a
// browser session snapshots the previous visit's record into
// sessionStorage, and every load in that session compares against the same
// snapshot, while the persistent record is free to be updated as data loads.
const VISIT_KEY = "outbreak-watch:visit"; // { who_newest, items: { "<mode>/<key>": { value, asOf } } }
const BASELINE_SESSION_KEY = "outbreak-watch:visit-baseline";
const LEGACY_LAST_SEEN_KEY = "outbreak-watch:last-seen";

const visitBaseline = (() => {
  try {
    const saved = sessionStorage.getItem(BASELINE_SESSION_KEY);
    if (saved !== null) return JSON.parse(saved);
  } catch {
    // fall through to localStorage
  }
  let previous = storeGet(VISIT_KEY, null);
  if (!previous) {
    let legacy = null;
    try {
      legacy = localStorage.getItem(LEGACY_LAST_SEEN_KEY);
    } catch {
      // ignore
    }
    if (legacy) previous = { who_newest: legacy, items: {} };
  }
  try {
    sessionStorage.setItem(BASELINE_SESSION_KEY, JSON.stringify(previous));
  } catch {
    // ignore
  }
  return previous;
})();

const visitRecord = storeGet(VISIT_KEY, null) ?? { items: {} };
visitRecord.items ??= {};

function saveVisitRecord() {
  storeSet(VISIT_KEY, visitRecord);
}

// ---------- Trend charts ----------
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

function weeklySeriesPoints(series) {
  return (series ?? []).map((p) => ({ x: `wk ${p.week}`, y: p.value }));
}

// ---------- Trend labels ----------
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

// ---------- Shared detail-panel pieces ----------

function detailHead(mode, item, title, tagsHtml) {
  return `
    <div class="detail-head">
      <div class="detail-title-row">
        <h2>${escapeHtml(title)}</h2>
        <div class="detail-actions">
          ${watchButtonHtml(mode, item)}
          <button class="detail-action copy-link-btn" type="button">Copy link</button>
        </div>
      </div>
      <div class="detail-tags">${tagsHtml}</div>
    </div>
  `;
}

const CROSS_LINKS_SLOT = '<div id="cross-links-slot"></div>';

// Per-region table used by every disease-by-region mode. The per-100k
// column only appears when the feed carries populations for that source.
function regionTableHtml({ regionNoun, rows, columns, limit = 25 }) {
  const shown = rows.slice(0, limit);
  return `
    <h3 style="${SECTION_HEADING_STYLE} margin-bottom: 0.6rem;">By ${regionNoun}${rows.length > limit ? ` (top ${limit} of ${rows.length})` : ""}</h3>
    <table class="state-table">
      <thead><tr>${columns.map((c) => `<th${c.num ? ' class="num"' : ""}>${c.label}</th>`).join("")}</tr></thead>
      <tbody>${shown
        .map((r) => `<tr data-region="${escapeHtml(r.id)}">${columns.map((c) => `<td${c.num ? ' class="num"' : ""}>${c.cell(r)}</td>`).join("")}</tr>`)
        .join("")}</tbody>
    </table>
  `;
}

function hasPopulation(regions) {
  return regions.some((r) => r.population);
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
    const res = await fetch(`data/strains/${outbreakId}.json`);
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
    const res = await fetch(`data/strains/_genomes/${pathogenId}.json`);
    if (res.ok) data = await res.json();
  } catch {
    // ignore
  }
  genomeAnnotationCache.set(pathogenId, data);
  return data;
}

function isShowingOutbreak(outbreakId) {
  return currentModeId === "who" && MODE.who.selected === outbreakId;
}

async function loadAndRenderStrainPanel(outbreakId) {
  const data = await loadStrainData(outbreakId);
  if (!isShowingOutbreak(outbreakId)) return; // user selected something else while this was in flight
  const wrap = document.getElementById("strain-panel-wrap");
  if (!wrap) return;

  if (!data || !data.matches?.length) {
    wrap.innerHTML = "";
    return;
  }

  const genome = await loadGenomeAnnotation(data.pathogen);
  if (!isShowingOutbreak(outbreakId)) return;
  const wrapNow = document.getElementById("strain-panel-wrap");
  if (!wrapNow) return;

  wrapNow.innerHTML = `
    <h3 style="${SECTION_HEADING_STYLE}">
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

function crossLinkChip(modeId, target, text) {
  return `<button class="cross-link" type="button" data-mode="${modeId}" data-target="${escapeHtml(target ?? "")}">${escapeHtml(text)}</button>`;
}

function crossLinksBlock(label, chips) {
  if (!chips.length) return "";
  return `
    <div class="cross-links">
      <div class="cross-links-label">${label}</div>
      <div class="cross-links-row">${chips.join("")}</div>
    </div>
  `;
}

// Local-source links relevant to a WHO outbreak: each local mode with a
// `country` decides via its own crossLinkFrom() whether it has a match.
function whoCrossLinksHtml(ob) {
  if (ob.is_global) return "";
  const countryNames = new Set(ob.countries.map((c) => c.name));
  const chips = [];
  for (const mode of MODES) {
    if (!mode.country || !mode.crossLinkFrom || !countryNames.has(mode.country) || !mode.feed) continue;
    const match = mode.crossLinkFrom(ob);
    if (match) chips.push(crossLinkChip(mode.id, match.target, `${mode.label} → ${match.label}`));
  }
  return crossLinksBlock("Also tracked locally", chips);
}

// Reverse direction: from a local-source disease, find a matching WHO
// outbreak in the same country, so local detail panels can link back to
// the global picture too.
function whoLinkBackHtml(diseaseName, countryName) {
  const who = MODE.who;
  if (!who.feed) return "";
  const match = who.items.find(
    (ob) => !ob.is_global && ob.countries.some((c) => c.name === countryName) && diseaseKeywordMatch(diseaseName, ob.disease)
  );
  if (!match) return "";
  return crossLinksBlock("Also in the global outbreak feed", [crossLinkChip("who", match.id, `World (WHO) → ${match.disease}`)]);
}

// Country-only reverse link (for Chile mode, which isn't disease-specific
// so keyword matching doesn't apply — any active WHO outbreak in-country
// is potentially relevant context).
function countryLinkBackHtml(countryName) {
  const who = MODE.who;
  if (!who.feed) return "";
  const matches = who.items.filter((ob) => !ob.is_global && ob.countries.some((c) => c.name === countryName));
  return crossLinksBlock(
    "Active WHO outbreaks in this country",
    matches.slice(0, 5).map((ob) => crossLinkChip("who", ob.id, `World (WHO) → ${ob.disease}`))
  );
}

// Cross-links depend on *other* sources' feeds, which load in the
// background — so they live in their own slot that can be refilled when a
// feed arrives, without re-rendering (and re-scrolling) the whole panel.
function fillCrossLinks() {
  const slot = document.getElementById("cross-links-slot");
  if (!slot) return;
  const mode = currentMode();
  const item = selectedItem(mode);
  if (!item || !mode.crossLinksHtml) return;
  slot.innerHTML = mode.crossLinksHtml(item);
  slot.querySelectorAll(".cross-link").forEach((btn) => {
    btn.addEventListener("click", () => navigate(btn.dataset.mode, btn.dataset.target || null));
  });
}

// ---------- Map coloring helpers ----------

function hitColor(count) {
  if (count >= 3) return "var(--map-hit-3)";
  if (count === 2) return "var(--map-hit-2)";
  if (count === 1) return "var(--map-hit-1)";
  return "var(--map-land)";
}

const BR_INTENSITY_COLOR = {
  Segurança: "#3f7a5c",
  "Baixo risco": "#8bb08a",
  Alerta: "#e0c34f",
  Risco: "#e0883f",
  "Alto risco": "#b8461f",
};

function clColor(pct) {
  if (pct == null) return "var(--map-land)";
  const scale = d3.scaleDiverging(d3.interpolateRdBu).domain([40, 0, -40]);
  return scale(pct);
}

// ---------- Disease-by-region behavior ----------
// CDC, Germany, Japan and England all list diseases and color the map by
// the selected disease's per-region values. A mode opts in by defining
// regionsOf(item) -> [{ id, value, population? }] plus a few labels; this
// supplies its fill/tooltip/click behavior, including the per-100k toggle.

// Per-capita needs both a meaningful denominator for this disease (see
// jpMode.perCapitaApplies) and populations actually present in the feed.
function perCapitaAvailable(mode, item) {
  if (!item) return true;
  if (mode.perCapitaApplies && !mode.perCapitaApplies(item)) return false;
  return mode.regionsOf(item).some((r) => r.population);
}

function usePerCapita(mode, item) {
  return Boolean(mode.perCapitaEl?.checked && item && perCapitaAvailable(mode, item));
}

function regionMetric(mode, item, region) {
  return usePerCapita(mode, item) ? per100k(region.value, region.population) : region.value;
}

const diseaseByRegion = {
  regionLookup() {
    const item = selectedItem(this);
    return { item, byId: new Map((item ? this.regionsOf(item) : []).map((r) => [r.id, r])) };
  },
  hasData(id) {
    const { item, byId } = this.regionLookup();
    if (item) return byId.has(id);
    // With nothing selected, a region is clickable if any listed disease
    // has data there — clicking it picks that region's top disease.
    return this.regionIndex().has(id);
  },
  fill(id) {
    const { item, byId } = this.regionLookup();
    if (!item || !byId.has(id)) return "var(--map-land)";
    const values = [...byId.values()].map((r) => regionMetric(this, item, r)).filter((v) => v != null);
    const max = Math.max(1e-9, ...values);
    const v = regionMetric(this, item, byId.get(id));
    return v == null ? "var(--map-land)" : d3.scaleSequential(d3.interpolateOranges).domain([0, max])(v);
  },
  tooltip(id, name) {
    const { item, byId } = this.regionLookup();
    if (!item) {
      const count = this.regionIndex().get(id) ?? 0;
      return { title: name, lines: count ? [`${count} disease${count === 1 ? "" : "s"} with data — click for the top one`] : ["No data"] };
    }
    const r = byId.get(id);
    if (!r) return { title: name, lines: [`No ${this.title(item)} data`] };
    const lines = [`${fmtNumber(r.value)} ${this.valueLabel(item)}`];
    const rate = per100k(r.value, r.population);
    if (rate != null && perCapitaAvailable(this, item)) lines.push(`${fmtRate(rate)} per 100,000 residents`);
    return { title: name, lines };
  },
  clickRegion(id) {
    const item = selectedItem(this);
    if (item) {
      flashTableRow(id);
      return;
    }
    const top = this.topItemForRegion(id);
    if (top) navigate(this.id, this.key(top));
  },
  // region id -> number of diseases (in the current filtered list) with
  // data there. Cached per filtered list, since paintMap asks per region.
  regionIndex() {
    if (this.regionIndexFor !== this.visibleItems) {
      const counts = new Map();
      for (const item of this.visibleItems ?? []) {
        for (const r of this.regionsOf(item)) counts.set(r.id, (counts.get(r.id) ?? 0) + 1);
      }
      this.regionIndexCache = counts;
      this.regionIndexFor = this.visibleItems;
    }
    return this.regionIndexCache;
  },
  topItemForRegion(id) {
    return [...(this.visibleItems ?? [])]
      .map((item) => ({ item, r: this.regionsOf(item).find((r) => r.id === id) }))
      .filter((x) => x.r)
      .sort((a, b) => (b.r.value ?? 0) - (a.r.value ?? 0))[0]?.item;
  },
  legendBasis() {
    const item = selectedItem(this);
    return usePerCapita(this, item) ? "cases per 100,000 residents" : "case count";
  },
};

function flashTableRow(regionId) {
  const row = detailEl.querySelector(`tr[data-region="${CSS.escape(regionId)}"]`);
  if (!row) return;
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  row.classList.remove("flash");
  void row.offsetWidth; // restart the animation if it's already applied
  row.classList.add("flash");
}

// CDC and Germany publish the same shape (see scripts/fetch-cdc.mjs and
// scripts/fetch-germany.mjs), so they share list/detail rendering.
function weeklyCountsMode(cfg) {
  return {
    ...diseaseByRegion,
    sortOptions: true,
    perCapita: true,
    key: (d) => d.disease,
    title: (d) => d.disease,
    searchText: (d) => d.disease,
    searchSub: (d) => `${d.states_reporting} ${cfg.regionNounPlural} reporting`,
    ingest(feed) {
      this.items = feed.diseases;
    },
    filter(items, q) {
      return items.filter((d) => !q || d.disease.toLowerCase().includes(q));
    },
    sort(items, by) {
      if (by === "ytd") return [...items].sort((a, b) => b.total_ytd - a.total_ytd);
      if (by === "states") return [...items].sort((a, b) => b.states_reporting - a.states_reporting);
      return [...items].sort((a, b) => b.total_current_week - a.total_current_week);
    },
    listItemHtml(d) {
      return `
        <div class="li-title">${escapeHtml(d.disease)}</div>
        <div class="li-meta">
          <span>${d.states_reporting} ${d.states_reporting === 1 ? cfg.regionNoun : cfg.regionNounPlural} reporting</span>
        </div>
        <div class="li-meta">
          <span class="li-counts">${fmtNumber(d.total_current_week)} this week${trendIcon(d.national_trend)}</span>
          <span>·</span>
          <span>${fmtNumber(d.total_ytd)} YTD</span>
        </div>
      `;
    },
    regionsOf: (d) => d.states.map((s) => ({ id: s.id, name: s.name, value: s.current_week, population: s.population })),
    valueLabel: () => "cases this week",
    headline(d) {
      return { value: d.total_current_week, asOf: `${this.feed.year}-W${this.feed.week}`, text: `${fmtNumber(d.total_current_week)} cases this week` };
    },
    risingCandidates() {
      return this.items
        .filter((d) => d.national_trend?.trend === "rising" && d.total_current_week >= RISING_MIN_COUNT)
        .map((d) => ({ item: d, trend: d.national_trend, valueText: `${fmtNumber(d.total_current_week)} this week` }));
    },
    detail(d) {
      const hasPop = hasPopulation(d.states);
      const columns = [
        { label: cfg.regionNounTitle, cell: (s) => escapeHtml(s.name) },
        { label: "This week", num: true, cell: (s) => fmtNumber(s.current_week) },
        ...(hasPop ? [{ label: "Per 100k", num: true, cell: (s) => fmtRate(per100k(s.current_week, s.population)) }] : []),
        { label: "YTD", num: true, cell: (s) => fmtNumber(s.ytd) },
      ];
      return `
        ${detailHead(this, d, d.disease, `
          <span class="tag">${cfg.weekLabel(this.feed)}</span>
          <span class="tag">${d.states_reporting} ${cfg.regionNounPlural} reporting</span>
          ${trendTag(d.national_trend)}
        `)}
        <div class="stat-row">
          <div class="stat"><div class="n">${fmtNumber(d.total_current_week)}</div><div class="l">cases this week (provisional)</div></div>
          <div class="stat"><div class="n">${fmtNumber(d.total_ytd)}</div><div class="l">cumulative cases this year</div></div>
        </div>
        <div class="stat-note">${cfg.sourceNote(d)}</div>
        ${d.national_series ? `<h3 style="${SECTION_HEADING_STYLE}">National weekly trend</h3>${chartPlaceholder("trend-chart")}` : ""}
        ${CROSS_LINKS_SLOT}
        ${regionTableHtml({ regionNoun: cfg.regionNoun, rows: d.states, columns })}
      `;
    },
    afterDetail(d) {
      if (d.national_series) renderTrendChartInto("trend-chart", weeklySeriesPoints(d.national_series), { valueFormat: fmtNumber });
    },
    crossLinksHtml(d) {
      return whoLinkBackHtml(d.disease, this.country);
    },
    crossLinkFrom(ob) {
      const match = this.items.find((d) => diseaseKeywordMatch(ob.disease, d.disease));
      return match ? { target: match.disease, label: match.disease } : null;
    },
    ...cfg.overrides,
  };
}

// "Rising" in the cross-source overview ignores tiny counts, where a jump
// from 1 to 3 cases classifies as a steep rise but means very little.
const RISING_MIN_COUNT = 10;

// ---------- Modes ----------

const whoMode = {
  id: "who",
  label: "World (WHO)",
  feedUrl: "data/feed.json",
  mapTitle: "Active outbreaks by country",
  emptyText: "Select an outbreak on the left, or a highlighted country on the map, to see its full update timeline.",
  sortOptions: true,
  countryHitCounts: new Map(), // country id -> count of matching outbreaks (post-filter)
  ingest(feed) {
    this.items = feed.outbreaks;
    const newest = this.items.reduce((max, o) => (o.latest_update > max ? o.latest_update : max), "");
    if (newest) {
      visitRecord.who_newest = newest;
      saveVisitRecord();
    }
  },
  key: (ob) => ob.id,
  title: (ob) => ob.disease,
  searchText: (ob) => `${ob.disease} ${ob.countries.map((c) => c.name).join(" ")}`,
  searchSub: (ob) => whoCountryLabel(ob),
  filter(items, q) {
    const includeHistorical = document.getElementById("show-historical").checked;
    return items.filter((ob) => {
      if (!includeHistorical && ob.latest_update < ACTIVE_CUTOFF) return false;
      if (!q) return true;
      const haystack = `${ob.disease} ${ob.countries.map((c) => c.name).join(" ")} ${ob.updates
        .map((u) => u.title + " " + u.summary)
        .join(" ")}`.toLowerCase();
      return haystack.includes(q);
    });
  },
  sort(items, by) {
    if (by === "unread") {
      return [...items].sort((a, b) => {
        const aNew = isNewOutbreak(a) ? 1 : 0;
        const bNew = isNewOutbreak(b) ? 1 : 0;
        if (aNew !== bNew) return bNew - aNew;
        return b.latest_update.localeCompare(a.latest_update);
      });
    }
    if (by === "count") return [...items].sort((a, b) => b.update_count - a.update_count);
    if (by === "cases") return [...items].sort((a, b) => (b.latest_counts?.cases ?? -1) - (a.latest_counts?.cases ?? -1));
    return [...items].sort((a, b) => b.latest_update.localeCompare(a.latest_update));
  },
  afterFilter(visible) {
    this.countryHitCounts = new Map();
    for (const ob of visible) {
      for (const c of ob.countries) this.countryHitCounts.set(c.id, (this.countryHitCounts.get(c.id) ?? 0) + 1);
    }
  },
  listItemClass: (ob) => (isNewOutbreak(ob) ? "is-new" : ""),
  listItemHtml(ob) {
    const countsLabel = ob.latest_counts
      ? `${fmtNumber(ob.latest_counts.cases)} cases${ob.latest_counts.deaths ? ` · ${fmtNumber(ob.latest_counts.deaths)} deaths` : ""}`
      : "";
    return `
      <div class="li-title">${escapeHtml(ob.disease)}</div>
      <div class="li-meta">
        <span>${escapeHtml(whoCountryLabel(ob))}</span>
      </div>
      <div class="li-meta">
        <span>${ob.update_count} update${ob.update_count === 1 ? "" : "s"}</span>
        <span>·</span>
        <span>${fmtDate(ob.latest_update)}</span>
        ${countsLabel ? `<span class="li-counts">${countsLabel}${trendIcon(ob.trend)}</span>` : ""}
      </div>
    `;
  },
  detail(ob) {
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

    const hasChart = this.casePoints(ob).filter((p) => p.y !== null).length >= 2;

    return `
      ${detailHead(this, ob, ob.disease, `
        <span class="tag">${escapeHtml(whoCountryLabel(ob))}</span>
        <span class="tag">first seen ${fmtDate(ob.first_seen)}</span>
        <span class="tag">${ob.update_count} update${ob.update_count === 1 ? "" : "s"}</span>
        ${trendTag(ob.trend)}
      `)}
      ${statsHtml}
      ${hasChart ? `<h3 style="${SECTION_HEADING_STYLE}">Cumulative cases over time</h3>${chartPlaceholder("trend-chart")}` : ""}
      ${CROSS_LINKS_SLOT}
      <div id="strain-panel-wrap"></div>
      <h3 style="${SECTION_HEADING_STYLE} margin-bottom: 0.6rem;">Update timeline</h3>
      ${updatesHtml}
    `;
  },
  casePoints(ob) {
    const chronological = [...ob.updates].sort((a, b) => a.date.localeCompare(b.date));
    return chronological.map((u) => ({ x: fmtDate(u.date), y: u.counts?.cases ?? null }));
  },
  afterDetail(ob) {
    renderTrendChartInto("trend-chart", this.casePoints(ob), { valueFormat: fmtNumber });
    loadAndRenderStrainPanel(ob.id);
  },
  crossLinksHtml: (ob) => whoCrossLinksHtml(ob),
  headerStats() {
    const activeCount = this.items.filter((o) => o.latest_update >= ACTIVE_CUTOFF).length;
    return `<span><b>${activeCount}</b> active</span><span><b>${this.items.length}</b> total tracked</span><span>Updated ${fmtDate(this.feed.generated_at)}</span>`;
  },
  headline(ob) {
    const text = ob.latest_counts ? `${fmtNumber(ob.latest_counts.cases)} cases` : `${ob.update_count} update${ob.update_count === 1 ? "" : "s"}`;
    return { value: ob.latest_counts?.cases ?? ob.update_count, asOf: ob.latest_update, text, asOfText: `updated ${fmtDate(ob.latest_update)}` };
  },
  risingCandidates() {
    return this.items
      .filter((ob) => ob.latest_update >= ACTIVE_CUTOFF && ob.trend?.trend === "rising")
      .map((ob) => ({ item: ob, trend: ob.trend, valueText: ob.latest_counts ? `${fmtNumber(ob.latest_counts.cases)} cumulative cases` : "" }));
  },
  map: {
    url: "data/countries-110m.json",
    features: (topo) => topojson.feature(topo, topo.objects.countries).features,
    aspect: 0.55,
    projection: () => d3.geoNaturalEarth1(),
    id: (f) => String(f.id).padStart(3, "0"),
    name: (f) => f.properties.name,
  },
  hasData(id) {
    return (this.countryHitCounts.get(id) ?? 0) > 0;
  },
  fill(id) {
    return hitColor(this.countryHitCounts.get(id) ?? 0);
  },
  isRegionSelected(id) {
    return (selectedItem(this)?.countries ?? []).some((c) => c.id === id);
  },
  tooltip(id, name) {
    const matches = (this.visibleItems ?? []).filter((ob) => ob.countries.some((c) => c.id === id));
    if (!matches.length) return { title: name, lines: ["No outbreaks in the current list"] };
    const lines = [`${matches.length} outbreak${matches.length === 1 ? "" : "s"}:`, ...matches.slice(0, 4).map((ob) => ob.disease)];
    if (matches.length > 4) lines.push(`+${matches.length - 4} more`);
    return { title: name, lines };
  },
  clickRegion(id) {
    const match = (this.visibleItems ?? []).find((ob) => ob.countries.some((c) => c.id === id));
    if (match) navigate(this.id, match.id);
  },
};

function whoCountryLabel(ob) {
  return ob.is_global ? "Multi-country / global" : ob.countries.map((c) => c.name).join(", ") || "Location unspecified";
}

function isNewOutbreak(ob) {
  return Boolean(visitBaseline?.who_newest && ob.latest_update > visitBaseline.who_newest);
}

const cdcMode = weeklyCountsMode({
  regionNoun: "state",
  regionNounPlural: "states",
  regionNounTitle: "State",
  weekLabel: (feed) => `MMWR week ${feed.week}, ${feed.year}`,
  sourceNote: () => "Source: CDC NNDSS weekly tables. Most recent week is provisional and will revise upward as more reports come in.",
  overrides: {
    id: "cdc",
    label: "United States (CDC)",
    country: "United States of America",
    feedUrl: "data/cdc-feed.json",
    mapTitle: "US notifiable diseases by state",
    emptyText: "Select a notifiable disease on the left, or a state on the map, to see its state-by-state breakdown.",
    headerStats() {
      return `<span><b>${this.feed.disease_count}</b> notifiable diseases active</span><span>MMWR week ${this.feed.week}, ${this.feed.year}</span><span>Updated ${fmtDate(this.feed.generated_at)}</span>`;
    },
    map: {
      url: "data/us-states-10m.json",
      features: (topo) => topojson.feature(topo, topo.objects.states).features,
      aspect: 0.62,
      projection: () => d3.geoAlbersUsa(),
      id: (f) => String(f.id).padStart(2, "0"),
      name: (f) => f.properties.name,
    },
  },
});

const deMode = weeklyCountsMode({
  regionNoun: "state",
  regionNounPlural: "states",
  regionNounTitle: "State",
  weekLabel: (feed) => `Reporting week ${feed.week}, ${feed.year}`,
  sourceNote: (d) =>
    `Source: RKI SurvStat, counted by the week the case was notified to the health office. The most recent week is provisional and will revise upward as reports arrive.${
      /Landes(melde)?verordnung/.test(d.disease)
        ? " <strong>Notifiable only under individual states' own regulations</strong> — states without one report nothing here, which doesn't mean zero cases."
        : ""
    }`,
  overrides: {
    id: "de",
    label: "Germany (RKI)",
    country: "Germany",
    feedUrl: "data/de-feed.json",
    mapTitle: "Germany notifiable diseases by state",
    emptyText: "Select a notifiable disease on the left, or a state on the map, to see its state-by-state breakdown.",
    headerStats() {
      return `<span><b>${this.feed.disease_count}</b> notifiable diseases active</span><span>Reporting week ${this.feed.week}, ${this.feed.year}</span><span>Updated ${fmtDate(this.feed.generated_at)}</span>`;
    },
    map: {
      url: "data/de-states-geo.json",
      features: (geo) => geo.features,
      aspect: 1.25,
      projection: () => d3.geoMercator(),
      id: (f) => f.properties.ags,
      name: (f) => f.properties.display_name,
    },
  },
});

const brMode = {
  id: "br",
  label: "Brazil (InfoGripe)",
  country: "Brazil",
  feedUrl: "data/br-feed.json",
  mapTitle: "Brazil SRAG risk level by state",
  emptyText: "Select a state on the left, or on the map, for its SRAG surveillance detail.",
  sortOptions: true,
  ingest(feed) {
    this.items = feed.states;
  },
  key: (s) => s.id,
  title: (s) => s.name,
  searchText: (s) => `${s.name} ${s.abbr}`,
  searchSub: (s) => s.intensity ?? "No data",
  filter(items, q) {
    return items.filter((s) => !q || s.name.toLowerCase().includes(q) || s.abbr.toLowerCase().includes(q));
  },
  sort(items, by) {
    const intensityRank = { "Alto risco": 4, Risco: 3, Alerta: 2, "Baixo risco": 1, Segurança: 0 };
    if (by === "intensity") return [...items].sort((a, b) => (intensityRank[b.intensity] ?? -1) - (intensityRank[a.intensity] ?? -1));
    if (by === "name") return [...items].sort((a, b) => a.name.localeCompare(b.name));
    return [...items].sort((a, b) => (b.cases_reported ?? 0) - (a.cases_reported ?? 0));
  },
  listItemHtml(s) {
    return `
      <div class="li-title">${escapeHtml(s.name)} (${escapeHtml(s.abbr)})</div>
      <div class="li-meta">
        <span>${escapeHtml(s.intensity ?? "No data")}</span>
      </div>
      <div class="li-meta">
        <span class="li-counts">${s.cases_reported != null ? fmtNumber(s.cases_reported) + " cases" : "No data"}${trendIcon(s.trend)}</span>
        ${s.trend_short ? `<span>· ${escapeHtml(s.trend_short)}</span>` : ""}
      </div>
    `;
  },
  detail(s) {
    const incidence = per100k(s.cases_reported, s.population);
    const hasChart = s.series && s.series.length >= 2;
    return `
      ${detailHead(this, s, s.name, `
        <span class="tag">Epi. week ${this.feed.epidemiological_week}, ${this.feed.epidemiological_year}</span>
        <span class="tag" style="border-color: ${BR_INTENSITY_COLOR[s.intensity] ?? "var(--border)"}">${escapeHtml(s.intensity ?? "No data")}</span>
        ${s.trend_short ? `<span class="tag">InfoGripe: ${escapeHtml(s.trend_short)}</span>` : ""}
        ${trendTag(s.trend)}
      `)}
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
      ${hasChart ? `<h3 style="${SECTION_HEADING_STYLE}">Weekly cases, last ${s.series.length} weeks</h3>${chartPlaceholder("trend-chart")}` : ""}
      ${CROSS_LINKS_SLOT}
    `;
  },
  afterDetail(s) {
    if (s.series && s.series.length >= 2) renderTrendChartInto("trend-chart", weeklySeriesPoints(s.series), { valueFormat: fmtNumber });
  },
  crossLinksHtml: () => whoLinkBackHtml("influenza respiratory syndrome", "Brazil"),
  crossLinkFrom(ob) {
    return diseaseKeywordMatch(ob.disease, "influenza respiratory") ? { target: null, label: "SRAG (severe respiratory illness) surveillance" } : null;
  },
  headerStats() {
    return `<span><b>${this.items.length}</b> states tracked</span><span>Epi. week ${this.feed.epidemiological_week}, ${this.feed.epidemiological_year}</span><span>Updated ${fmtDate(this.feed.generated_at)}</span>`;
  },
  headline(s) {
    return {
      value: s.cases_reported,
      asOf: `${this.feed.epidemiological_year}-W${this.feed.epidemiological_week}`,
      text: s.cases_reported != null ? `${fmtNumber(s.cases_reported)} SRAG cases this week` : "No data",
    };
  },
  risingCandidates() {
    return this.items
      .filter((s) => s.trend?.trend === "rising" && (s.cases_reported ?? 0) >= RISING_MIN_COUNT)
      .map((s) => ({ item: s, trend: s.trend, valueText: `${fmtNumber(s.cases_reported)} SRAG cases this week` }));
  },
  map: {
    url: "data/br-states-geo.json",
    features: (geo) => geo.features,
    aspect: 0.9,
    projection: () => d3.geoMercator(),
    id: (f) => String(f.properties.codarea).padStart(2, "0"),
    name(f) {
      return MODE.br.items?.find((s) => s.id === String(f.properties.codarea).padStart(2, "0"))?.name ?? f.properties.codarea;
    },
  },
  hasData(id) {
    return this.items.some((s) => s.id === id);
  },
  fill(id) {
    const s = this.items.find((x) => x.id === id);
    return s?.intensity ? BR_INTENSITY_COLOR[s.intensity] ?? "var(--map-land)" : "var(--map-land)";
  },
  isRegionSelected(id) {
    return this.selected === id;
  },
  tooltip(id, name) {
    const s = this.items.find((x) => x.id === id);
    if (!s) return { title: name, lines: ["No data"] };
    return { title: s.name, lines: [s.intensity ?? "No risk level", s.cases_reported != null ? `${fmtNumber(s.cases_reported)} SRAG cases this week` : "No case data"] };
  },
  clickRegion(id) {
    if (this.hasData(id)) navigate(this.id, id);
  },
};

const clMode = {
  id: "cl",
  label: "Chile (DEIS)",
  country: "Chile",
  feedUrl: "data/cl-feed.json",
  mapTitle: "Chile all-cause mortality by region",
  emptyText: "Select a region on the left, or on the map, for its mortality detail.",
  sortOptions: true,
  ingest(feed) {
    this.items = feed.regions;
  },
  key: (r) => r.id,
  title: (r) => r.name,
  searchText: (r) => r.name,
  searchSub: (r) => `${fmtNumber(r.latest_deaths)} deaths this week`,
  filter(items, q) {
    return items.filter((r) => !q || r.name.toLowerCase().includes(q));
  },
  sort(items, by) {
    if (by === "deaths") return [...items].sort((a, b) => b.latest_deaths - a.latest_deaths);
    if (by === "name") return [...items].sort((a, b) => a.name.localeCompare(b.name));
    return [...items].sort((a, b) => (b.pct_vs_baseline ?? -Infinity) - (a.pct_vs_baseline ?? -Infinity));
  },
  pctLabel(r) {
    return r.pct_vs_baseline != null ? `${r.pct_vs_baseline > 0 ? "+" : ""}${r.pct_vs_baseline.toFixed(1)}% vs baseline` : "";
  },
  listItemHtml(r) {
    const pctLabel = this.pctLabel(r);
    return `
      <div class="li-title">${escapeHtml(r.name)}</div>
      <div class="li-meta">
        <span class="li-counts">${fmtNumber(r.latest_deaths)} deaths this week${trendIcon(r.trend)}</span>
        ${pctLabel ? `<span>· ${pctLabel}</span>` : ""}
      </div>
    `;
  },
  detail(r) {
    const incidence = per100k(r.latest_deaths, r.population);
    const hasChart = r.series && r.series.length >= 2;
    return `
      ${detailHead(this, r, r.name, `
        <span class="tag">Epi. week ${this.feed.epidemiological_week}, ${this.feed.epidemiological_year}</span>
        <span class="tag">All-cause mortality</span>
        ${trendTag(r.trend)}
      `)}
      <div class="stat-row">
        <div class="stat"><div class="n">${fmtNumber(r.latest_deaths)}</div><div class="l">deaths this week</div></div>
        ${
          r.baseline_avg_deaths != null
            ? `<div class="stat"><div class="n">${r.baseline_avg_deaths.toFixed(0)}</div><div class="l">${this.feed.baseline_week_count}-week baseline avg</div></div>`
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
      ${hasChart ? `<h3 style="${SECTION_HEADING_STYLE}">Weekly deaths, last ${r.series.length} weeks</h3>${chartPlaceholder("trend-chart")}` : ""}
      ${CROSS_LINKS_SLOT}
    `;
  },
  afterDetail(r) {
    if (r.series && r.series.length >= 2) renderTrendChartInto("trend-chart", weeklySeriesPoints(r.series), { valueFormat: fmtNumber });
  },
  crossLinksHtml: () => countryLinkBackHtml("Chile"),
  crossLinkFrom() {
    return { target: null, label: "weekly mortality data" };
  },
  headerStats() {
    return `<span><b>${this.items.length}</b> regions tracked</span><span>Epi. week ${this.feed.epidemiological_week}, ${this.feed.epidemiological_year}</span><span>Updated ${fmtDate(this.feed.generated_at)}</span>`;
  },
  headline(r) {
    return {
      value: r.latest_deaths,
      asOf: `${this.feed.epidemiological_year}-W${this.feed.epidemiological_week}`,
      text: `${fmtNumber(r.latest_deaths)} deaths this week`,
    };
  },
  risingCandidates() {
    return this.items
      .filter((r) => r.trend?.trend === "rising")
      .map((r) => ({ item: r, trend: r.trend, valueText: `${fmtNumber(r.latest_deaths)} deaths this week (all-cause)` }));
  },
  map: {
    url: "data/cl-regions-topo.json",
    features: (topo) => topojson.feature(topo, topo.objects[Object.keys(topo.objects)[0]]).features,
    aspect: 1.35,
    projection: () => d3.geoMercator(),
    id: (f) => f.properties.region_key,
    name(f) {
      return MODE.cl.items?.find((r) => r.id === f.properties.region_key)?.name ?? f.properties.display_name;
    },
  },
  hasData(id) {
    return this.items.some((r) => r.id === id);
  },
  fill(id) {
    const r = this.items.find((x) => x.id === id);
    return r ? clColor(r.pct_vs_baseline) : "var(--map-land)";
  },
  isRegionSelected(id) {
    return this.selected === id;
  },
  tooltip(id, name) {
    const r = this.items.find((x) => x.id === id);
    if (!r) return { title: name, lines: ["No data"] };
    return { title: r.name, lines: [`${fmtNumber(r.latest_deaths)} deaths this week`, this.pctLabel(r)].filter(Boolean) };
  },
  clickRegion(id) {
    if (this.hasData(id)) navigate(this.id, id);
  },
};

function ukNationalTotal(disease, field) {
  return disease.regions.reduce((sum, r) => sum + (r[field] ?? 0), 0);
}

function ukTrendPct(disease) {
  const now = ukNationalTotal(disease, "latest_value");
  const before = ukNationalTotal(disease, "value_4_weeks_ago");
  if (!before) return now > 0 ? Infinity : 0;
  return ((now - before) / before) * 100;
}

function ukMetricUnit(metricName) {
  if (metricName.includes("positivity")) return "% test positivity";
  if (metricName.includes("Rate")) return "rate";
  if (metricName.includes("cases")) return "cases";
  return "value";
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

const ukMode = {
  ...diseaseByRegion,
  id: "uk",
  label: "England (UKHSA)",
  country: "United Kingdom",
  feedUrl: "data/uk-feed.json",
  mapTitle: "England notifiable diseases by region",
  emptyText: "Select a disease on the left, or a region on the map, for its regional breakdown.",
  sortOptions: true,
  ingest(feed) {
    this.items = feed.diseases;
  },
  key: (d) => d.topic,
  title: (d) => d.topic,
  searchText: (d) => d.topic,
  searchSub: (d) => ukMetricUnit(d.metric),
  filter(items, q) {
    return items.filter((d) => !q || d.topic.toLowerCase().includes(q));
  },
  sort(items, by) {
    if (by === "trend") return [...items].sort((a, b) => ukTrendPct(b) - ukTrendPct(a));
    if (by === "name") return [...items].sort((a, b) => a.topic.localeCompare(b.topic));
    return [...items].sort((a, b) => ukNationalTotal(b, "latest_value") - ukNationalTotal(a, "latest_value"));
  },
  listItemHtml(d) {
    const total = ukNationalTotal(d, "latest_value");
    const trendPct = ukTrendPct(d);
    const trendLabel = Number.isFinite(trendPct) ? `${trendPct > 0 ? "+" : ""}${trendPct.toFixed(0)}% vs 4wk ago` : "new activity";
    return `
      <div class="li-title">${escapeHtml(d.topic)}</div>
      <div class="li-meta"><span>${escapeHtml(ukMetricUnit(d.metric))}</span></div>
      <div class="li-meta">
        <span class="li-counts">${fmtNumber(Math.round(total * 100) / 100)}${trendIcon(trendFromPct(trendPct), { windowText: "4 weeks" })}</span>
        <span>· ${trendLabel}</span>
      </div>
    `;
  },
  detail(d) {
    const rows = [...d.regions].sort((a, b) => b.latest_value - a.latest_value);
    const trend = ukNationalTrend(d);
    return `
      ${detailHead(this, d, d.topic, `
        <span class="tag">${escapeHtml(ukMetricUnit(d.metric))}</span>
        <span class="tag">as of ${fmtDate(d.latest_date)}</span>
        <span class="tag">England only</span>
        ${trendTag(trendFromPct(ukTrendPct(d)), { windowText: "4 weeks" })}
      `)}
      <div class="stat-note">
        Metric: <code>${escapeHtml(d.metric)}</code>. UKHSA publishes several indicators
        per disease (test positivity, hospital admissions, syndromic rates, case counts);
        this is whichever one currently has the most recent data for this disease, so the
        unit differs disease to disease — always check before comparing across diseases.
      </div>
      ${trend ? `<h3 style="${SECTION_HEADING_STYLE}">${trend.label}</h3>${chartPlaceholder("trend-chart")}` : ""}
      ${CROSS_LINKS_SLOT}
      ${regionTableHtml({
        regionNoun: "region",
        rows,
        limit: Infinity,
        columns: [
          { label: "Region", cell: (r) => escapeHtml(r.name) },
          { label: "Latest", num: true, cell: (r) => fmtNumber(r.latest_value) },
          { label: "4 weeks ago", num: true, cell: (r) => (r.value_4_weeks_ago != null ? fmtNumber(r.value_4_weeks_ago) : "—") },
        ],
      })}
    `;
  },
  afterDetail(d) {
    const trend = ukNationalTrend(d);
    if (trend) renderTrendChartInto("trend-chart", trend.points, { valueFormat: fmtNumber });
  },
  crossLinksHtml(d) {
    return whoLinkBackHtml(d.topic, "United Kingdom");
  },
  crossLinkFrom(ob) {
    const match = this.items.find((d) => diseaseKeywordMatch(ob.disease, d.topic));
    return match ? { target: match.topic, label: match.topic } : null;
  },
  headerStats() {
    return `<span><b>${this.items.length}</b> diseases tracked</span><span>England, 9 regions</span><span>Updated ${fmtDate(this.feed.generated_at)}</span>`;
  },
  headline(d) {
    const total = Math.round(ukNationalTotal(d, "latest_value") * 100) / 100;
    return { value: total, asOf: d.latest_date, text: `${fmtNumber(total)} (${ukMetricUnit(d.metric)})`, asOfText: `as of ${fmtDate(d.latest_date)}` };
  },
  risingCandidates() {
    return this.items
      .map((d) => ({ d, trend: trendFromPct(ukTrendPct(d)) }))
      .filter(({ trend }) => trend?.trend === "rising")
      .map(({ d, trend }) => ({ item: d, trend, windowText: "4 weeks", valueText: `${ukMetricUnit(d.metric)}, vs 4 weeks ago` }));
  },
  regionsOf: (d) => d.regions.map((r) => ({ id: r.id, name: r.name, value: r.latest_value })),
  valueLabel: (d) => `(${ukMetricUnit(d.metric)})`,
  legendBasis: () => "value",
  // England's indicators aren't comparable across diseases (see the metric
  // note), so "top disease in this region" isn't meaningful here; clicking
  // a region with nothing selected picks the first listed disease there.
  topItemForRegion(id) {
    return (this.visibleItems ?? []).find((d) => d.regions.some((r) => r.id === id));
  },
  map: {
    url: "data/uk-regions-topo.json",
    features: (topo) => topojson.feature(topo, topo.objects[Object.keys(topo.objects)[0]]).features,
    aspect: 1.3,
    projection: () => d3.geoMercator(),
    id: (f) => f.properties.region_key,
    name: (f) => f.properties.display_name,
  },
};

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

const jpMode = {
  ...diseaseByRegion,
  id: "jp",
  label: "Japan (JIHS)",
  country: "Japan",
  feedUrl: "data/jp-feed.json",
  mapTitle: "Japan notifiable diseases by prefecture",
  emptyText: "Select a disease on the left, or a prefecture on the map, for its prefecture-by-prefecture breakdown.",
  sortOptions: true,
  perCapita: true,
  ingest(feed) {
    this.items = feed.diseases;
  },
  key: (d) => d.disease,
  title: (d) => d.disease,
  searchText: (d) => d.disease,
  searchSub: (d) => (d.category === "sentinel" ? "sentinel-site count" : "all-case reporting"),
  filter(items, q) {
    return items.filter((d) => !q || d.disease.toLowerCase().includes(q));
  },
  sort(items, by) {
    if (by === "trend") return [...items].sort((a, b) => jpTrendPct(b) - jpTrendPct(a));
    if (by === "name") return [...items].sort((a, b) => a.disease.localeCompare(b.disease));
    return [...items].sort((a, b) => (b.latest_total ?? 0) - (a.latest_total ?? 0));
  },
  listItemHtml(d) {
    const trend = jpTrendPct(d);
    const trendLabel = Number.isFinite(trend) ? `${trend > 0 ? "+" : ""}${trend.toFixed(0)}% vs 12wk ago` : "new activity";
    return `
      <div class="li-title">${escapeHtml(d.disease)}</div>
      <div class="li-meta"><span>${d.category === "sentinel" ? "sentinel-site count" : "all-case reporting"}</span></div>
      <div class="li-meta">
        <span class="li-counts">${fmtNumber(d.latest_total)}${trendIcon(d.national_trend)}</span>
        <span>· ${trendLabel}</span>
      </div>
    `;
  },
  detail(d) {
    const points = weeklySeriesPoints(d.national_series);
    const hasChart = points.filter((p) => p.y !== null).length >= 2;
    const showRate = this.perCapitaApplies(d) && hasPopulation(d.prefectures);
    const rows = [...d.prefectures].sort((a, b) => (b.current_week ?? 0) - (a.current_week ?? 0));
    return `
      ${detailHead(this, d, d.disease, `
        <span class="tag">${d.category === "sentinel" ? "Sentinel-site surveillance" : "All-case reporting"}</span>
        <span class="tag">week ${d.latest_week}, ${this.feed.year}</span>
        <span class="tag">${d.prefectures_reporting} of 47 prefectures with cases</span>
        ${trendTag(d.national_trend)}
      `)}
      <div class="stat-row">
        <div class="stat"><div class="n">${fmtNumber(d.latest_total)}</div><div class="l">${d.category === "sentinel" ? "cases (sentinel sites)" : "cases (all-case reporting)"}</div></div>
      </div>
      <div class="stat-note">
        ${
          d.category === "sentinel"
            ? "Sentinel-site count: reported from a fixed network of clinics, not a national total — actual case counts nationwide are higher. Useful for tracking trend direction, not absolute burden, which is also why no per-capita rate is shown."
            : "All-case (mandatory) reporting: this is a comprehensive national count, not sampled."
        }
        Source: JIHS IDWR, provisional and subject to revision.
      </div>
      ${hasChart ? `<h3 style="${SECTION_HEADING_STYLE}">National weekly trend</h3>${chartPlaceholder("trend-chart")}` : ""}
      ${CROSS_LINKS_SLOT}
      ${regionTableHtml({
        regionNoun: "prefecture",
        rows,
        columns: [
          { label: "Prefecture", cell: (p) => escapeHtml(jpPrefName(p.id)) },
          { label: "This week", num: true, cell: (p) => (p.current_week != null ? fmtNumber(p.current_week) : "—") },
          ...(showRate ? [{ label: "Per 100k", num: true, cell: (p) => fmtRate(per100k(p.current_week, p.population)) }] : []),
        ],
      })}
    `;
  },
  afterDetail(d) {
    const points = weeklySeriesPoints(d.national_series);
    if (points.filter((p) => p.y !== null).length >= 2) renderTrendChartInto("trend-chart", points, { valueFormat: fmtNumber });
  },
  crossLinksHtml(d) {
    return whoLinkBackHtml(d.disease, "Japan");
  },
  crossLinkFrom(ob) {
    const match = this.items.find((d) => diseaseKeywordMatch(ob.disease, d.disease));
    return match ? { target: match.disease, label: match.disease } : null;
  },
  headerStats() {
    return `<span><b>${this.items.length}</b> diseases tracked</span><span>Japan, 47 prefectures, week ${this.feed.week}</span><span>Updated ${fmtDate(this.feed.generated_at)}</span>`;
  },
  headline(d) {
    return { value: d.latest_total, asOf: `${this.feed.year}-W${d.latest_week}`, text: `${fmtNumber(d.latest_total)} cases this week` };
  },
  risingCandidates() {
    return this.items
      .filter((d) => d.national_trend?.trend === "rising" && (d.latest_total ?? 0) >= RISING_MIN_COUNT)
      .map((d) => ({ item: d, trend: d.national_trend, valueText: `${fmtNumber(d.latest_total)} this week${d.category === "sentinel" ? " (sentinel sites)" : ""}` }));
  },
  regionsOf: (d) => d.prefectures.map((p) => ({ id: p.id, name: jpPrefName(p.id), value: p.current_week ?? 0, population: p.population })),
  valueLabel: (d) => (d.category === "sentinel" ? "cases this week (sentinel sites)" : "cases this week"),
  // Sentinel counts are a sample from a fixed clinic network, not a count
  // of everyone — dividing them by total population would look like an
  // incidence rate while not being one.
  perCapitaApplies: (d) => d.category !== "sentinel",
  map: {
    url: "data/jp-prefectures-topo.json",
    features(topo) {
      const features = topojson.feature(topo, topo.objects[Object.keys(topo.objects)[0]]).features;
      features.forEach((f) => jpPrefNames.set(f.properties.pref_id, f.properties.display_name));
      return features;
    },
    aspect: 1.1,
    projection: () => d3.geoMercator(),
    id: (f) => f.properties.pref_id,
    name: (f) => f.properties.display_name,
  },
};

const MODES = [whoMode, cdcMode, brMode, clMode, ukMode, jpMode, deMode];
const MODE = Object.fromEntries(MODES.map((m) => [m.id, m]));

function currentMode() {
  return MODE[currentModeId];
}

function selectedItem(mode) {
  if (!mode.feed || mode.selected == null) return null;
  return mode.items.find((item) => mode.key(item) === mode.selected) ?? null;
}

// ---------- DOM scaffolding ----------
// Tabs, map wrappers and sidebar lists are generated per mode; the
// content-heavy per-mode markup (controls, legend, footer) lives in
// index.html under ids following the controls-<id> / legend-<id> /
// footer-<id> convention.

for (const mode of MODES) {
  mode.items = [];
  mode.selected = null;
  mode.feed = null;
  mode.error = null;

  const tab = document.createElement("button");
  tab.className = "mode-tab";
  tab.type = "button";
  tab.textContent = mode.label;
  tab.addEventListener("click", () => navigate(mode.id, mode.selected));
  modeTabsEl.appendChild(tab);
  mode.tabEl = tab;

  const mapWrap = document.createElement("div");
  mapWrap.hidden = true;
  mapContainerEl.appendChild(mapWrap);
  mode.mapWrapEl = mapWrap;

  const list = document.createElement("div");
  list.className = "outbreak-list";
  list.hidden = true;
  list.innerHTML = '<p class="list-status">Loading…</p>';
  sidebarEl.appendChild(list);
  mode.listEl = list;

  mode.controlsEl = document.getElementById(`controls-${mode.id}`);
  mode.legendEl = document.getElementById(`legend-${mode.id}`);
  mode.footerEl = document.getElementById(`footer-${mode.id}`);
  mode.searchEl = document.getElementById(`search-${mode.id}`);
  mode.sortEl = document.getElementById(`sort-${mode.id}`);
  mode.perCapitaEl = document.getElementById(`percap-${mode.id}`);

  mode.searchEl?.addEventListener("input", () => renderList(mode));
  mode.sortEl?.addEventListener("change", () => renderList(mode));
  mode.perCapitaEl?.addEventListener("change", () => {
    paintMap(mode);
    updateLegend(mode);
  });
}
document.getElementById("show-historical").addEventListener("change", () => renderList(MODE.who));

const mapTooltipEl = document.createElement("div");
mapTooltipEl.className = "chart-tooltip map-tooltip";
mapTooltipEl.style.opacity = 0;
mapTooltipEl.setAttribute("aria-hidden", "true");
mapContainerEl.appendChild(mapTooltipEl);

// ---------- Feed loading ----------
// Only the active mode's feed is on the critical path. The rest load in
// parallel once it has rendered: they're still needed (cross-links,
// unified search, the overview), but no longer block first paint, and the
// browser's normal HTTP cache handles repeat visits — these files change
// once a day, so the old `cache: "no-store"` only forced redundant
// downloads.

function loadFeed(mode) {
  if (!mode.loadPromise) {
    mode.loadPromise = fetch(mode.feedUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`${mode.feedUrl}: HTTP ${res.status}`);
        return res.json();
      })
      .then((feed) => {
        mode.feed = feed;
        mode.ingest(feed);
        onFeedLoaded(mode);
      })
      .catch((err) => {
        mode.error = err;
        console.error(err);
        if (mode.id === currentModeId) renderModeView(mode);
      });
  }
  return mode.loadPromise;
}

let backgroundRefreshTimer = null;

function onFeedLoaded(mode) {
  recordWatchSnapshots(mode);
  if (mode.id === currentModeId) {
    renderModeView(mode);
    ensureMap(mode);
    if (mode.selected != null && pendingScroll) scrollToDetail(false);
    return;
  }
  // Another source arrived in the background: refresh only the parts of
  // the current view that read from other feeds.
  clearTimeout(backgroundRefreshTimer);
  backgroundRefreshTimer = setTimeout(() => {
    const cur = currentMode();
    if (selectedItem(cur)) fillCrossLinks();
    else if (cur.feed || cur.selected == null) renderDetail();
    if (!globalSearchResultsEl.hidden) renderGlobalSearchResults();
  }, 60);
}

function loadRemainingFeeds() {
  for (const mode of MODES) loadFeed(mode);
}

// ---------- Maps ----------
// Built lazily the first time a mode is shown, so each map measures its
// real (visible) width instead of a hidden container's zero.

function ensureMap(mode) {
  if (mode.mapBuilt || !mode.feed || mode.mapWrapEl.hidden) return;
  mode.mapBuilt = true;
  d3.json(mode.map.url)
    .then((data) => buildMap(mode, data))
    .catch((err) => {
      mode.mapBuilt = false;
      console.error(err);
    });
}

function buildMap(mode, data) {
  const cfg = mode.map;
  // Sorted by name so keyboard focus moves through regions alphabetically
  // rather than in the source file's arbitrary order.
  const features = cfg.features(data).sort((a, b) => String(cfg.name(a)).localeCompare(String(cfg.name(b))));
  const collection = { type: "FeatureCollection", features };

  const width = mode.mapWrapEl.clientWidth || 640;
  const height = width * cfg.aspect;
  const projection = cfg.projection().fitSize([width - 4, height - 4], collection);
  const pathGenerator = d3.geoPath(projection);

  const svg = d3
    .select(mode.mapWrapEl)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .attr("role", "group")
    .attr("aria-label", mode.mapTitle);

  mode.paths = svg
    .append("g")
    .selectAll("path")
    .data(features)
    .join("path")
    .attr("class", "country-path")
    .attr("data-id", (f) => cfg.id(f))
    .attr("d", pathGenerator)
    .attr("fill", "var(--map-land)")
    .on("pointermove", (event, f) => showMapTooltip(mode, f, event.clientX, event.clientY))
    .on("pointerleave", hideMapTooltip)
    .on("focus", function (event, f) {
      const box = this.getBoundingClientRect();
      showMapTooltip(mode, f, box.left + box.width / 2, box.top + box.height / 2);
    })
    .on("blur", hideMapTooltip)
    .on("click", (event, f) => {
      const id = cfg.id(f);
      if (mode.hasData(id)) mode.clickRegion(id);
    })
    .on("keydown", (event, f) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      const id = cfg.id(f);
      if (mode.hasData(id)) mode.clickRegion(id);
    });

  paintMap(mode);
}

// Colors every region and keeps its interactivity in sync with the data:
// only regions that do something on click are focusable buttons (with a
// spoken label carrying the same text as the hover tooltip); the rest are
// hidden from assistive tech rather than adding hundreds of dead stops.
function paintMap(mode) {
  if (!mode.paths) return;
  const cfg = mode.map;
  mode.paths.each(function (f) {
    const id = cfg.id(f);
    const active = mode.hasData(id);
    this.setAttribute("fill", mode.fill(id));
    this.classList.toggle("has-outbreak", active);
    this.classList.toggle("selected", Boolean(mode.isRegionSelected?.(id)));
    if (active) {
      const tip = mode.tooltip(id, cfg.name(f));
      this.setAttribute("tabindex", "0");
      this.setAttribute("role", "button");
      this.setAttribute("aria-label", [tip.title, ...tip.lines].join(". "));
      this.removeAttribute("aria-hidden");
    } else {
      this.removeAttribute("tabindex");
      this.removeAttribute("role");
      this.removeAttribute("aria-label");
      this.setAttribute("aria-hidden", "true");
    }
  });
}

function showMapTooltip(mode, feature, clientX, clientY) {
  const tip = mode.tooltip(mode.map.id(feature), mode.map.name(feature));
  mapTooltipEl.innerHTML = `<div class="chart-tooltip-value"></div>${tip.lines.map(() => '<div class="chart-tooltip-label"></div>').join("")}`;
  mapTooltipEl.firstElementChild.textContent = tip.title;
  [...mapTooltipEl.querySelectorAll(".chart-tooltip-label")].forEach((el, i) => (el.textContent = tip.lines[i]));
  const rect = mapContainerEl.getBoundingClientRect();
  mapTooltipEl.style.left = `${clientX - rect.left}px`;
  mapTooltipEl.style.top = `${clientY - rect.top}px`;
  mapTooltipEl.style.opacity = 1;
}

function hideMapTooltip() {
  mapTooltipEl.style.opacity = 0;
}

function updateLegend(mode) {
  const basisEl = mode.legendEl?.querySelector("[data-legend-basis]");
  if (basisEl && mode.legendBasis) basisEl.textContent = mode.legendBasis();
  if (mode.perCapitaEl) {
    const item = selectedItem(mode);
    const available = perCapitaAvailable(mode, item);
    mode.perCapitaEl.disabled = !available;
    mode.perCapitaEl.closest("label").title = available
      ? ""
      : mode.perCapitaApplies && item && !mode.perCapitaApplies(item)
        ? "Not available for sentinel-site counts, which are a sample rather than a population count"
        : "No population data in this feed yet";
  }
}

// ---------- Sidebar, detail, header ----------

function renderList(mode) {
  if (!mode.feed) {
    mode.listEl.innerHTML = mode.error
      ? `<p class="list-status">Could not load the ${escapeHtml(mode.label)} feed. Try again shortly.</p>`
      : '<p class="list-status">Loading…</p>';
    return;
  }
  const q = (mode.searchEl?.value ?? "").trim().toLowerCase();
  const visible = mode.sort(mode.filter(mode.items, q), mode.sortEl?.value);
  mode.visibleItems = visible;
  mode.afterFilter?.(visible);
  paintMap(mode);

  if (visible.length === 0) {
    mode.listEl.innerHTML = '<p class="list-status">No matches.</p>';
    return;
  }

  mode.listEl.innerHTML = visible
    .map((item) => {
      const key = mode.key(item);
      const classes = ["list-item", mode.listItemClass?.(item), key === mode.selected ? "active" : ""].filter(Boolean).join(" ");
      return `<button class="${classes}" type="button" data-key="${escapeHtml(key)}"${key === mode.selected ? ' aria-current="true"' : ""}>${mode.listItemHtml(item)}</button>`;
    })
    .join("");

  mode.listEl.querySelectorAll(".list-item").forEach((btn) => {
    btn.addEventListener("click", () => navigate(mode.id, btn.dataset.key));
  });
}

function renderDetail() {
  const mode = currentMode();
  if (mode.selected != null && !mode.feed && !mode.error) {
    detailEl.innerHTML = '<p class="muted-note">Loading…</p>';
    return;
  }
  const item = selectedItem(mode);
  if (!item) {
    renderOverview(mode);
    return;
  }
  detailEl.innerHTML = mode.detail(item);
  mode.afterDetail?.(item);
  bindDetailActions(mode, item);
  fillCrossLinks();
}

function sourceHealthBadge(sourceId) {
  if (!dataStatus) return "";
  const entry = dataStatus.sources.find((s) => s.id === sourceId);
  if (!entry || entry.outcome === "success") return "";
  return `<span class="health-warning" title="The most recent scheduled update for this source failed — showing the last successful data.">⚠ update failed, showing last good data</span>`;
}

// The dashboard's data updates on a daily cron with no human watching it
// run — if a source's site changes format and its fetch script starts
// failing, the page would otherwise look completely normal while quietly
// showing data that's stopped updating. This surfaces that failure state
// instead of hiding it: data/status.json records whether each source's
// most recent fetch attempt actually succeeded (see the workflow's
// continue-on-error steps), independent of whether the displayed data
// itself is still the last good run.
function renderHeaderStats() {
  const mode = currentMode();
  if (!mode.feed) {
    headerStatsEl.innerHTML = mode.error ? `<span>Could not load ${escapeHtml(mode.label)}</span>` : "Loading…";
    return;
  }
  headerStatsEl.innerHTML = mode.headerStats() + sourceHealthBadge(mode.id);
}

function renderModeView(mode) {
  renderList(mode);
  renderDetail();
  renderHeaderStats();
  updateLegend(mode);
  updateDocumentTitle();
}

function updateDocumentTitle() {
  const mode = currentMode();
  const item = selectedItem(mode);
  document.title = item ? `${mode.title(item)} — ${mode.label} — Outbreak Watch` : mode.id === "who" ? "Outbreak Watch" : `${mode.label} — Outbreak Watch`;
}

function showMode(modeId) {
  currentModeId = modeId;
  hideMapTooltip();
  for (const mode of MODES) {
    const on = mode.id === modeId;
    mode.tabEl.classList.toggle("active", on);
    mode.tabEl.setAttribute("aria-pressed", String(on));
    mode.mapWrapEl.hidden = !on;
    mode.listEl.hidden = !on;
    for (const el of [mode.controlsEl, mode.legendEl, mode.footerEl]) if (el) el.hidden = !on;
  }
  mapTitleEl.textContent = currentMode().mapTitle;
}

// ---------- Detail actions: watch + copy link ----------

const WATCHLIST_KEY = "outbreak-watch:watchlist"; // [{ mode, key, label }]

function getWatchlist() {
  const list = storeGet(WATCHLIST_KEY, []);
  return Array.isArray(list) ? list.filter((w) => MODE[w.mode]) : [];
}

function isWatched(modeId, key) {
  return getWatchlist().some((w) => w.mode === modeId && w.key === key);
}

function watchButtonHtml(mode, item) {
  const on = isWatched(mode.id, mode.key(item));
  return `<button class="detail-action watch-btn${on ? " on" : ""}" type="button" aria-pressed="${on}">${on ? "★ Watching" : "☆ Watch"}</button>`;
}

function toggleWatch(mode, item) {
  const key = mode.key(item);
  let list = getWatchlist();
  if (list.some((w) => w.mode === mode.id && w.key === key)) {
    list = list.filter((w) => !(w.mode === mode.id && w.key === key));
  } else {
    list.push({ mode: mode.id, key, label: mode.title(item) });
  }
  storeSet(WATCHLIST_KEY, list);
  recordWatchSnapshots(mode);
}

function bindDetailActions(mode, item) {
  const watchBtn = detailEl.querySelector(".watch-btn");
  watchBtn?.addEventListener("click", () => {
    toggleWatch(mode, item);
    watchBtn.outerHTML = watchButtonHtml(mode, item);
    bindDetailActions(mode, item);
  });
  const copyBtn = detailEl.querySelector(".copy-link-btn");
  if (copyBtn && !copyBtn.dataset.bound) {
    copyBtn.dataset.bound = "1";
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(location.href);
        copyBtn.textContent = "Link copied";
      } catch {
        copyBtn.textContent = "Copy failed — use the address bar";
      }
      setTimeout(() => (copyBtn.textContent = "Copy link"), 2000);
    });
  }
}

// Saves each watched item's current headline into the persistent visit
// record, so the *next* session's baseline can say what changed.
function recordWatchSnapshots(mode) {
  if (!mode.feed || !mode.headline) return;
  let changed = false;
  for (const w of getWatchlist()) {
    if (w.mode !== mode.id) continue;
    const item = mode.items.find((i) => mode.key(i) === w.key);
    if (!item) continue;
    const h = mode.headline(item);
    visitRecord.items[`${w.mode}/${w.key}`] = { value: h.value, asOf: h.asOf, text: h.text };
    changed = true;
  }
  if (changed) saveVisitRecord();
}

// ---------- Overview: watchlist + rising across sources ----------
// Shown in the detail area whenever nothing is selected, which used to be
// a single line of "select something" text.

function renderOverview(mode) {
  const missing = mode.selected != null && mode.feed && !selectedItem(mode);
  detailEl.innerHTML = `
    ${
      missing
        ? `<p class="notice">“${escapeHtml(mode.selected)}” isn't in the current ${escapeHtml(mode.label)} data — it may have dropped out of the latest report.</p>`
        : ""
    }
    <p style="color: var(--muted); font-size: 0.9rem; margin-top: 0;">${mode.emptyText}</p>
    <section class="overview-section">
      <h2 class="overview-heading">Your watchlist</h2>
      ${watchlistHtml()}
    </section>
    <section class="overview-section">
      <h2 class="overview-heading">Rising now, across all sources</h2>
      <p class="muted-note" style="margin-top: 0;">
        Everything currently classified as rising from its own recent series (same
        regression-based classification as the ▲ icons; see
        <a href="about.html">methodology</a>), ignoring counts under ${RISING_MIN_COUNT}.
        Units differ by source — compare within a source, not across them.
      </p>
      ${risingHtml()}
    </section>
  `;
  detailEl.querySelectorAll("[data-nav-mode]").forEach((el) => {
    el.addEventListener("click", () => navigate(el.dataset.navMode, el.dataset.navKey));
  });
  detailEl.querySelectorAll("[data-unwatch-mode]").forEach((el) => {
    el.addEventListener("click", () => {
      storeSet(
        WATCHLIST_KEY,
        getWatchlist().filter((w) => !(w.mode === el.dataset.unwatchMode && w.key === el.dataset.unwatchKey))
      );
      renderDetail();
    });
  });
}

function watchlistHtml() {
  const list = getWatchlist();
  if (!list.length) {
    return `<p class="muted-note">Nothing watched yet. Open any outbreak, disease or region and press <strong>☆ Watch</strong> to pin it here — you'll see what changed since your last visit.</p>`;
  }
  const rows = list.map((w) => {
    const mode = MODE[w.mode];
    const item = mode.feed ? mode.items.find((i) => mode.key(i) === w.key) : null;
    let status;
    if (!mode.feed) status = '<span class="muted-note">loading…</span>';
    else if (!item) status = '<span class="muted-note">not in the current data</span>';
    else {
      const h = mode.headline(item);
      const before = visitBaseline?.items?.[`${w.mode}/${w.key}`];
      let change = "";
      if (before && before.asOf !== h.asOf) {
        change = `<span class="watch-change">new data since your last visit${before.text && before.text !== h.text ? ` (was ${escapeHtml(before.text)})` : ""}</span>`;
      } else if (before) {
        change = '<span class="muted-note">no new data since your last visit</span>';
      }
      status = `<span class="li-counts">${escapeHtml(h.text)}</span>${h.asOfText ? ` <span class="muted-note">${escapeHtml(h.asOfText)}</span>` : ""} ${change}`;
    }
    return `
      <li class="overview-row">
        <button class="overview-link" type="button" data-nav-mode="${w.mode}" data-nav-key="${escapeHtml(w.key)}">${escapeHtml(w.label)}</button>
        <span class="overview-source">${escapeHtml(mode.label)}</span>
        <span class="overview-status">${status}</span>
        <button class="overview-remove" type="button" data-unwatch-mode="${w.mode}" data-unwatch-key="${escapeHtml(w.key)}" aria-label="Stop watching ${escapeHtml(w.label)}">×</button>
      </li>
    `;
  });
  return `<ul class="overview-list">${rows.join("")}</ul>`;
}

const RISING_PER_SOURCE = 5;

function risingHtml() {
  const groups = MODES.map((mode) => {
    if (mode.error) return `<div class="rising-group"><h3>${escapeHtml(mode.label)}</h3><p class="muted-note">Feed failed to load.</p></div>`;
    if (!mode.feed) return `<div class="rising-group"><h3>${escapeHtml(mode.label)}</h3><p class="muted-note">Loading…</p></div>`;
    const candidates = mode
      .risingCandidates()
      .sort((a, b) => (b.trend.percent_change ?? -Infinity) - (a.trend.percent_change ?? -Infinity));
    if (!candidates.length) return `<div class="rising-group"><h3>${escapeHtml(mode.label)}</h3><p class="muted-note">Nothing currently classified as rising.</p></div>`;
    const rows = candidates.slice(0, RISING_PER_SOURCE).map((c) => {
      const pct = c.trend.percent_change;
      const pctText = pct == null ? "" : `${pct > 0 ? "+" : ""}${pct}% ${c.windowText ? `over ${c.windowText}` : "vs previous"}`;
      return `
        <li class="overview-row">
          <button class="overview-link" type="button" data-nav-mode="${mode.id}" data-nav-key="${escapeHtml(mode.key(c.item))}">${trendIcon(c.trend, { windowText: c.windowText })} ${escapeHtml(mode.title(c.item))}</button>
          <span class="overview-status"><span class="muted-note">${escapeHtml(c.valueText)}${pctText ? ` · ${pctText}` : ""}</span></span>
        </li>
      `;
    });
    const more = candidates.length > RISING_PER_SOURCE ? `<p class="muted-note">+${candidates.length - RISING_PER_SOURCE} more rising in this source</p>` : "";
    return `<div class="rising-group"><h3>${escapeHtml(mode.label)}</h3><ul class="overview-list">${rows.join("")}</ul>${more}</div>`;
  });
  return groups.join("");
}

// ---------- Routing ----------
// The URL hash carries the mode and selection (#/cdc/Pertussis), so any
// view can be shared, bookmarked, or reached with back/forward. Hashes
// that don't start with "#/" (the skip link's #main-layout) aren't routes.

let pendingScroll = false;

function parseRoute(hash) {
  const m = /^#\/([a-z]+)(?:\/(.*))?$/.exec(hash);
  if (!m || !MODE[m[1]]) return { modeId: "who", key: null };
  let key = null;
  if (m[2]) {
    try {
      key = decodeURIComponent(m[2]);
    } catch {
      key = null;
    }
  }
  return { modeId: m[1], key };
}

function routeHash(modeId, key) {
  return `#/${modeId}${key != null ? "/" + encodeURIComponent(key) : ""}`;
}

function navigate(modeId, key) {
  const hash = routeHash(modeId, key ?? null);
  if (location.hash !== hash) history.pushState(null, "", hash);
  applyRoute({ modeId, key: key ?? null }, { scroll: key != null });
}

function applyRoute({ modeId, key }, { scroll }) {
  const mode = MODE[modeId];
  const modeChanged = modeId !== currentModeId || !mode.tabEl.classList.contains("active");
  mode.selected = key;
  if (modeChanged) showMode(modeId);
  loadFeed(mode);
  renderModeView(mode);
  ensureMap(mode);
  if (scroll) {
    if (mode.feed) scrollToDetail(true);
    else pendingScroll = true;
  }
}

function scrollToDetail(smooth) {
  pendingScroll = false;
  detailEl.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
}

window.addEventListener("popstate", () => {
  if (location.hash && !location.hash.startsWith("#/")) return;
  applyRoute(parseRoute(location.hash), { scroll: false });
});

document.getElementById("home-link").addEventListener("click", (e) => {
  e.preventDefault();
  navigate(currentModeId, null);
  window.scrollTo({ top: 0, behavior: "smooth" });
});

// ---------- Unified search ----------

const globalSearchEl = document.getElementById("global-search");
const globalSearchResultsEl = document.getElementById("global-search-results");
const GSR_LIMIT_PER_SOURCE = 6;

function globalSearch(query) {
  const q = query.trim().toLowerCase();
  if (!q) return { groups: [], pending: [] };
  const groups = [];
  const pending = [];
  for (const mode of MODES) {
    if (!mode.feed) {
      if (!mode.error) pending.push(mode.label);
      continue;
    }
    const items = mode.items
      .filter((item) => mode.searchText(item).toLowerCase().includes(q))
      .slice(0, GSR_LIMIT_PER_SOURCE)
      .map((item) => ({ label: mode.title(item), sub: mode.searchSub(item), modeId: mode.id, key: mode.key(item) }));
    if (items.length) groups.push({ label: mode.label, items });
  }
  return { groups, pending };
}

function renderGlobalSearchResults() {
  if (globalSearchEl.value.trim() === "") {
    globalSearchResultsEl.hidden = true;
    globalSearchResultsEl.innerHTML = "";
    return;
  }

  const { groups, pending } = globalSearch(globalSearchEl.value);
  const pendingHtml = pending.length ? `<div class="gsr-empty">Still loading: ${escapeHtml(pending.join(", "))}</div>` : "";

  if (groups.length === 0) {
    globalSearchResultsEl.innerHTML = (pending.length ? "" : '<div class="gsr-empty">No matches across any source.</div>') + pendingHtml;
    globalSearchResultsEl.hidden = false;
    return;
  }

  globalSearchResultsEl.innerHTML =
    groups
      .map(
        (g) => `
          <div class="gsr-group-label">${escapeHtml(g.label)}</div>
          ${g.items
            .map(
              (item) => `
                <button class="gsr-item" type="button" data-mode="${item.modeId}" data-key="${escapeHtml(item.key)}">
                  ${escapeHtml(item.label)}
                  <span class="gsr-sub">${escapeHtml(item.sub)}</span>
                </button>
              `
            )
            .join("")}
        `
      )
      .join("") + pendingHtml;
  globalSearchResultsEl.hidden = false;

  globalSearchResultsEl.querySelectorAll(".gsr-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      navigate(btn.dataset.mode, btn.dataset.key);
      globalSearchResultsEl.hidden = true;
      globalSearchEl.value = "";
    });
  });
}

globalSearchEl.addEventListener("input", renderGlobalSearchResults);
globalSearchEl.addEventListener("focus", () => {
  loadRemainingFeeds();
  renderGlobalSearchResults();
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".global-search-wrap")) globalSearchResultsEl.hidden = true;
});
globalSearchEl.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    globalSearchResultsEl.hidden = true;
    globalSearchEl.blur();
  }
});

// ---------- Init ----------

function init() {
  fetch("data/status.json", { cache: "no-store" })
    .then((res) => (res.ok ? res.json() : null))
    .then((status) => {
      dataStatus = status;
      renderHeaderStats();
    })
    .catch(() => {
      // status.json may not exist yet (e.g. local dev before any deploy) — silently skip
    });

  const route = parseRoute(location.hash);
  // Normalize a non-route hash (or none) without adding a history entry.
  if (location.hash.startsWith("#/") && location.hash !== routeHash(route.modeId, route.key)) {
    history.replaceState(null, "", routeHash(route.modeId, route.key));
  }
  applyRoute(route, { scroll: route.key != null });
  loadFeed(currentMode()).then(() => {
    const idle = window.requestIdleCallback ?? ((fn) => setTimeout(fn, 200));
    idle(loadRemainingFeeds);
  });
}

init();
