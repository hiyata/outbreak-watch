// For a small allowlist of pathogens with a Nextclade dataset, finds
// candidate genome sequences on NCBI GenBank that plausibly belong to an
// active outbreak (same country + a collection date inside the report
// window), aligns them against the pathogen's reference with Nextclade,
// and writes the resulting mutation list to data/strains/<outbreak-id>.json.
//
// Deliberately bounded so a daily cron run stays cheap and fast:
//   - only pathogens on PATHOGENS get attempted (Nextclade needs a curated
//     reference dataset; there's no generic "align anything" fallback)
//   - only outbreaks updated in the last RECENCY_DAYS are considered
//   - NCBI search is capped at MAX_CANDIDATES per outbreak, and only the
//     top MAX_MATCHES (by confidence) get aligned
//   - a match with no evidence of the outbreak's country is discarded, not
//     kept as "provisional" — an unrelated sequence isn't useful data
//
// This is a *heuristic* match, not an authoritative one: WHO/CDC reports
// don't cite GenBank accessions, so association is inferred from metadata.
// Every match is written with a confidence tier so the UI can say so.

import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { matchCountries, ALIASES } from "./countries.mjs";

// GenBank has no dedicated "country" search field on nuccore, so geography
// has to go in as free-text (it still narrows results because /geo_loc_name
// text is indexed under All Fields). Reverse the map's alias table to get
// every known spelling for a given canonical country name.
const NAMES_BY_CANONICAL = new Map();
for (const [alias, canonical] of Object.entries(ALIASES)) {
  if (!NAMES_BY_CANONICAL.has(canonical)) NAMES_BY_CANONICAL.set(canonical, new Set());
  NAMES_BY_CANONICAL.get(canonical).add(alias);
}
function searchNamesFor(canonicalName) {
  const names = new Set([canonicalName, ...(NAMES_BY_CANONICAL.get(canonicalName) ?? [])]);
  return [...names];
}

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(ROOT, "data", "strains");
const CACHE_DIR = path.join(ROOT, ".nextclade-cache");

const NCBI_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const NCBI_API_KEY = process.env.NCBI_API_KEY;
const NEXTCLADE_BIN = process.env.NEXTCLADE_BIN || "nextclade";
const REQUEST_DELAY_MS = NCBI_API_KEY ? 110 : 350;

const MAX_CANDIDATES = 30; // esearch retmax per outbreak
const MAX_MATCHES = 5; // sequences aligned per outbreak after scoring
const LOOKBACK_DAYS = 21; // a sequence can be submitted a bit before the report date
const RECENCY_DAYS = 550; // only bother with outbreaks updated in roughly the last 18 months

const PATHOGENS = [
  {
    id: "mpox",
    label: "Mpox",
    matchDisease: (disease) => /\bmpox\b|monkeypox/i.test(disease),
    organism: "Monkeypox virus",
    nextcladeDataset: "nextstrain/mpox/all-clades",
  },
  {
    id: "h5n1",
    label: "Avian influenza A(H5N1)",
    matchDisease: (disease) => /influenza/i.test(disease) && /h5n1/i.test(disease),
    organism: "Influenza A virus",
    // NCBI's "Influenza A virus" organism covers every subtype and deposits
    // each gene segment as a separate record; Nextclade's H5 dataset only
    // calls mutations on the HA segment of H5 subtypes, so both the subtype
    // and the segment have to be confirmed from the record text itself.
    requireAllRecordText: [/h5n1|\(h5\)/i, /\bsegment 4\b|\(ha\)|hemagglutinin/i],
    excludeRecordText: /\bsegment [1235678]\b/i,
    nextcladeDataset: "community/moncla-lab/iav-h5/ha/all-clades",
  },
  {
    id: "covid-19",
    label: "COVID-19",
    matchDisease: (disease) => /covid-19|novel coronavirus/i.test(disease),
    organism: "Severe acute respiratory syndrome coronavirus 2",
    nextcladeDataset: "nextstrain/sars-cov-2/wuhan-hu-1/orfs",
  },
  {
    // WHO's "Ebola virus disease" (no species named) is almost always Zaire
    // ebolavirus, the species behind the great majority of historical
    // outbreaks — but never the title when a report explicitly names Sudan
    // or Bundibugyo virus instead, so those are excluded here.
    id: "ebola-zaire",
    label: "Ebola virus disease (Zaire ebolavirus)",
    matchDisease: (disease) => /ebola/i.test(disease) && !/sudan|bundibugyo/i.test(disease),
    organism: "Zaire ebolavirus",
    nextcladeDataset: "nextstrain/orthoebolavirus/ebov",
  },
  {
    id: "ebola-sudan",
    label: "Ebola disease caused by Sudan virus",
    matchDisease: (disease) => /sudan virus|ebola.*sudan/i.test(disease),
    organism: "Sudan ebolavirus",
    nextcladeDataset: "nextstrain/orthoebolavirus/sudv",
  },
  {
    id: "ebola-bundibugyo",
    label: "Ebola disease caused by Bundibugyo virus",
    matchDisease: (disease) => /bundibugyo/i.test(disease),
    organism: "Bundibugyo ebolavirus",
    nextcladeDataset: "nextstrain/orthoebolavirus/bdbv",
  },
  {
    id: "marburg",
    label: "Marburg virus disease",
    matchDisease: (disease) => /marburg/i.test(disease),
    organism: "Marburg marburgvirus",
    nextcladeDataset: "community/genspectrum/marburg/HK1980/all-lineages",
  },
  {
    id: "yellow-fever",
    label: "Yellow fever",
    matchDisease: (disease) => /yellow fever/i.test(disease),
    organism: "Yellow fever virus",
    nextcladeDataset: "community/pathoplexus/yellow-fever-virus",
  },
  {
    id: "measles",
    label: "Measles",
    matchDisease: (disease) => /\bmeasles\b/i.test(disease),
    organism: "Measles virus",
    nextcladeDataset: "nextstrain/measles/genome/WHO-2012",
  },
  {
    id: "west-nile",
    label: "West Nile virus",
    matchDisease: (disease) => /west nile/i.test(disease),
    organism: "West Nile virus",
    nextcladeDataset: "nextstrain/wnv/all-lineages",
  },
  {
    id: "zika",
    label: "Zika virus disease",
    matchDisease: (disease) => /zika/i.test(disease),
    organism: "Zika virus",
    nextcladeDataset: "community/itps/zikav",
  },
  {
    id: "dengue",
    label: "Dengue",
    // NCBI's Organism field is hierarchical/exploded, so the "Dengue
    // virus" parent taxon matches all four serotypes' records too.
    matchDisease: (disease) => /dengue/i.test(disease),
    organism: "Dengue virus",
    nextcladeDataset: "nextstrain/dengue/all",
  },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fmtPdat(date) {
  return date.toISOString().slice(0, 10).replaceAll("-", "/");
}

async function ncbiFetch(endpoint, params) {
  const url = new URL(`${NCBI_BASE}/${endpoint}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  if (NCBI_API_KEY) url.searchParams.set("api_key", NCBI_API_KEY);
  const res = await fetch(url, {
    headers: { "User-Agent": "outbreak-watch/0.1 (github.com/outbreak-watch; strain matcher)" },
  });
  await sleep(REQUEST_DELAY_MS);
  if (!res.ok) throw new Error(`NCBI ${endpoint} failed: ${res.status} ${res.statusText}`);
  return res;
}

async function searchCandidateIds(pathogen, outbreak, sinceDate) {
  const until = new Date();
  const countryNames = outbreak.countries.flatMap((c) => searchNamesFor(c.name));
  const countryClause = countryNames.length
    ? ` AND (${countryNames.map((n) => `"${n}"[All Fields]`).join(" OR ")})`
    : "";
  const term =
    `"${pathogen.organism}"[Organism] AND ` +
    `("${fmtPdat(sinceDate)}"[PDAT]:"${fmtPdat(until)}"[PDAT])${countryClause}`;
  const res = await ncbiFetch("esearch.fcgi", {
    db: "nuccore",
    term,
    retmax: String(MAX_CANDIDATES),
    sort: "date",
    retmode: "json",
  });
  const body = await res.json();
  return body.esearchresult?.idlist ?? [];
}

function parseGenBankRecords(text) {
  return text
    .split(/\n\/\/\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const accession = block.match(/^ACCESSION\s+(\S+)/m)?.[1];
      const definition = block
        .match(/^DEFINITION\s+([\s\S]*?)\n[A-Z]/m)?.[1]
        ?.replace(/\s+/g, " ")
        .trim();
      const isolate = block.match(/\/isolate="([^"]+)"/)?.[1];
      const strain = block.match(/\/strain="([^"]+)"/)?.[1];
      const geoLocName =
        block.match(/\/geo_loc_name="([^"]+)"/)?.[1] || block.match(/\/country="([^"]+)"/)?.[1];
      const collectionDate = block.match(/\/collection_date="([^"]+)"/)?.[1];
      const segment = block.match(/\/segment="([^"]+)"/)?.[1];
      return { accession, definition, isolate, strain, geoLocName, collectionDate, segment };
    })
    .filter((record) => record.accession);
}

async function fetchMetadata(ids) {
  if (!ids.length) return [];
  const res = await ncbiFetch("efetch.fcgi", { db: "nuccore", id: ids.join(","), rettype: "gb", retmode: "text" });
  return parseGenBankRecords(await res.text());
}

async function fetchFasta(ids) {
  if (!ids.length) return "";
  const res = await ncbiFetch("efetch.fcgi", {
    db: "nuccore",
    id: ids.join(","),
    rettype: "fasta",
    retmode: "text",
  });
  return res.text();
}

function parseCollectionDate(str) {
  if (!str) return null;
  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00Z`);
  const dmy = str.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})/);
  if (dmy) return new Date(`${dmy[1]} ${dmy[2]} ${dmy[3]} UTC`);
  const ym = str.match(/^(\d{4})-(\d{2})$/);
  if (ym) return new Date(`${ym[1]}-${ym[2]}-01T00:00:00Z`);
  const y = str.match(/^(\d{4})$/);
  if (y) return new Date(`${y[1]}-01-01T00:00:00Z`);
  return null;
}

function recordText(record) {
  return [record.definition, record.isolate, record.strain].filter(Boolean).join(" ");
}

function scoreMatch(record, pathogen, outbreak) {
  const text = recordText(record);
  if (pathogen.requireAllRecordText && !pathogen.requireAllRecordText.every((re) => re.test(text))) return null;
  if (pathogen.excludeRecordText && pathogen.excludeRecordText.test(text)) return null;

  const { countries } = matchCountries(record.geoLocName || "");
  const outbreakCountryIds = new Set(outbreak.countries.map((c) => c.id));
  const matchedCountry = countries.find((c) => outbreakCountryIds.has(c.id));
  if (!matchedCountry) return null; // no geography evidence tying this sequence to the outbreak

  const collected = parseCollectionDate(record.collectionDate);
  const windowStart = new Date(outbreak.first_seen);
  windowStart.setDate(windowStart.getDate() - LOOKBACK_DAYS);
  const windowEnd = new Date(outbreak.latest_update || Date.now());
  windowEnd.setDate(windowEnd.getDate() + 1);
  const dateInWindow = collected ? collected >= windowStart && collected <= windowEnd : false;

  return {
    accession: record.accession,
    isolate: record.isolate || record.strain || null,
    country: matchedCountry.name,
    collectionDate: record.collectionDate ?? null,
    confidence: dateInWindow ? "confirmed" : "likely",
    _sortDate: collected ?? new Date(0),
  };
}

async function prepareDataset(pathogen) {
  const datasetDir = path.join(CACHE_DIR, pathogen.id, "dataset");
  await mkdir(datasetDir, { recursive: true });
  await execFileAsync(NEXTCLADE_BIN, ["dataset", "get", "-n", pathogen.nextcladeDataset, "-o", datasetDir]);
  return datasetDir;
}

// GFF3 attribute values come quoted or unquoted and use either Name=/gene=
// (RefSeq-style, richer records: product/Note carry a plain-English function
// description) or gene_name= (the minimal single-gene community datasets).
function parseGffAttrs(attrStr) {
  const attrs = {};
  for (const kv of attrStr.split(";")) {
    const idx = kv.indexOf("=");
    if (idx === -1) continue;
    const key = kv.slice(0, idx).trim();
    const raw = decodeURIComponent(kv.slice(idx + 1)).replace(/%3B/gi, ";");
    attrs[key] = raw.replace(/^"|"$/g, "");
  }
  return attrs;
}

// Reads the dataset's GFF3 to get each gene/protein's position and (when
// available) its known function, so the genome map can be drawn to scale
// and mutations can be labelled with what the gene does — this is
// Nextclade dataset metadata, not something fetched live per view.
//
// The annotation file isn't always named genome_annotation.gff3 (the
// measles dataset, for one, calls it annotation.gff3) — pathogen.json's
// files.genomeAnnotation is the authoritative filename.
async function extractGenomeAnnotation(datasetDir) {
  let annotationFile = "genome_annotation.gff3";
  try {
    const pathogenJson = JSON.parse(await readFile(path.join(datasetDir, "pathogen.json"), "utf-8"));
    if (pathogenJson.files?.genomeAnnotation) annotationFile = pathogenJson.files.genomeAnnotation;
  } catch {
    // fall back to the conventional filename
  }
  const gffText = await readFile(path.join(datasetDir, annotationFile), "utf-8").catch(() => null);
  if (!gffText) return null;

  const genesByName = new Map();
  let genomeLength = null;
  for (const line of gffText.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const cols = line.split("\t");
    if (cols.length < 9) continue;
    const [, , type, startStr, endStr, , strand, , attrStr] = cols;
    if (type === "region" && genomeLength === null) genomeLength = Number(endStr);
    if (type !== "gene" && type !== "CDS") continue;
    const attrs = parseGffAttrs(attrStr);
    const name = attrs.Name || attrs.gene_name || attrs.gene;
    if (!name) continue;
    const entry = {
      name,
      start: Number(startStr),
      end: Number(endStr),
      strand,
      product: attrs.product ?? null,
      note: attrs.Note ?? null,
    };
    // a CDS row's product/Note is richer than the bare "gene" row for the
    // same feature, so let it overwrite; otherwise keep whichever came first
    if (type === "CDS" || !genesByName.has(name)) genesByName.set(name, entry);
  }

  if (genomeLength === null) {
    const fastaText = await readFile(path.join(datasetDir, "reference.fasta"), "utf-8").catch(() => "");
    genomeLength = fastaText.split("\n").slice(1).join("").trim().length || null;
  }

  return { genomeLength, genes: [...genesByName.values()].sort((a, b) => a.start - b.start) };
}

async function alignWithNextclade(pathogen, datasetDir, matches, fastaById) {
  const runDir = path.join(CACHE_DIR, pathogen.id, "run");
  await rm(runDir, { recursive: true, force: true });
  await mkdir(runDir, { recursive: true });

  const fastaPath = path.join(runDir, "input.fasta");
  const fastaText = matches.map((m) => fastaById.get(m.accession)).filter(Boolean).join("\n");
  await writeFile(fastaPath, fastaText);

  const outputPath = path.join(runDir, "output.json");
  await execFileAsync(NEXTCLADE_BIN, [
    "run",
    "--input-dataset",
    datasetDir,
    "--output-json",
    outputPath,
    fastaPath,
  ]);

  const output = JSON.parse(await readFile(outputPath, "utf-8"));
  const byAccession = new Map();
  for (const result of output.results ?? []) {
    const accession = result.seqName?.split(/\s/)[0]?.split(".")[0];
    if (!accession) continue;
    const mutations = (result.aaSubstitutions ?? []).map((sub) => ({
      gene: sub.cdsName,
      position: sub.pos,
      refAa: sub.refAa,
      altAa: sub.qryAa,
      change: `${sub.refAa}${sub.pos}${sub.qryAa}`,
    }));
    byAccession.set(accession, {
      clade: result.clade ?? null,
      totalSubstitutions: result.totalSubstitutions ?? null,
      mutations,
      qcStatus: result.qc?.overallStatus ?? null,
    });
  }
  return byAccession;
}

async function processOutbreak(pathogen, datasetDir, outbreak) {
  if (!outbreak.countries.length) return null; // no geography to match against, not worth searching

  const since = new Date(outbreak.first_seen);
  since.setDate(since.getDate() - LOOKBACK_DAYS);

  const candidateIds = await searchCandidateIds(pathogen, outbreak, since);
  if (!candidateIds.length) return null;

  const records = await fetchMetadata(candidateIds);
  const scored = records
    .map((record) => scoreMatch(record, pathogen, outbreak))
    .filter(Boolean)
    .sort((a, b) => (a.confidence === b.confidence ? b._sortDate - a._sortDate : a.confidence === "confirmed" ? -1 : 1))
    .slice(0, MAX_MATCHES);

  if (!scored.length) return null;

  const fastaText = await fetchFasta(scored.map((m) => m.accession));
  const fastaById = new Map();
  for (const chunk of fastaText.split(/\n(?=>)/)) {
    const id = chunk.match(/^>(\S+)/)?.[1]?.split(".")[0];
    if (id) fastaById.set(id, chunk.trim());
  }
  // accessions in FASTA/metadata may carry a version suffix (e.g. OZ504875.1);
  // re-key without it so lookups from the scored list (bare accession) still hit
  const fastaByBareId = new Map();
  for (const [id, chunk] of fastaById) fastaByBareId.set(id.split(".")[0], chunk);

  let alignments;
  try {
    alignments = await alignWithNextclade(pathogen, datasetDir, scored, fastaByBareId);
  } catch (err) {
    console.error(`  nextclade alignment failed for ${outbreak.id}: ${err.message}`);
    return null;
  }

  const matches = scored.map(({ _sortDate, ...m }) => ({
    ...m,
    alignment: alignments.get(m.accession) ?? null,
  }));

  return {
    outbreakId: outbreak.id,
    disease: outbreak.disease,
    pathogen: pathogen.id,
    nextcladeDataset: pathogen.nextcladeDataset,
    generatedAt: new Date().toISOString(),
    matches,
  };
}

async function main() {
  const feed = JSON.parse(await readFile(path.join(ROOT, "data", "feed.json"), "utf-8"));
  const cutoff = Date.now() - RECENCY_DAYS * 24 * 60 * 60 * 1000;

  const genomesDir = path.join(OUT_DIR, "_genomes");
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(genomesDir, { recursive: true });

  for (const pathogen of PATHOGENS) {
    const outbreaks = feed.outbreaks.filter(
      (o) => pathogen.matchDisease(o.disease) && new Date(o.latest_update).getTime() >= cutoff
    );
    console.log(`[${pathogen.id}] ${outbreaks.length} candidate outbreak(s)`);
    if (!outbreaks.length) continue;

    let datasetDir;
    try {
      datasetDir = await prepareDataset(pathogen);
      const genomeInfo = await extractGenomeAnnotation(datasetDir);
      if (genomeInfo) {
        await writeFile(
          path.join(genomesDir, `${pathogen.id}.json`),
          JSON.stringify({ pathogen: pathogen.id, label: pathogen.label, ...genomeInfo }, null, 2)
        );
      }
    } catch (err) {
      console.log(`  FAILED to prepare dataset: ${err.message}`);
      continue;
    }

    for (const outbreak of outbreaks) {
      process.stdout.write(`  ${outbreak.id} (${outbreak.disease})... `);
      try {
        const result = await processOutbreak(pathogen, datasetDir, outbreak);
        if (!result) {
          console.log("no matching sequences");
          continue;
        }
        const outPath = path.join(OUT_DIR, `${outbreak.id}.json`);
        await writeFile(outPath, JSON.stringify(result, null, 2));
        console.log(`${result.matches.length} match(es) -> ${path.relative(ROOT, outPath)}`);
      } catch (err) {
        console.log(`FAILED: ${err.message}`);
      }
    }
  }
}

main();
