// Maps country names as they appear in WHO DON report titles to the id/name
// pairs used by the vendored world-atlas topojson (data/countries-110m.json),
// so a matched country is *guaranteed* to correspond to a real map region —
// no separate ISO-code table that could drift out of sync with the map file.
//
// Matching runs only against report titles (not full body text), and only
// full country names/well-known short forms — never bare substrings like
// "Congo" or "Korea" that are ambiguous between two real countries. A country
// that goes unmatched is simply left off the map; better to under-highlight
// than to mislabel where an outbreak is.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const topology = JSON.parse(
  readFileSync(path.join(__dirname, "..", "data", "countries-110m.json"), "utf-8")
);

const mapEntries = topology.objects.countries.geometries
  .filter((g) => g.id && g.properties?.name)
  .map((g) => ({ id: String(g.id).padStart(3, "0"), name: g.properties.name }));

const byName = new Map(mapEntries.map((e) => [e.name, e.id]));

// alias -> map "name" (the canonical name used above)
const ALIASES = {
  "Democratic Republic of the Congo": "Dem. Rep. Congo",
  "DR Congo": "Dem. Rep. Congo",
  DRC: "Dem. Rep. Congo",
  "Republic of the Congo": "Congo",
  "Congo-Brazzaville": "Congo",
  "Côte d'Ivoire": "Côte d'Ivoire",
  "Ivory Coast": "Côte d'Ivoire",
  "United States of America": "United States of America",
  "United States": "United States of America",
  USA: "United States of America",
  "U.S.A": "United States of America",
  "United Kingdom": "United Kingdom",
  UK: "United Kingdom",
  "Great Britain": "United Kingdom",
  "United Arab Emirates": "United Arab Emirates",
  UAE: "United Arab Emirates",
  "Republic of Korea": "South Korea",
  "South Korea": "South Korea",
  "Democratic People's Republic of Korea": "North Korea",
  "North Korea": "North Korea",
  "Russian Federation": "Russia",
  Russia: "Russia",
  "Syrian Arab Republic": "Syria",
  Syria: "Syria",
  "Islamic Republic of Iran": "Iran",
  Iran: "Iran",
  "Bolivarian Republic of Venezuela": "Venezuela",
  Venezuela: "Venezuela",
  "Plurinational State of Bolivia": "Bolivia",
  "United Republic of Tanzania": "Tanzania",
  Tanzania: "Tanzania",
  "Viet Nam": "Vietnam",
  Vietnam: "Vietnam",
  "Lao People's Democratic Republic": "Laos",
  "Lao PDR": "Laos",
  Laos: "Laos",
  "Czech Republic": "Czechia",
  Czechia: "Czechia",
  "North Macedonia": "Macedonia",
  Macedonia: "Macedonia",
  Eswatini: "eSwatini",
  Swaziland: "eSwatini",
  Myanmar: "Myanmar",
  Burma: "Myanmar",
  "State of Palestine": "Palestine",
  Palestine: "Palestine",
  "occupied Palestinian territory": "Palestine",
  "South Sudan": "S. Sudan",
  "Republic of South Sudan": "S. Sudan",
  "Central African Republic": "Central African Rep.",
  "Bosnia and Herzegovina": "Bosnia and Herz.",
  "Dominican Republic": "Dominican Rep.",
  "Equatorial Guinea": "Eq. Guinea",
  "Western Sahara": "W. Sahara",
  "Solomon Islands": "Solomon Is.",
  "Trinidad and Tobago": "Trinidad and Tobago",
  Taiwan: "Taiwan",
  "Chinese Taipei": "Taiwan",
};

const entries = [];
for (const [alias, mappedName] of Object.entries(ALIASES)) {
  const id = byName.get(mappedName);
  if (id) entries.push({ alias, id, name: mappedName });
}
for (const e of mapEntries) {
  entries.push({ alias: e.name, id: e.id, name: e.name });
}

// Longest alias first, so "Democratic Republic of the Congo" is tried
// before any shorter alias that might otherwise partially overlap.
entries.sort((a, b) => b.alias.length - a.alias.length);

const GLOBAL_TERMS = /\b(global|multi-country|multi-countries|multi-location|multiple countries|worldwide)\b/i;

export function matchCountries(text) {
  if (!text) return { countries: [], isGlobal: false };
  const isGlobal = GLOBAL_TERMS.test(text);

  const found = new Map();
  const claimed = []; // [start, end) ranges already matched by a longer alias

  for (const { alias, id, name } of entries) {
    const re = new RegExp(escapeRegExp(alias), alias === alias.toUpperCase() ? "g" : "gi");
    // word-boundary check done manually below since \b doesn't work for
    // names with non-word chars like "Côte d'Ivoire" or "S. Sudan"
    let m;
    while ((m = re.exec(text))) {
      const start = m.index;
      const end = start + m[0].length;
      const before = text[start - 1];
      const after = text[end];
      const hasWordBoundary = !/[a-zA-Z]/.test(before ?? " ") && !/[a-zA-Z]/.test(after ?? " ");
      const overlapsClaimed = claimed.some(([cs, ce]) => start < ce && end > cs);
      if (hasWordBoundary && !overlapsClaimed) {
        claimed.push([start, end]);
        if (!found.has(id)) found.set(id, { id, name });
      }
    }
  }

  return { countries: [...found.values()], isGlobal };
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
