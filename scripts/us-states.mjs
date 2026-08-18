// Maps CDC NNDSS jurisdiction names to the id/name pairs used by the
// vendored us-atlas topojson (data/us-states-10m.json) — same guarantee as
// scripts/countries.mjs: a matched state is always a real map region.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const topology = JSON.parse(
  readFileSync(path.join(__dirname, "..", "data", "us-states-10m.json"), "utf-8")
);

const mapEntries = topology.objects.states.geometries
  .filter((g) => g.id && g.properties?.name)
  .map((g) => ({ id: String(g.id).padStart(2, "0"), name: g.properties.name }));

const byLowerName = new Map(mapEntries.map((e) => [e.name.toLowerCase(), e]));

// CDC spells a couple of jurisdictions slightly differently from the map file.
const ALIASES = {
  "commonwealth of northern mariana islands": "Commonwealth of the Northern Mariana Islands",
  "u.s. virgin islands": "United States Virgin Islands",
};

export function lookupState(cdcName) {
  if (!cdcName) return null;
  const key = cdcName.trim().toLowerCase();
  const aliasTarget = ALIASES[key];
  if (aliasTarget) return byLowerName.get(aliasTarget.toLowerCase()) ?? null;
  return byLowerName.get(key) ?? null;
}

export function allStates() {
  return mapEntries;
}
