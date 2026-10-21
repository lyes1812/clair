import { createHash } from "node:crypto";

// Lecteur DSN (norme NEODeS, P25V01 / P26V01), réécrit d'après le lecteur Codex vérifié sur des fichiers réels.
// Lecture partielle et volontairement limitée : déclaration, entreprise, établissement, individus, contrats, fins de
// contrat, versements, rémunérations et activités. Les autres blocs (cotisations, arrêts…) ne sont pas extraits.
// Le NIR n'est jamais renvoyé : il sert uniquement à calculer un identifiant de personne propre à l'espace.

export const SUPPORTED_NORMS = new Set(["P25V01", "P26V01"]);
export const DSN_MAX_BYTES = 4 * 1024 * 1024;
const MAX_ISSUES = 200;

const EXTRACTED = new Set([
  "S10.G00.00", "S20.G00.05", "S21.G00.06", "S21.G00.11", "S21.G00.30",
  "S21.G00.40", "S21.G00.62", "S21.G00.50", "S21.G00.51", "S21.G00.53", "S90.G00.90",
]);
const SINGLE_BLOCKS = new Set(["S10.G00.00", "S90.G00.90"]);
const PERSON_CHILDREN = new Set(["S21.G00.40", "S21.G00.62", "S21.G00.50", "S21.G00.51", "S21.G00.53"]);
const LINE = /^(S\d{2}\.G\d{2}\.\d{2}\.\d{3}),'(.*)'$/;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export class DsnError extends Error {
  constructor(public readonly code: "too_large" | "empty" | "encoding" | "syntax" | "no_declaration", message: string) {
    super(message);
    this.name = "DsnError";
  }
}

export type DsnPerson = { personId: string; identifierKind: "nir" | "ntt"; familyName: string | null; givenNames: string | null; usageName: string | null; employeeNumber: string | null };
export type DsnContract = {
  contractId: string; personId: string; contractNumber: string; startDate: string; endDate: string | null;
  nature: string | null; unit: string | null; referenceQuota: number | null; contractQuota: number | null; modality: string | null;
};
export type DsnRemuneration = {
  personId: string; contractId: string | null; contractNumber: string | null; paymentDate: string;
  type: string | null; startDate: string; endDate: string; amountCents: number; currency: "EUR";
};
export type DsnActivity = {
  personId: string; contractId: string | null; contractNumber: string | null; remunerationType: string | null;
  type: string | null; unit: string | null; measure: number; startDate: string; endDate: string;
};
export type DsnDeclaration = {
  key: string; month: string | null; siren: string | null; siret: string | null;
  nature: string | null; type: string | null; fraction: string | null; order: string | null;
  eligible: boolean; blocking: string[]; warnings: string[];
  people: DsnPerson[]; contracts: DsnContract[]; remunerations: DsnRemuneration[]; activities: DsnActivity[];
};
export type DsnParseResult = { hash: string; sizeBytes: number; encoding: "utf-8" | "windows-1252"; norm: string | null; declarations: DsnDeclaration[]; warnings: string[] };

type Row = { code: string; value: string; line: number };
type Block = { base: string; first: string; line: number; values: Map<string, string>; issues: string[] };

// --- Formats

function isoDate(v: string | undefined): string | null {
  if (!v || !/^\d{8}$/.test(v)) return null;
  const iso = `${v.slice(4, 8)}-${v.slice(2, 4)}-${v.slice(0, 2)}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}
function decimal(v: string | undefined): number | null {
  if (!v || v.length > 64 || !/^-?\d+(\.\d{1,6})?$/.test(v)) return null;
  const n = Number(v);
  return Math.abs(n) <= 1e12 ? n : null;
}
function cents(v: string | undefined): number | null {
  if (!v || v.length > 32) return null;
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(v);
  if (!m) return null;
  const c = BigInt(m[2]) * 100n + BigInt((m[3] ?? "").padEnd(2, "0") || "0");
  const signed = m[1] === "-" ? -c : c;
  return signed <= BigInt(Number.MAX_SAFE_INTEGER) && signed >= -BigInt(Number.MAX_SAFE_INTEGER) ? Number(signed) : null;
}
const code2 = (v: string | undefined) => (v && /^\d{2}$/.test(v) ? v : null);
const opt = (v: string | undefined) => (v === undefined || v === "" ? undefined : v);
function cleanText(v: string | undefined, max: number): string | null {
  const t = v?.trim();
  return t && t.length <= max && !CONTROL.test(t) ? t : null;
}

function push(list: string[], message: string) {
  if (list.length < MAX_ISSUES) list.push(message);
  else if (list.length === MAX_ISSUES) list.push("Liste tronquée : d'autres constats existent.");
}

// --- Décodage et découpage

function decode(bytes: Uint8Array): { text: string; encoding: "utf-8" | "windows-1252" } {
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "windows-1252" };
  }
}

function toRows(text: string): Row[] {
  const lines = text.split(/\r\n|\n|\r/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.map((raw, i) => {
    const m = LINE.exec(raw);
    if (!m || CONTROL.test(raw)) throw new DsnError("syntax", `Ligne ${i + 1} : syntaxe DSN invalide (attendu : rubrique,'valeur').`);
    return { code: m[1], value: m[2], line: i + 1 };
  });
}

function toBlocks(rows: Row[]): Block[] {
  const blocks: Block[] = [];
  let cur: Block | null = null;
  for (const r of rows) {
    const base = r.code.slice(0, -4);
    const startNew =
      !cur || cur.base !== base || (r.code === cur.first && !SINGLE_BLOCKS.has(base)) || (!EXTRACTED.has(base) && cur.values.has(r.code));
    if (startNew) {
      cur = { base, first: r.code, line: r.line, values: new Map(), issues: [] };
      blocks.push(cur);
    }
    const b = cur!;
    if (b.values.has(r.code)) {
      push(b.issues, `Ligne ${r.line} : rubrique ${r.code} dupliquée${b.values.get(r.code) !== r.value ? " et contradictoire" : ""}.`);
      continue;
    }
    b.values.set(r.code, r.value);
  }
  return blocks;
}

// --- Lecture

type PersonNode = { block: Block; children: Block[] };
type Context = { header: Block | null; company: Block | null; establishment: Block | null; people: PersonNode[] };

export type DsnParseOptions = {
  // Identifiant pseudonyme stable (HMAC par espace) ; jamais la valeur d'origine.
  fingerprint: (value: string) => string;
};

export function parseDsn(bytes: Uint8Array, opts: DsnParseOptions): DsnParseResult {
  if (bytes.byteLength === 0) throw new DsnError("empty", "Fichier vide.");
  if (bytes.byteLength > DSN_MAX_BYTES) throw new DsnError("too_large", "Fichier trop volumineux (4 Mo au plus).");
  const hash = createHash("sha256").update(bytes).digest("hex");
  const { text, encoding } = decode(bytes);
  const rows = toRows(text);
  const blocks = toBlocks(rows);
  const warnings: string[] = ["Lecture partielle : cotisations, arrêts et autres blocs non extraits ; contrôle non exhaustif de la norme."];
  const global: string[] = [];
  if (encoding === "windows-1252") warnings.push("Fichier lu en Windows-1252 (Latin-1) : il n'est pas en UTF-8.");

  const normRows = rows.filter((r) => r.code === "S10.G00.00.006");
  const norm = normRows.length === 1 && /^P\d{2}V\d{2}$/.test(normRows[0].value) ? normRows[0].value : null;
  if (normRows.length !== 1 || !norm) push(global, "Version de norme (S10.G00.00.006) absente, multiple ou invalide.");
  else if (!SUPPORTED_NORMS.has(norm)) push(global, `Norme ${norm} non prise en charge (P25V01 ou P26V01 attendue).`);

  const footers = blocks.filter((b) => b.base === "S90.G00.90");
  if (footers.length !== 1) push(global, "Pied de fichier (S90.G00.90) absent ou multiple.");

  const contexts: Context[] = [];
  let header: Block | null = null;
  let company: Block | null = null;
  let context: Context | null = null;
  let person: PersonNode | null = null;
  let afterFooter = false;
  let seenDeclaration = false;
  const notExtracted = new Set<string>();

  for (const b of blocks) {
    if (!/^S(10|20|21|90)\.G00\.\d{2}$/.test(b.base)) { push(global, `Ligne ${b.line} : structure ${b.base} non prise en charge.`); continue; }
    if (afterFooter) { push(global, `Ligne ${b.line} : rubrique après le pied de fichier.`); continue; }
    if (SINGLE_BLOCKS.has(b.base)) {
      for (const i of b.issues) push(global, i);
      if (b.base === "S90.G00.90") afterFooter = true;
      else if (seenDeclaration) push(global, `Ligne ${b.line} : en-tête d'envoi après une déclaration.`);
      continue;
    }
    if (b.base === "S20.G00.05") {
      if (header && !contexts.some((c) => c.header === header)) contexts.push({ header, company, establishment: null, people: [] });
      header = b; company = null; context = null; person = null; seenDeclaration = true;
      continue;
    }
    if (!header) { push(global, `Ligne ${b.line} : bloc ${b.base} sans déclaration parente.`); continue; }
    if (b.base === "S21.G00.06") {
      if (company && !contexts.some((c) => c.company === company)) push(global, `Ligne ${b.line} : deux entreprises successives sans établissement.`);
      company = b; context = null; person = null;
      continue;
    }
    if (b.base === "S21.G00.11") {
      if (!company) push(global, `Ligne ${b.line} : établissement sans entreprise.`);
      context = { header, company, establishment: b, people: [] };
      contexts.push(context); person = null;
      continue;
    }
    if (b.base === "S21.G00.30") {
      if (!context) { context = { header, company, establishment: null, people: [] }; contexts.push(context); }
      person = { block: b, children: [] };
      context.people.push(person);
      continue;
    }
    if (PERSON_CHILDREN.has(b.base)) {
      if (!person) { push(global, `Ligne ${b.line} : bloc ${b.base} sans personne parente.`); continue; }
      person.children.push(b);
      continue;
    }
    if (!EXTRACTED.has(b.base)) notExtracted.add(b.base);
  }
  if (header && !contexts.some((c) => c.header === header)) contexts.push({ header, company, establishment: null, people: [] });
  if (!seenDeclaration) throw new DsnError("no_declaration", "Aucune déclaration (S20.G00.05) dans le fichier.");

  const footer = footers[0];
  if (footer) {
    const total = footer.values.get("S90.G00.90.001");
    const count = footer.values.get("S90.G00.90.002");
    if (total !== String(rows.length)) push(global, `Pied de fichier : ${total ?? "n.d."} rubriques annoncées, ${rows.length} lues.`);
    const headers = blocks.filter((x) => x.base === "S20.G00.05").length;
    if (count !== String(headers)) push(global, `Pied de fichier : ${count ?? "n.d."} déclarations annoncées, ${headers} lues.`);
  }
  if (notExtracted.size) warnings.push(`Blocs non extraits : ${[...notExtracted].sort().join(", ")}.`);

  const declarations = contexts.map((c) => buildDeclaration(c, global, opts));
  const keys = new Map<string, number>();
  for (const d of declarations) keys.set(d.key, (keys.get(d.key) ?? 0) + 1);
  for (const d of declarations) {
    if (keys.get(d.key)! > 1) push(d.blocking, "Même déclaration présente plusieurs fois dans le fichier.");
    d.eligible = d.blocking.length === 0;
  }
  return { hash, sizeBytes: bytes.byteLength, encoding, norm, declarations, warnings };
}

function buildDeclaration(c: Context, global: string[], opts: DsnParseOptions): DsnDeclaration {
  const blocking = [...global];
  const warnings: string[] = [];
  const h = c.header?.values ?? new Map<string, string>();
  for (const b of [c.header, c.company, c.establishment]) for (const i of b?.issues ?? []) push(blocking, i);

  const nature = code2(h.get("S20.G00.05.001"));
  const type = code2(h.get("S20.G00.05.002"));
  const fractionRaw = h.get("S20.G00.05.003");
  const fraction = fractionRaw && /^[1-9][1-9]$/.test(fractionRaw) ? fractionRaw : null;
  const orderRaw = h.get("S20.G00.05.004");
  const order = orderRaw && /^\d{1,20}$/.test(orderRaw) && !/^0+$/.test(orderRaw) ? orderRaw : null;
  const monthDate = isoDate(h.get("S20.G00.05.005"));
  const month = monthDate && monthDate.endsWith("-01") ? monthDate.slice(0, 7) : null;
  if (nature !== "01") push(blocking, `Nature de déclaration ${nature ?? "n.d."} non prise en charge (01, DSN mensuelle, attendue).`);
  if (type !== "01" && type !== "03") push(blocking, `Type de déclaration ${type ?? "n.d."} non pris en charge (01 normale ou 03 annule et remplace).`);
  if (!fraction || Number(fraction[0]) > Number(fraction[1])) push(blocking, "Fraction (S20.G00.05.003) invalide.");
  if (!order) push(blocking, "Numéro d'ordre (S20.G00.05.004) invalide.");
  if (!month) push(blocking, "Mois principal déclaré (S20.G00.05.005) invalide : un premier jour du mois est attendu.");
  if (fraction && fraction !== "11") warnings.push(`Fraction ${fraction[0]}/${fraction[1]} : les autres fractions du mois sont nécessaires.`);
  if (type === "03") warnings.push("Déclaration annule et remplace : elle remplace la déclaration normale du même mois et du même établissement.");

  const sirenRaw = c.company?.values.get("S21.G00.06.001");
  const siren = sirenRaw && /^\d{9}$/.test(sirenRaw) ? sirenRaw : null;
  const nicRaw = c.establishment?.values.get("S21.G00.11.001");
  const nic = nicRaw && /^\d{5}$/.test(nicRaw) ? nicRaw : null;
  if (!siren) push(blocking, "SIREN (S21.G00.06.001) absent ou invalide.");
  if (!nic) push(blocking, "NIC de l'établissement (S21.G00.11.001) absent ou invalide.");
  const siret = siren && nic ? siren + nic : null;
  const key = ["dsn", siret ?? "siret-nd", month ?? "mois-nd", nature ?? "nd", type ?? "nd", fraction ?? "nd", order ?? "nd"].join(":");

  const people: DsnPerson[] = [];
  const contracts: DsnContract[] = [];
  const remunerations: DsnRemuneration[] = [];
  const activities: DsnActivity[] = [];
  const seenPeople = new Set<string>();

  for (const node of c.people) {
    const v = node.block.values;
    const at = `ligne ${node.block.line}`;
    for (const i of node.block.issues) push(blocking, i);
    const nir = v.get("S21.G00.30.001")?.trim().toUpperCase();
    const ntt = v.get("S21.G00.30.020")?.trim();
    let identifierKind: "nir" | "ntt" | null = null;
    let identifier: string | null = null;
    if (nir && /^[0-9AB]{13}(\d{2})?$/.test(nir)) { identifierKind = "nir"; identifier = nir.slice(0, 13); }
    else if (!nir && ntt && /^[12][A-Za-z0-9_-]{10,39}$/.test(ntt) && (!siren || ntt.slice(1, 10) === siren)) { identifierKind = "ntt"; identifier = ntt; }
    if (!identifierKind || !identifier || !siren) {
      push(blocking, `Individu (${at}) : NIR ou identifiant temporaire absent ou invalide ; aucun rapprochement par le nom n'est effectué.`);
      continue;
    }
    const personId = opts.fingerprint(`dsn-person:${siren}:${identifierKind}:${identifier}`);
    if (seenPeople.has(personId)) { push(blocking, `Individu (${at}) présent deux fois dans la déclaration.`); continue; }
    seenPeople.add(personId);
    if (identifierKind === "ntt") warnings.push(`Individu (${at}) identifié par un identifiant temporaire (NTT).`);
    const same = (x: string | null) => (x && (x.toUpperCase() === nir || x === ntt) ? null : x);
    const employeeNumberRaw = cleanText(v.get("S21.G00.30.019"), 50);
    const employeeNumber = same(employeeNumberRaw);
    if (employeeNumberRaw && !employeeNumber) warnings.push(`Individu (${at}) : matricule identique au NIR, non conservé.`);
    people.push({
      personId,
      identifierKind,
      familyName: cleanText(v.get("S21.G00.30.002"), 300),
      givenNames: cleanText(v.get("S21.G00.30.004"), 300),
      usageName: same(cleanText(v.get("S21.G00.30.003"), 80)),
      employeeNumber,
    });

    const byNumber = new Map<string, DsnContract>();
    let lastContract: DsnContract | null = null;
    let paymentDate: string | null = null;
    let lastRemuneration: DsnRemuneration | null = null;
    for (const b of node.children) {
      const cv = b.values;
      const line = `ligne ${b.line}`;
      for (const i of b.issues) push(blocking, i);
      if (b.base !== "S21.G00.53") lastRemuneration = null;
      if (b.base === "S21.G00.40") {
        if (paymentDate) push(blocking, `Contrat (${line}) placé après un versement.`);
        const startDate = isoDate(opt(cv.get("S21.G00.40.001")));
        const number = cleanText(cv.get("S21.G00.40.009"), 128);
        if (!startDate) { push(blocking, `Contrat (${line}) : date de début invalide.`); continue; }
        if (!number) { push(blocking, `Contrat (${line}) : numéro de contrat absent.`); continue; }
        if (byNumber.has(number)) { push(blocking, `Contrat (${line}) : numéro de contrat en double pour la même personne.`); continue; }
        const contract: DsnContract = {
          contractId: opts.fingerprint(`dsn-contract:${siren}:${personId}:${number}:${startDate}`),
          personId,
          contractNumber: number,
          startDate,
          endDate: null,
          nature: code2(cv.get("S21.G00.40.007")),
          unit: code2(cv.get("S21.G00.40.011")),
          referenceQuota: decimal(opt(cv.get("S21.G00.40.012"))),
          contractQuota: decimal(opt(cv.get("S21.G00.40.013"))),
          modality: code2(cv.get("S21.G00.40.014")),
        };
        if (contract.referenceQuota === null || contract.referenceQuota === 0 || contract.unit === "99") {
          warnings.push(`Contrat (${line}) : quotité de référence absente, nulle ou sans unité ; aucun ETP n'en sera déduit.`);
        }
        byNumber.set(number, contract);
        contracts.push(contract);
        lastContract = contract;
      } else if (b.base === "S21.G00.62") {
        if (paymentDate) push(blocking, `Fin de contrat (${line}) placée après un versement.`);
        const end = isoDate(opt(cv.get("S21.G00.62.001")));
        if (!lastContract) push(blocking, `Fin de contrat (${line}) sans contrat.`);
        else if (!end) push(blocking, `Fin de contrat (${line}) : date invalide.`);
        else if (lastContract.endDate) push(blocking, `Fin de contrat (${line}) : seconde fin pour le même contrat.`);
        else if (end < lastContract.startDate) push(blocking, `Fin de contrat (${line}) antérieure au début.`);
        else lastContract.endDate = end;
      } else if (b.base === "S21.G00.50") {
        paymentDate = isoDate(opt(cv.get("S21.G00.50.001")));
        if (!paymentDate) push(blocking, `Versement (${line}) : date invalide.`);
      } else if (b.base === "S21.G00.51") {
        if (!paymentDate) { push(blocking, `Rémunération (${line}) sans versement.`); continue; }
        const startDate = isoDate(opt(cv.get("S21.G00.51.001")));
        const endDate = isoDate(opt(cv.get("S21.G00.51.002")));
        const amountCents = cents(opt(cv.get("S21.G00.51.013")));
        const number = opt(cv.get("S21.G00.51.010")) ?? null;
        const contract = number ? byNumber.get(number) ?? null : null;
        if (!startDate || !endDate || endDate < startDate) { push(blocking, `Rémunération (${line}) : période invalide.`); continue; }
        if (amountCents === null) { push(blocking, `Rémunération (${line}) : montant invalide.`); continue; }
        if (number && !contract) { push(blocking, `Rémunération (${line}) : contrat inconnu pour cette personne.`); continue; }
        if (month && (startDate.slice(0, 7) !== month || endDate.slice(0, 7) !== month)) {
          warnings.push(`Rémunération (${line}) : période hors du mois déclaré (régularisation possible) ; mois déclaré et période conservés séparément.`);
        }
        const r: DsnRemuneration = { personId, contractId: contract?.contractId ?? null, contractNumber: contract?.contractNumber ?? null, paymentDate, type: /^\d{3}$/.test(cv.get("S21.G00.51.011") ?? "") ? cv.get("S21.G00.51.011")! : null, startDate, endDate, amountCents, currency: "EUR" };
        remunerations.push(r);
        lastRemuneration = r;
      } else if (b.base === "S21.G00.53") {
        if (!lastRemuneration) { push(blocking, `Activité (${line}) sans rémunération.`); continue; }
        const measure = decimal(opt(cv.get("S21.G00.53.002")));
        if (measure === null) { push(blocking, `Activité (${line}) : mesure invalide.`); continue; }
        activities.push({
          personId,
          contractId: lastRemuneration.contractId,
          contractNumber: lastRemuneration.contractNumber,
          remunerationType: lastRemuneration.type,
          type: code2(cv.get("S21.G00.53.001")),
          unit: code2(cv.get("S21.G00.53.003")),
          measure,
          startDate: lastRemuneration.startDate,
          endDate: lastRemuneration.endDate,
        });
      }
    }
  }
  return { key, month, siren, siret, nature, type, fraction, order, eligible: blocking.length === 0, blocking, warnings, people, contracts, remunerations, activities };
}
