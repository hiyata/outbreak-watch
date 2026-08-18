// IBGE's official 2-digit state codes ("codarea" in the vendored
// data/br-states-geo.json, "CO_UF" in InfoGripe's CSVs) — a fixed,
// long-standing government standard, not something that drifts.

export const BR_STATES = {
  "11": { abbr: "RO", name: "Rondônia" },
  "12": { abbr: "AC", name: "Acre" },
  "13": { abbr: "AM", name: "Amazonas" },
  "14": { abbr: "RR", name: "Roraima" },
  "15": { abbr: "PA", name: "Pará" },
  "16": { abbr: "AP", name: "Amapá" },
  "17": { abbr: "TO", name: "Tocantins" },
  "21": { abbr: "MA", name: "Maranhão" },
  "22": { abbr: "PI", name: "Piauí" },
  "23": { abbr: "CE", name: "Ceará" },
  "24": { abbr: "RN", name: "Rio Grande do Norte" },
  "25": { abbr: "PB", name: "Paraíba" },
  "26": { abbr: "PE", name: "Pernambuco" },
  "27": { abbr: "AL", name: "Alagoas" },
  "28": { abbr: "SE", name: "Sergipe" },
  "29": { abbr: "BA", name: "Bahia" },
  "31": { abbr: "MG", name: "Minas Gerais" },
  "32": { abbr: "ES", name: "Espírito Santo" },
  "33": { abbr: "RJ", name: "Rio de Janeiro" },
  "35": { abbr: "SP", name: "São Paulo" },
  "41": { abbr: "PR", name: "Paraná" },
  "42": { abbr: "SC", name: "Santa Catarina" },
  "43": { abbr: "RS", name: "Rio Grande do Sul" },
  "50": { abbr: "MS", name: "Mato Grosso do Sul" },
  "51": { abbr: "MT", name: "Mato Grosso" },
  "52": { abbr: "GO", name: "Goiás" },
  "53": { abbr: "DF", name: "Distrito Federal" },
};

export function lookupBrState(coUf) {
  const code = String(coUf).padStart(2, "0");
  const entry = BR_STATES[code];
  return entry ? { id: code, ...entry } : null;
}
