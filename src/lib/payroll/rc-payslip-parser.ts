import { toCents } from "@/lib/money";
import type { RcPayslipCost } from "./rc-payslips";

export const RC_PARSER_VERSION = "payfit-rc-coordinate-v4";
export type RcPayslipTextItem = { text: string; x: number; y: number; width: number; height?: number };
export type RcPayslipTextRow = { page: number; line: number; items: RcPayslipTextItem[] };
export type RcPayslipComponent = { label: string; amountCents: number; page: number; line: number };
export type RcPayslipExtraction = {
  status: "identified" | "none" | "review";
  code: string;
  components: RcPayslipComponent[];
  indemnityCents: number | null;
  parserVersion: string;
  cost?: RcPayslipCost;
};
const MAX_BYTES = 8 * 1024 * 1024;
const normalized = (text: string) => text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[’']/g, " ").replace(/\s+/g, " ").trim();
const plain = (row: RcPayslipTextRow) => row.items.map((item) => item.text).join(" ").replace(/\s+/g, " ").trim();
const result = (status: RcPayslipExtraction["status"], code: string, components: RcPayslipComponent[] = [], indemnityCents: number | null = null): RcPayslipExtraction => ({ status, code, components, indemnityCents, parserVersion: RC_PARSER_VERSION });
const explicitRc = (text: string) => /\bindemnite(?:s)?\b.{0,100}\brupture(?:s)?\s+conventionnelle(?:s)?\b/.test(normalized(text));
const excluded = (text: string) => /^(?:total|cumul|rappel annuel|base|assiette|cotisation|contribution|forfait social|csg|crds|taxe)\b/.test(normalized(text));
const amount = (text: string): number | null => {
  const clean = text.trim().replace(/[−–]/g, "-").replace(/\s*€$/, "").trim();
  if (!/^[+-]?(?:\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d+)[,.]\d{2}$/.test(clean)) return null;
  return toCents(clean);
};
type Column = { x: number; role: "employee" | "employer" | "base" | "employee-rate" | "employer-rate" | "other" };
type ParentColumn = { x: number; y: number; rowIndex: number; role: "base" | "employee-group" | "employer-group" };

function headerCells(row: RcPayslipTextRow): RcPayslipTextItem[] {
  const out: RcPayslipTextItem[] = [];
  for (const item of [...row.items].sort((a, b) => a.x - b.x)) {
    const last = out.at(-1);
    // Le PDF peut séparer les mots d’une même étiquette (« À », « payer »).
    if (last && item.x - (last.x + last.width) >= -1 && item.x - (last.x + last.width) <= 9
      && (!/^(?:base|taux|gains?|retenue|montant|a payer|a deduire|charges patronales)$/.test(normalized(last.text))
        || /^(?:taux|montant)$/.test(normalized(last.text)) && /^(?:salarial|salarie|patronal|ou)$/.test(normalized(item.text)))) {
      last.text += ` ${item.text}`; last.width = item.x + item.width - last.x;
    } else out.push({ ...item });
  }
  return out;
}

function columnsFor(rows: RcPayslipTextRow[], at: number): Column[] | null {
  const current = rows[at];
  // Une entête est locale à la page et doit précéder la ligne d’indemnité.
  for (let index = at - 1; index >= 0 && rows[index].page === current.page; index--) {
    const cells = headerCells(rows[index]);
    // Entête PayFit à deux niveaux : la largeur du texte « PART SALARIÉ » n’est pas celle du groupe.
    // Ses bornes viennent des groupes voisins ; les sous-colonnes identifient ensuite taux et montant.
    const parentCells: ParentColumn[] = [];
    // Les titres de groupe peuvent avoir des lignes de base différentes, tout en occupant la même entête.
    // Seulement les lignes adjacentes de la même page et un petit écart vertical sont admissibles.
    for (let neighbor = Math.max(0, index - 1); neighbor <= Math.min(index + 1, at - 1); neighbor++) {
      if (rows[neighbor].page !== current.page) continue;
      for (const cell of headerCells(rows[neighbor])) {
        const text = normalized(cell.text), x = cell.x + cell.width / 2;
        const role = text === "base" ? "base" : /^(?:part )?salari(?:al|ale|ales|e|es)$/.test(text) ? "employee-group"
          : /^(?:part )?(?:employeur|patronal|patronale|patronales)$/.test(text) ? "employer-group" : null;
        if (role) parentCells.push({ x, y: cell.y, rowIndex: neighbor, role });
      }
    }
    const anchors = parentCells.filter((parent) => parent.rowIndex === index);
    const parents = parentCells.filter((parent) => anchors.some((anchor) => Math.abs(anchor.y - parent.y) <= 12)).sort((a, b) => a.x - b.x);
    const employeeGroups = parents.filter((parent) => parent.role === "employee-group");
    const employerGroups = parents.filter((parent) => parent.role === "employer-group");
    const baseGroups = parents.filter((parent) => parent.role === "base");
    if (employeeGroups.length > 1 || employerGroups.length > 1 || baseGroups.length > 1 && employeeGroups.length > 0 && employerGroups.length > 0) return null;
    if (employeeGroups.length === 1 && employerGroups.length === 1 && baseGroups.length === 1) {
      const employeeGroup = employeeGroups[0], employerGroup = employerGroups[0], base = baseGroups[0];
      if (base.x < employeeGroup.x && employeeGroup.x < employerGroup.x) {
        const left = (base.x + employeeGroup.x) / 2, right = (employeeGroup.x + employerGroup.x) / 2;
        const firstParentRow = Math.min(...parents.map((parent) => parent.rowIndex));
        const childRows: RcPayslipTextRow[] = [];
        for (const candidate of rows.slice(firstParentRow + 1, Math.min(firstParentRow + 4, at))) {
          // Les écritures qui suivent ferment l’entête : un autre tableau plus bas ne peut pas la compléter.
          if (candidate.page !== current.page || monetaryItems(candidate).length) break;
          childRows.push(candidate);
        }
        const children = childRows.flatMap(headerCells);
        const employeeAmounts = children.filter((cell) => normalized(cell.text) === "montant" && cell.x + cell.width / 2 > left && cell.x + cell.width / 2 < right);
        const employeeRates = children.filter((cell) => /^(?:taux|taux ou %|taux salarial)$/.test(normalized(cell.text)) && cell.x + cell.width / 2 > left && cell.x + cell.width / 2 < right);
        const employerAmounts = children.filter((cell) => normalized(cell.text) === "montant" && cell.x + cell.width / 2 > right);
        if (employeeAmounts.length === 1 && employeeRates.length === 1 && employerAmounts.length <= 1) {
          const amountX = employeeAmounts[0].x + employeeAmounts[0].width / 2;
          const rateX = employeeRates[0].x + employeeRates[0].width / 2;
          const employerRates = children.filter((cell) => /^(?:taux|taux ou %|taux patronal)$/.test(normalized(cell.text)) && cell.x + cell.width / 2 > right);
          const employerX = employerAmounts.length ? employerAmounts[0].x + employerAmounts[0].width / 2 : employerGroup.x;
          const employerVerified = employerRates.length === 0 || employerRates.length === 1 && employerAmounts.length === 1 && employerRates[0].x + employerRates[0].width / 2 < employerX;
          if (rateX < amountX) {
            const verified: Column[] = [
              { x: base.x, role: "base" }, { x: rateX, role: "employee-rate" }, { x: amountX, role: "employee" },
              ...employerRates.map((cell): Column => ({ x: cell.x + cell.width / 2, role: "employer-rate" })),
              { x: employerX, role: employerVerified ? "employer" : "other" },
            ];
            return verified.sort((a, b) => a.x - b.x);
          }
        }
      }
      // Une entête explicitement groupée mais incohérente reste bloquante, sans reprendre une entête plus ancienne.
      return null;
    }
    const columns: Column[] = [];
    for (const cell of cells) {
      const text = normalized(cell.text), x = cell.x + cell.width / 2;
      if (/^(?:a payer|gains?|montant salarial|montant salarie|montant a payer)$/.test(text)) columns.push({ x, role: "employee" });
      else if (/^(?:charges patronales|cotisations patronales|part patronale|part employeur|montant patronal|montant employeur|employeur|patronal(?:es)?)$/.test(text)) columns.push({ x, role: "employer" });
      else if (text === "base") columns.push({ x, role: "base" });
      else if (text === "taux patronal") columns.push({ x, role: "employer-rate" });
      else if (/^taux(?: ou %| salarial)?$/.test(text)) columns.push({ x, role: "employee-rate" });
      else if (/^(?:a deduire|retenues?|montant)$/.test(text)) columns.push({ x, role: "other" });
    }
    if (columns.length >= 2 && columns.filter((column) => column.role === "employee").length === 1) return columns.sort((a, b) => a.x - b.x);
  }
  return null;
}

function numberItems(row: RcPayslipTextRow) {
  const joined: RcPayslipTextItem[] = [];
  for (const item of [...row.items].sort((a, b) => a.x - b.x)) {
    const last = joined.at(-1), gap = last ? item.x - (last.x + last.width) : Infinity;
    if (last && gap >= -1 && gap <= 4 && /^[+−–-]?\d{1,3}(?:[ \u00a0\u202f]\d{3})*$/.test(last.text.trim()) && /^\d{3}(?:[,.]\d{2})?$/.test(item.text.trim())) {
      last.text += ` ${item.text}`; last.width = item.x + item.width - last.x;
    } else if (last && gap >= -1 && gap <= 2 && /^[+−–-]?\d[\d \u00a0\u202f]*$/.test(last.text.trim()) && /^[,.]\d{2}$/.test(item.text.trim())) {
      last.text += item.text; last.width = item.x + item.width - last.x;
    } else joined.push({ ...item });
  }
  return joined;
}
const monetaryItems = (row: RcPayslipTextRow) => numberItems(row).filter((item) => amount(item.text) !== null);

function columnItems(row: RcPayslipTextRow, columns: Column[], role: Column["role"]): RcPayslipTextItem[] | null {
  const matches = columns.map((column, index) => ({ column, index })).filter(({ column }) => column.role === role);
  if (matches.length !== 1) return null;
  const { column, index } = matches[0];
  const left = index === 0 ? column.x - 65 : (columns[index - 1].x + column.x) / 2;
  const right = index === columns.length - 1 ? column.x + 65 : (column.x + columns[index + 1].x) / 2;
  return numberItems(row).filter((item) => /\d/.test(item.text) && item.x + item.width / 2 >= left && item.x + item.width / 2 < right);
}

const costReview = (code: string): RcPayslipCost => ({ status: "review", code, employerChargesCents: null, chargedCents: null, components: [] });
const rcMention = (text: string) => /\bruptures? conventionnelles?\b/.test(normalized(text));
const chargeMention = (text: string) => /\b(?:contributions?|cotisations?|forfait social)\b/.test(normalized(text));
const corrections = (text: string) => /\b(?:regularisation|rectificatif|annule|annulation|correction|rappel)\b/.test(normalized(text));
function exemptNominal(label: string): boolean {
  const text = normalized(label);
  if (/\b(?:impots?|fiscal|fiscale|imposable|imposables)\b/.test(text)) return false;
  const withoutNonSubject = text.replace(/\bnon[\s-]+soumis(?:e|es)?\b/g, "");
  if (/\bsoumis(?:e|es)?\b/.test(withoutNonSubject)) return false;
  return /\b(?:exonere(?:e|es|s)?|non[\s-]+soumis(?:e|es)?)\b/.test(text);
}

/** Coût confirmé seulement lorsque l’indemnité et chaque charge RC patronale sont isolées sur le bulletin. */
function rcCost(rows: RcPayslipTextRow[], nominal: RcPayslipComponent[], indemnityCents: number): RcPayslipCost {
  if (!nominal.every((component) => exemptNominal(component.label))) return costReview("rc-exemption-unconfirmed");
  const components: RcPayslipComponent[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < rows.length; index++) {
    let row = rows[index], text = plain(row);
    const next = rows[index + 1];
    if (chargeMention(text) && !monetaryItems(row).length && next?.page === row.page && next.line === row.line + 1 && rcMention(`${text} ${plain(next)}`)) {
      text = `${text} ${plain(next)}`; row = next; index++;
    }
    // « Indemnité non soumise à cotisations » qualifie le nominal, ce n’est pas une ligne de charges.
    if (nominal.some((component) => component.page === row.page && component.line === row.line)) continue;
    if (!chargeMention(text) || !rcMention(text)) continue;
    const firstNumber = numberItems(row).filter((item) => /\d/.test(item.text))[0]?.x;
    const label = text === plain(row)
      ? row.items.filter((item) => firstNumber === undefined || item.x < firstNumber).map((item) => item.text).join(" ").trim()
      : text.replace(/(?:[+−–-]?\d[\d \u00a0\u202f]*[,.]\d{2}\s*€?\s*)+$/, "").trim();
    const key = normalized(label);
    if (!chargeMention(label) || !rcMention(label) || label.length > 160 || /[\u0000-\u001f]/.test(label)) return costReview("ambiguous-rc-charge-label");
    if (/\b(?:csg|crds)\b/.test(key)) continue;
    if (/\b(?:licenciement|retraite|transactionnelle|conges payes|annuel|annuelle|annuels|annuelles|cumul)\b/.test(key) || /^(?:total|cumul|base|assiette)\b/.test(key)) return costReview("mixed-rc-charge-label");
    if (/\b(?:salaries?|salarial(?:e|es)?|salariaux)\b/.test(key)) return costReview("employee-rc-charge-label");
    if (corrections(label)) return costReview("signed-or-corrected-rc-charge");
    if (seen.has(key)) return costReview("duplicate-rc-charge");
    const columns = columnsFor(rows, rows.indexOf(row));
    if (!columns) return costReview("charge-column-unrecognized");
    const employer = columnItems(row, columns, "employer");
    if (employer === null) return costReview("employer-column-unrecognized");
    if (employer.length !== 1 || amount(employer[0].text) === null) return costReview("employer-amount-ambiguous");
    const cents = amount(employer[0].text)!;
    if (cents < 0) return costReview("signed-or-corrected-rc-charge");
    if (cents > 100_000_000_000_000) return costReview("unsafe-rc-charge");
    const bases = columnItems(row, columns, "base");
    if (bases && bases.length > 1) return costReview("rc-charge-base-ambiguous");
    if (bases?.length && (amount(bases[0].text) === null || amount(bases[0].text) !== indemnityCents)) return costReview("rc-charge-base-mismatch");
    seen.add(key); components.push({ label, amountCents: cents, page: row.page, line: row.line });
    if (components.length > 16) return costReview("too-many-rc-charges");
  }
  if (!components.length) return costReview("no-explicit-employer-rc-charge");
  const employer = components.reduce((total, component) => total + BigInt(component.amountCents), 0n);
  const charged = BigInt(indemnityCents) + employer;
  if (employer > BigInt(Number.MAX_SAFE_INTEGER) || charged > BigInt(Number.MAX_SAFE_INTEGER)) return costReview("unsafe-rc-cost");
  return { status: "value", code: "explicit-employer-rc-cost", employerChargesCents: Number(employer), chargedCents: Number(charged), components };
}

/** Montant nominal de l’indemnité seulement : aucune cotisation, aucun taux ni coût chargé n’est reconstitué. */
export function parseRcPayslipRows(source: RcPayslipTextRow[]): RcPayslipExtraction {
  if (!source.length || source.length > 20_000 || source.some((row) => !Number.isInteger(row.page) || row.page < 1 || row.page > 20 || !Number.isInteger(row.line) || row.line < 1 || !Array.isArray(row.items)
    || row.items.some((item) => typeof item.text !== "string" || item.text.length > 5000 || ![item.x, item.y, item.width, item.height ?? 0].every(Number.isFinite) || item.width < 0))) return result("review", "unreadable-text");
  const rows = [...source].sort((a, b) => a.page - b.page || a.line - b.line);
  if (!rows.some((row) => plain(row))) return result("review", "unreadable-text");
  const components: RcPayslipComponent[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < rows.length; index++) {
    let row = rows[index], text = plain(row), labelText = text;
    if (excluded(text)) continue;
    // Libellé renvoyé sur deux lignes : on garde la ligne monétaire et la référence des deux morceaux.
    const next = rows[index + 1];
    if (next?.page === row.page && next.line === row.line + 1 && !monetaryItems(row).length
      && (/\bindemnite/.test(normalized(text)) || explicitRc(text)) && explicitRc(`${text} ${plain(next)}`)) {
      text = `${text} ${plain(next)}`; labelText = text; row = next; index++;
    }
    if (!explicitRc(text)) continue;
    const firstNumber = monetaryItems(row)[0]?.x;
    const labelParts = row.items.filter((item) => firstNumber === undefined || item.x < firstNumber).map((item) => item.text);
    if (labelText === plain(row)) labelText = labelParts.join(" ").trim();
    else labelText = labelText.replace(/(?:[+-]?\d[\d \u00a0\u202f]*[,.]\d{2}\s*€?\s*)+$/, "").trim();
    if (!explicitRc(labelText) || labelText.length > 160 || /[\u0000-\u001f]/.test(labelText)
      || /\b(?:licenciement|conges payes|retraite|transactionnelle|assiette|base|csg|crds|forfait social)\b/.test(normalized(labelText))) return result("review", "ambiguous-rc-label");
    const columns = columnsFor(rows, rows.indexOf(row));
    if (!columns) return result("review", "amount-column-unrecognized");
    const employee = columns.findIndex((column) => column.role === "employee");
    const left = employee === 0 ? columns[employee].x - 65 : (columns[employee - 1].x + columns[employee].x) / 2;
    const right = employee === columns.length - 1 ? columns[employee].x + 65 : (columns[employee].x + columns[employee + 1].x) / 2;
    const values = monetaryItems(row).filter((item) => item.x + item.width / 2 >= left && item.x + item.width / 2 < right);
    if (values.length !== 1) return result("review", "amount-column-ambiguous");
    const cents = amount(values[0].text)!;
    if (cents < 0 || /\b(?:regularisation|rectificatif|annule|annulation|correction)\b/.test(normalized(labelText))) return result("review", "signed-or-corrected-rc");
    if (cents > 100_000_000_000_000) return result("review", "unsafe-amount");
    const signature = normalized(labelText);
    if (seen.has(signature)) return result("review", "duplicate-rc-line");
    seen.add(signature);
    components.push({ label: labelText, amountCents: cents, page: row.page, line: row.line });
    if (components.length > 8) return result("review", "too-many-rc-lines");
  }
  if (!components.length) return result("none", "no-explicit-rc");
  // Une ligne générique suivie de parts taxable/exonérée peut être un total répété : aucune somme présumée.
  if (components.length > 1 && components.some((component) => !/\b(?:soumis|soumise|soumises|exonere|exoneree|exonerees|imposable|imposables|taxable|taxables)\b/.test(normalized(component.label)))) return result("review", "overlapping-rc-components");
  const sum = components.reduce((total, component) => total + BigInt(component.amountCents), 0n);
  if (sum > BigInt(Number.MAX_SAFE_INTEGER)) return result("review", "unsafe-amount");
  return { ...result("identified", "explicit-rc-amount", components, Number(sum)), cost: rcCost(rows, components, Number(sum)) };
}

/** Pipeline privé commun : les lignes intégrales ne sont jamais exportées hors de ce module. */
async function withRcPayslipRows<T>(bytes: Uint8Array, consume: (rows: RcPayslipTextRow[]) => T, unavailable: (code: string) => T): Promise<T> {
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > MAX_BYTES || new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") return unavailable("invalid-pdf");
  let task: { destroy: () => Promise<void> } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // Le drapeau est conservé pour les versions compatibles ; pdf.js 6 a retiré l’évaluation dynamique.
    const documentOptions = { data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0, stopAtErrors: true, disableFontFace: true, useSystemFonts: true, useWorkerFetch: false, enableXfa: false };
    const loadingTask = pdfjs.getDocument(documentOptions);
    task = loadingTask;
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("pdf-timeout")), 20_000); });
    return await Promise.race([deadline, (async () => {
      const document = await loadingTask.promise;
      if (document.numPages < 1 || document.numPages > 20) return unavailable("page-limit");
      const rows: RcPayslipTextRow[] = [];
      let itemCount = 0, characterCount = 0;
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        const textItems: RcPayslipTextItem[] = [];
        for (const item of content.items) {
          if (!("str" in item) || !item.str.trim()) continue;
          itemCount++; characterCount += item.str.length;
          if (itemCount > 100_000 || characterCount > 1_000_000) return unavailable("text-limit");
          textItems.push({ text: item.str, x: item.transform[4], y: item.transform[5], width: item.width, height: item.height });
        }
        textItems.sort((a, b) => b.y - a.y || a.x - b.x);
        const grouped: RcPayslipTextItem[][] = [];
        for (const item of textItems) {
          const previous = grouped.at(-1);
          if (previous && Math.abs(previous[0].y - item.y) <= 2) previous.push(item); else grouped.push([item]);
        }
        grouped.forEach((items, index) => rows.push({ page: pageNumber, line: index + 1, items: items.sort((a, b) => a.x - b.x) }));
        page.cleanup();
      }
      return consume(rows);
    })()]);
  } catch { return unavailable("pdf-unreadable"); }
  finally { if (timer) clearTimeout(timer); await task?.destroy().catch(() => {}); }
}

/** PDF traité en mémoire ; seuls les composants explicites de RC quittent ce lecteur. */
export function extractRcPayslip(bytes: Uint8Array): Promise<RcPayslipExtraction> {
  return withRcPayslipRows(bytes, parseRcPayslipRows, (code) => result("review", code));
}

const FORMAT_TOKENS = new Set(["BASE", "PART", "SALARIE", "SALARIAL", "SALARIALE", "SALARIALES", "EMPLOYEUR", "PATRONAL", "PATRONALE", "PATRONALES", "TAUX", "OU", "%", "MONTANT", "GAINS", "GAIN", "RETENUE", "RETENUES", "A", "PAYER", "DEDUCTION", "DEDUCTIONS", "DESIGNATION", "LIBELLE", "CHARGES", "COTISATIONS", "NET", "BRUT", "IMPOT", "IMPOTS", "SUR", "REVENU", "DE", "DU", "DES", "LA", "LE"]);
const FORMAT_ANCHORS = new Set(["BASE", "PART", "SALARIE", "SALARIAL", "SALARIALE", "SALARIALES", "EMPLOYEUR", "TAUX", "MONTANT", "GAINS", "GAIN", "RETENUE", "RETENUES", "DESIGNATION", "LIBELLE"]);
for (const token of ['MONTANTS','SALARIES','SALARIAUX','EMPLOYEURS','PATRONAUX','PARTS','NOMBRE','VALEUR','VERSER','RETENIR','COTISATION','CHARGE','TOTAL','AMOUNT','AMOUNTS','BASIS','RATE','EMPLOYEE','EMPLOYER','EARNINGS','DEDUCTIONS','WITHHOLDINGS','GROSS']) {
  FORMAT_TOKENS.add(token); FORMAT_ANCHORS.add(token);
}
const CHARGE_TOKENS = new Set([...FORMAT_TOKENS, "INDEMNITE", "INDEMNITES", "RUPTURE", "RUPTURES", "CONVENTIONNELLE", "CONVENTIONNELLES", "RC", "CONTRIBUTION", "CONTRIBUTIONS", "COTISATION", "COTISATIONS", "EXONERE", "EXONEREE", "EXONEREES", "EXONERES", "SOUMIS", "SOUMISE", "SOUMISES", "ASSIETTE", "FORFAIT", "SOCIAL", "SOCIALE", "SOCIALES", "SOCIAUX", "CSG", "CRDS", "AUTRE", "AUTRES", "DUE", "DUES", "DUS", "RETRAITE", "LICENCIEMENT", "DEPART", "DEPARTS", "MISE", "NON", "ET", "PAR", "L", "TRANSACTIONNELLE", "TRANSACTIONNELLES"]);
for (const token of ["EQUILIBRE", "GENERAL", "GENERALE", "TECHNIQUE", "DIALOGUE", "SOLIDARITE", "AUTONOMIE", "FORMATION", "AGIRC", "ARRCO", "CTP", "CONTRIB", "COT", "PAT", "INDEM", "RUPT", "CONV", "FINANCEMENT"]) CHARGE_TOKENS.add(token);
type FormatCell = { tokens: string[]; x: number; y: number; width: number };
type PositionOnly = { x: number; y: number; width: number };
export type RcPayslipFormat = {
  parserVersion: string; extractionStatus: RcPayslipExtraction["status"]; extractionCode: string;
  costStatus?: RcPayslipCost['status']; costCode?: string;
  pageCount: number; rowCount: number;
  headers: { page: number; line: number; cells: FormatCell[] }[];
  rcRows: { page: number; line: number; monetaryCellCount: number; cells: PositionOnly[] }[];
  chargeCandidates: {
    page: number; line: number; labelTokens: string[]; monetaryCells: PositionOnly[]; numericCells: PositionOnly[];
    qualifiers: { explicitRc: boolean; indemnity: boolean; contribution: boolean; forfaitSocial: boolean; employer: boolean; employee: boolean; employeeDeduction: boolean; basis: boolean; exempt: boolean; liable: boolean; mixedDeparture: boolean; genericOther: boolean; hasCtp719: boolean; equilibriumContribution: boolean; abbreviatedRc: boolean; abbreviatedCharge: boolean };
  }[];
};
const position = (item: RcPayslipTextItem): PositionOnly => ({ x: Math.round(item.x * 100) / 100, y: Math.round(item.y * 100) / 100, width: Math.round(item.width * 100) / 100 });
const emptyFormat = (code: string): RcPayslipFormat => ({ parserVersion: RC_PARSER_VERSION, extractionStatus: "review", extractionCode: code, pageCount: 0, rowCount: 0, headers: [], rcRows: [], chargeCandidates: [] });

/** Diagnostic de géométrie : vocabulaire fermé, aucune valeur, aucun libellé libre, nom ou identifiant. */
export function inspectRcPayslipRows(rows: RcPayslipTextRow[]): RcPayslipFormat {
  const extracted = parseRcPayslipRows(rows);
  if (extracted.code === "unreadable-text") return emptyFormat(extracted.code);
  const headers: RcPayslipFormat["headers"] = [];
  const rcRows: RcPayslipFormat["rcRows"] = [];
  const chargeCandidates: RcPayslipFormat["chargeCandidates"] = [];
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const cells = row.items.flatMap((item): FormatCell[] => {
      const tokens = (normalized(item.text).match(/[a-z]+|%/g) ?? []).map((word) => word.toUpperCase()).filter((word) => FORMAT_TOKENS.has(word));
      return tokens.length ? [{ tokens, ...position(item) }] : [];
    });
    if (headers.length < 80 && cells.some((cell) => cell.tokens.some((token) => FORMAT_ANCHORS.has(token)))) headers.push({ page: row.page, line: row.line, cells });
    const previous = rows[index - 1];
    if (rcRows.length < 20 && (explicitRc(plain(row)) || previous?.page === row.page && previous.line + 1 === row.line && !monetaryItems(previous).length && /\bindemnite/.test(normalized(plain(previous))) && explicitRc(`${plain(previous)} ${plain(row)}`))) {
      const monetary = monetaryItems(row);
      rcRows.push({ page: row.page, line: row.line, monetaryCellCount: monetary.length, cells: monetary.map(position) });
    }
    const text = normalized(plain(row));
    const hasCtp719 = /\bctp[\s:.-]*719\b/.test(text);
    const abbreviatedRc = /\brc\b|\brupt\.?\s+(?:conv\.?|conventionnelles?)\b|\bruptures?\s+conv\b/.test(text);
    const abbreviatedCharge = /\b(?:contrib|cot|pat)\b/.test(text);
    if (chargeCandidates.length < 80 && (hasCtp719 || /\b(?:ruptures?|conventionnelles?|contributions?|cotisations?|forfait social|rc|contrib|cot|pat|rupt|conv)\b/.test(text))) {
      const labelTokens = (text.match(/[a-z]+|%/g) ?? []).map((word) => word.toUpperCase()).filter((word) => CHARGE_TOKENS.has(word));
      const exempt = /\b(?:exonere(?:e|es|s)?|non soumis(?:e|es)?)\b/.test(text);
      chargeCandidates.push({
        page: row.page, line: row.line, labelTokens, monetaryCells: monetaryItems(row).map(position),
        // Forme numérique seulement : quantités et taux restent visibles par leur géométrie, jamais par leur valeur.
        numericCells: numberItems(row).filter((item) => /^[\s+−–()\-]*\d[\d\s.,%€)\u00a0\u202f]*$/.test(item.text.trim())).map(position),
        qualifiers: {
          explicitRc: /\bruptures? conventionnelles?\b/.test(text),
          indemnity: /\bindemnites?\b/.test(text), contribution: /\b(?:contributions?|cotisations?)\b/.test(text),
          forfaitSocial: /\bforfait social\b/.test(text), employer: /\b(?:employeurs?|patronal(?:e|es)?|patronaux)\b/.test(text),
          employee: /\b(?:salaries?|salarial(?:e|es)?|salariaux)\b/.test(text), employeeDeduction: /\b(?:csg|crds)\b/.test(text),
          basis: /\b(?:base|assiette)\b/.test(text), exempt, liable: !exempt && /\bsoumis(?:e|es)?\b/.test(text),
          mixedDeparture: /\b(?:licenciement|retraite|transactionnelles?)\b/.test(text), genericOther: /\bautres? (?:contributions?|cotisations?)\b/.test(text),
          hasCtp719, equilibriumContribution: /\b(?:contributions?|contrib)\b/.test(text) && /\bequilibre\b/.test(text), abbreviatedRc, abbreviatedCharge,
        },
      });
    }
  }
  return { parserVersion: RC_PARSER_VERSION, extractionStatus: extracted.status, extractionCode: extracted.code, costStatus: extracted.cost?.status, costCode: extracted.cost?.code, pageCount: Math.max(...rows.map((row) => row.page)), rowCount: rows.length, headers, rcRows, chargeCandidates };
}

export function inspectRcPayslipFormat(bytes: Uint8Array): Promise<RcPayslipFormat> {
  return withRcPayslipRows(bytes, inspectRcPayslipRows, emptyFormat);
}
