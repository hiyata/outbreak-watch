// Best-effort extraction of case/death counts from WHO's free-text report
// fields. WHO's Overview/Summary fields consistently phrase cumulative
// totals as "N confirmed cases" and "N deaths", but this is prose, not
// structured data — treat every result as a possibly-wrong hint, never as
// authoritative. Returns null when no confident match is found; the
// frontend must never fabricate a number when this returns null.

// Tried first: a single sentence naming both figures together, so they're
// guaranteed to come from the same reported snapshot rather than being
// stitched together from two different sentences (which can pair a cases
// count from one date/field with a deaths count from another).
const COMBINED_PATTERNS = [
  /total of\s+([\d,]{3,})\s+confirmed cases,?\s*including\s+([\d,]{1,})\s+deaths/i,
  /([\d,]{3,})\s+confirmed cases,?\s*including\s+([\d,]{1,})\s+deaths/i,
  /([\d,]{3,})\s+cases,?\s*including\s+([\d,]{1,})\s+deaths/i,
];

const CASES_PATTERNS = [
  /total of\s+([\d,]{3,})\s+confirmed cases/i,
  /([\d,]{3,})\s+confirmed cases (?:have been|were) reported/i,
  /([\d,]{3,})\s+confirmed cases/i,
  /([\d,]{3,})\s+cases (?:have been|were) reported/i,
];

const DEATHS_PATTERNS = [
  /total of\s+([\d,]{1,})\s+deaths/i,
  /including\s+([\d,]{1,})\s+deaths/i,
  /([\d,]{1,})\s+deaths (?:have been|were) reported/i,
];

const AS_OF_PATTERN = /as of\s+(\d{1,2}\s+\w+\s+\d{4})/i;

function firstMatch(text, patterns) {
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const n = Number(m[1].replace(/,/g, ""));
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

export function extractCaseCounts(text) {
  if (!text) return null;
  const asOfMatch = text.match(AS_OF_PATTERN);
  const asOf = asOfMatch ? asOfMatch[1] : null;

  for (const re of COMBINED_PATTERNS) {
    const m = text.match(re);
    if (m) {
      const cases = Number(m[1].replace(/,/g, ""));
      const deaths = Number(m[2].replace(/,/g, ""));
      if (Number.isFinite(cases) && Number.isFinite(deaths) && deaths <= cases) {
        return { cases, deaths, as_of: asOf };
      }
    }
  }

  // Fall back to independent patterns only when no single sentence gave us
  // both figures together — these two numbers may come from different
  // sentences/fields, so treat this pairing as lower confidence.
  const cases = firstMatch(text, CASES_PATTERNS);
  const deaths = firstMatch(text, DEATHS_PATTERNS);
  if (cases === null) return null; // a case count is required; deaths-only isn't useful to show
  if (deaths !== null && deaths > cases) return null;

  return { cases, deaths, as_of: asOf };
}
