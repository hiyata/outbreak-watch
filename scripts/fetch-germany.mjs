// Pulls Germany's notifiable-disease surveillance data from RKI's SurvStat
// (Robert Koch Institute, https://survstat.rki.de) and writes a
// per-disease, per-state breakdown with a 12-week national series to
// data/de-feed.json — the same shape as data/cdc-feed.json.
//
// SurvStat has no REST API: its web UI is backed by a SOAP/OLAP web
// service. The request format below was recovered from the open-source R
// package rsurvstat (github.com/bristol-vaccine-centre/rsurvstat), which
// had already reverse-engineered it; it turns out to be plain XML over an
// HTTP POST, so no SOAP library is needed. The service accepts two
// dimensions per query (rows x columns) plus filters, so this asks for
// reporting week (rows) x disease (columns), filtered to one federal state
// at a time — 16 requests per run.
//
// Disease names are passed through exactly as SurvStat's English catalogue
// labels them — some are only available in German, and some carry an
// "(e)" prefix whose meaning RKI doesn't document in the service or its
// manual, so it's shown as-is rather than guessed at. Diseases notifiable
// only under individual states' own regulations ("Landesmeldeverordnung")
// legitimately have no data in states without that regulation; a missing
// state means "not reported there", never "zero cases".

import { computeTrend } from "./lib/trend.mjs";
import { DE_STATE_POPULATION } from "./lib/populations.mjs";

const ENDPOINT = "https://tools.rki.de/SurvStat/SurvStatWebService.svc";
const HISTORY_WEEKS = 12;

// AGS (Amtlicher Gemeindeschlüssel) state codes — SurvStat's FedStateKey71
// members, and the "ags" property in data/de-states-geo.json.
const DE_STATES = {
  "01": "Schleswig-Holstein",
  "02": "Hamburg",
  "03": "Lower Saxony",
  "04": "Bremen",
  "05": "North Rhine-Westphalia",
  "06": "Hesse",
  "07": "Rhineland-Palatinate",
  "08": "Baden-Württemberg",
  "09": "Bavaria",
  "10": "Saarland",
  "11": "Berlin",
  "12": "Brandenburg",
  "13": "Mecklenburg-Western Pomerania",
  "14": "Saxony",
  "15": "Saxony-Anhalt",
  "16": "Thuringia",
};

function filterXml(dimensionId, hierarchyId, values) {
  return `<rki:KeyValueOfFilterCollectionKeyFilterMemberCollectionb2rWaiIW>
    <rki:Key><rki:DimensionId>${dimensionId}</rki:DimensionId><rki:HierarchyId>${hierarchyId}</rki:HierarchyId></rki:Key>
    <rki:Value>${values.map((v) => `<rki:string>${v}</rki:string>`).join("")}</rki:Value>
  </rki:KeyValueOfFilterCollectionKeyFilterMemberCollectionb2rWaiIW>`;
}

function olapRequest({ years, stateId }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:sur="http://tools.rki.de/SurvStat/" xmlns:rki="http://schemas.datacontract.org/2004/07/Rki.SurvStat.WebService.Contracts.Mdx">
  <soap:Header xmlns:wsa="http://www.w3.org/2005/08/addressing">
    <wsa:To>${ENDPOINT}</wsa:To>
    <wsa:Action>http://tools.rki.de/SurvStat/SurvStatWebService/GetOlapData</wsa:Action>
  </soap:Header>
  <soap:Body>
    <sur:GetOlapData>
      <sur:request>
        <rki:ColumnHierarchy>[PathogenOut].[KategorieNz].[Krankheit DE]</rki:ColumnHierarchy>
        <rki:Cube>SurvStat</rki:Cube>
        <rki:HierarchyFilters>
          ${filterXml("[ReportingDate]", "[ReportingDate].[WeekYear]", years.map((y) => `[ReportingDate].[WeekYear].&amp;[${y}]`))}
          ${filterXml("[DeutschlandNodes].[Kreise71Web]", "[DeutschlandNodes].[Kreise71Web].[FedStateKey71]", [`[DeutschlandNodes].[Kreise71Web].[FedStateKey71].&amp;[${stateId}]`])}
        </rki:HierarchyFilters>
        <rki:IncludeNullColumns>true</rki:IncludeNullColumns>
        <rki:IncludeNullRows>true</rki:IncludeNullRows>
        <rki:IncludeTotalColumn>false</rki:IncludeTotalColumn>
        <rki:IncludeTotalRow>false</rki:IncludeTotalRow>
        <rki:Language>English</rki:Language>
        <rki:Measures>Count</rki:Measures>
        <rki:RowHierarchy>[ReportingDate].[YearWeek]</rki:RowHierarchy>
      </sur:request>
    </sur:GetOlapData>
  </soap:Body>
</soap:Envelope>`;
}

function decodeXml(str) {
  return str
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

// Parses a GetOlapData response into { columns: [disease], rows: [{ year, week, values: [number|null] }] }.
// Regex rather than a DOM parser to keep the zero-dependency rule; the
// response is machine-generated with a fixed, flat element structure.
function parseOlap(xml) {
  const columns = [...xml.matchAll(/<b:QueryResultColumn><b:Caption>([^<]*)<\/b:Caption>/g)].map((m) => decodeXml(m[1]));
  const rows = [];
  for (const m of xml.matchAll(/<b:QueryResultRow><b:Caption>([^<]*)<\/b:Caption>.*?<b:Values>(.*?)<\/b:Values>/gs)) {
    const yw = /^(\d{4})-w(\d{1,2})$/.exec(m[1]);
    if (!yw) continue; // the service adds a "Total" row even with IncludeTotalRow=false
    const values = [...m[2].matchAll(/<b:string>([^<]*)<\/b:string>|<b:string\/>/g)].map((v) => {
      if (v[1] === undefined || v[1] === "") return null;
      // Counts are integers; strip any thousands separator in either locale.
      const n = Number(v[1].replace(/[.,\s]/g, ""));
      return Number.isFinite(n) ? n : null;
    });
    if (values.length !== columns.length) throw new Error(`SurvStat row ${m[1]} has ${values.length} values for ${columns.length} columns`);
    rows.push({ year: Number(yw[1]), week: Number(yw[2]), values });
  }
  if (columns.length === 0 || rows.length === 0) throw new Error("SurvStat response had no columns/rows — format may have changed");
  return { columns, rows };
}

async function querySurvStat(params) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/soap+xml;charset=utf-8",
      "User-Agent": "outbreak-watch/0.1 (github.com/outbreak-watch)",
    },
    body: olapRequest(params),
  });
  if (!res.ok) throw new Error(`SurvStat request failed: ${res.status} ${res.statusText}`);
  return parseOlap(await res.text());
}

// ISO-8601 week (SurvStat's reporting weeks are ISO weeks, Monday-start).
function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return { year: d.getUTCFullYear(), week: Math.ceil(((d - yearStart) / 86400000 + 1) / 7) };
}

const weekKey = (year, week) => year * 100 + week;

async function main() {
  // The in-progress week is always a fraction of its eventual total, so the
  // latest *complete* week is the one before today's ISO week. Fetching the
  // previous year too means early-January runs still get 12 weeks of history.
  const lastWeekDate = new Date(Date.now() - 7 * 86400000);
  const { year, week } = isoWeek(lastWeekDate);
  const latestKey = weekKey(year, week);

  const perState = new Map(); // stateId -> { columns, rows }
  for (const stateId of Object.keys(DE_STATES)) {
    perState.set(stateId, await querySurvStat({ years: [year - 1, year], stateId }));
  }

  // Every state query returns the same chronological week rows; take the
  // trailing HISTORY_WEEKS up to and including the latest complete week.
  const anyRows = perState.get("01").rows;
  const windowWeeks = anyRows
    .map((r) => ({ year: r.year, week: r.week, key: weekKey(r.year, r.week) }))
    .filter((w) => w.key <= latestKey)
    .sort((a, b) => a.key - b.key)
    .slice(-HISTORY_WEEKS);
  if (windowWeeks.length === 0 || windowWeeks[windowWeeks.length - 1].key !== latestKey) {
    throw new Error(`SurvStat has no rows for the latest complete week ${year}-w${week}`);
  }

  // disease -> stateId -> { byWeek: Map(key -> count), ytd }
  const diseases = new Map();
  for (const [stateId, { columns, rows }] of perState) {
    for (const row of rows) {
      const key = weekKey(row.year, row.week);
      if (key > latestKey) continue;
      row.values.forEach((value, col) => {
        const disease = columns[col];
        if (!diseases.has(disease)) diseases.set(disease, new Map());
        const byState = diseases.get(disease);
        if (!byState.has(stateId)) byState.set(stateId, { byWeek: new Map(), ytd: 0 });
        const entry = byState.get(stateId);
        // Within past weeks, an empty cell is SurvStat's rendering of zero.
        entry.byWeek.set(key, value ?? 0);
        if (row.year === year) entry.ytd += value ?? 0;
      });
    }
  }

  const diseaseList = [...diseases.entries()]
    .map(([disease, byState]) => {
      const states = [...byState.entries()]
        .map(([id, s]) => ({
          id,
          name: DE_STATES[id],
          current_week: s.byWeek.get(latestKey) ?? 0,
          ytd: s.ytd,
          population: DE_STATE_POPULATION[id] ?? null,
        }))
        .filter((s) => s.current_week > 0 || s.ytd > 0)
        .sort((a, b) => b.current_week - a.current_week);

      const nationalSeries = windowWeeks.map((w) => ({
        year: w.year,
        week: w.week,
        value: [...byState.values()].reduce((sum, s) => sum + (s.byWeek.get(w.key) ?? 0), 0),
      }));

      return {
        disease,
        total_current_week: states.reduce((sum, s) => sum + s.current_week, 0),
        total_ytd: states.reduce((sum, s) => sum + s.ytd, 0),
        states_reporting: states.length,
        national_series: nationalSeries,
        national_trend: computeTrend(nationalSeries),
        states,
      };
    })
    .filter((d) => d.total_ytd > 0) // drop diseases with zero activity all year
    .sort((a, b) => b.total_current_week - a.total_current_week);

  const feed = {
    generated_at: new Date().toISOString(),
    source: "RKI SurvStat (Robert Koch Institute)",
    year,
    week,
    history_weeks: windowWeeks.length,
    disease_count: diseaseList.length,
    diseases: diseaseList,
  };

  const fs = await import("node:fs/promises");
  await fs.writeFile("data/de-feed.json", JSON.stringify(feed, null, 2) + "\n");
  console.log(`Wrote ${diseaseList.length} diseases (ISO week ${week}, ${year}, ${windowWeeks.length}wk history) to data/de-feed.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
