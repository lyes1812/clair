import { toCents } from "@/lib/money";
import type { GridChange } from "./store";
import type { Hypothesis } from "./types";

// Lot 5 : lecture des grilles de saisie (taux d'augmentation, enveloppes, constantes, bases individuelles). Fonctions
// pures : elles comparent la saisie aux hypothèses existantes et rendent les lignes à enregistrer et à supprimer ;
// le moteur contrôle ensuite le scénario final (store.applyChanges). Une saisie illisible refuse la grille entière.

type Aug = Extract<Hypothesis, { kind: "augmentation" }>;
type Env = Extract<Hypothesis, { kind: "enveloppe" }>;
type Cst = Extract<Hypothesis, { kind: "constante" }>;
type Fix = Extract<Hypothesis, { kind: "base" }>;

const blank = (v: string | undefined) => (v ?? "").trim() === "";
export const scopeKeyOf = (s: Aug["scope"]): string | null => (s.kind === "global" ? "global" : s.kind === "service" ? `service:${s.service}` : s.kind === "statut" ? (s.executive ? "statut:dirigeant" : "statut:autres") : null);
export const scopeLabelOf = (key: string) => (key === "global" ? "toute l'entreprise" : key === "statut:dirigeant" ? "cadres dirigeants" : key === "statut:autres" ? "hors cadres dirigeants" : `service ${key.slice(8)}`);
const parseScope = (key: string): Aug["scope"] | null =>
  key === "global" ? { kind: "global" } : key === "statut:dirigeant" ? { kind: "statut", executive: true } : key === "statut:autres" ? { kind: "statut", executive: false } : key.startsWith("service:") && key.length > 8 ? { kind: "service", service: key.slice(8) } : null;

// --- Taux d'augmentation : une ligne par périmètre (toute l'entreprise, chaque service), une colonne par mois.
// Chaque cellule renseignée est une hypothèse d'augmentation distincte ; 0 ou vide : aucune augmentation ce mois-là.
export type RateCell = { scope: string; month: string; raw: string };
export function planRates(existing: Hypothesis[], cells: RateCell[], newId: () => string): GridChange {
  const at = new Map<string, Aug>();
  for (const h of existing) {
    if (h.kind !== "augmentation") continue;
    const k = scopeKeyOf(h.scope);
    if (k) at.set(`${k}|${h.from}`, h);
  }
  const out: GridChange = { put: [], remove: [] };
  for (const c of cells) {
    const scope = parseScope(c.scope);
    if (!scope) throw new Error("Périmètre de la grille invalide.");
    const prior = at.get(`${c.scope}|${c.month}`);
    const bps = blank(c.raw) ? 0 : toCents(c.raw);
    if (bps === null) throw new Error(`${scopeLabelOf(c.scope)}, ${c.month} : taux en pourcentage requis (ex. 2,5).`);
    if (bps === 0) {
      if (prior) out.remove.push(prior.id);
      continue;
    }
    if (prior?.rateBps === bps) continue;
    out.put.push(prior ? { ...prior, rateBps: bps } : { id: newId(), kind: "augmentation", label: `Augmentation ${scopeLabelOf(c.scope)} ${c.month}`, from: c.month, rateBps: bps, scope });
  }
  return out;
}

// --- Enveloppes : une ligne par centre de coûts (axe « service ») ou par rubrique libre (axe « rubrique »).
export type EnvRow = { id: string | null; target: string; mode: "brut" | "charge"; taux: string; nonRecurring: boolean; del: boolean; cells: Record<string, string> };
export function planEnvelopes(axis: Env["axis"], rows: EnvRow[], existing: Hypothesis[], newId: () => string): GridChange {
  const mine = new Map(existing.filter((h): h is Env => h.kind === "enveloppe" && h.axis === axis).map((h) => [h.id, h]));
  const what = axis === "service" ? "centre de coûts" : "rubrique";
  const out: GridChange = { put: [], remove: [] };
  rows.forEach((r, i) => {
    const empty = blank(r.target) && Object.values(r.cells).every(blank);
    if (r.id !== null && !mine.has(r.id)) throw new Error(`Ligne ${i + 1} : enveloppe inconnue, rechargez la page.`);
    if (r.del) {
      if (r.id !== null) out.remove.push(r.id);
      return;
    }
    if (r.id === null && empty) return;
    const target = r.target.trim();
    if (!target) throw new Error(`Ligne ${i + 1} : ${what} requis.`);
    const monthly: Record<string, number> = {};
    for (const [m, raw] of Object.entries(r.cells)) {
      if (blank(raw)) continue;
      const c = toCents(raw);
      if (c === null) throw new Error(`${target}, ${m} : montant en euros requis (ex. 12 500,00).`);
      monthly[m] = c;
    }
    if (Object.keys(monthly).length === 0) throw new Error(`${target} : aucun montant renseigné (cochez « Supprimer » pour retirer la ligne).`);
    let chargesBps: number | null = null;
    if (r.mode === "brut") {
      const t = blank(r.taux) ? null : toCents(r.taux);
      if (t === null || t < 0) throw new Error(`${target} : taux de charges requis pour une saisie en brut (ex. 42).`);
      chargesBps = t;
    }
    const prior = r.id ? mine.get(r.id)! : null;
    out.put.push({ id: prior?.id ?? newId(), kind: "enveloppe", label: `Enveloppe ${target}`, axis, target, monthly, chargesBps, ...(r.nonRecurring ? { nonRecurring: true } : {}) });
  });
  return out;
}

// --- Constantes de référence : une ligne par constante (libellé, unité, source), une colonne par mois.
export type CstRow = { id: string | null; label: string; unit: Cst["unit"]; source: string; del: boolean; cells: Record<string, string> };
export function planConstants(rows: CstRow[], existing: Hypothesis[], newId: () => string): GridChange {
  const mine = new Map(existing.filter((h): h is Cst => h.kind === "constante").map((h) => [h.id, h]));
  const out: GridChange = { put: [], remove: [] };
  rows.forEach((r, i) => {
    const empty = blank(r.label) && blank(r.source) && Object.values(r.cells).every(blank);
    if (r.id !== null && !mine.has(r.id)) throw new Error(`Ligne ${i + 1} : constante inconnue, rechargez la page.`);
    if (r.del) {
      if (r.id !== null) out.remove.push(r.id);
      return;
    }
    if (r.id === null && empty) return;
    const label = r.label.trim();
    if (!label) throw new Error(`Ligne ${i + 1} : libellé requis.`);
    if (!["eur", "pct", "nombre"].includes(r.unit)) throw new Error(`${label} : unité invalide.`);
    const values: Record<string, number> = {};
    for (const [m, raw] of Object.entries(r.cells)) {
      if (blank(raw)) continue;
      const c = toCents(raw);
      if (c === null) throw new Error(`${label}, ${m} : valeur numérique requise (ex. 4 005,00).`);
      values[m] = c;
    }
    if (blank(r.source)) throw new Error(`${label} : source requise (texte légal, convention, saisie interne…).`);
    out.put.push({ id: r.id ?? newId(), kind: "constante", label, unit: r.unit, values, source: r.source.trim() });
  });
  return out;
}

// --- Bases individuelles : une ligne par contrat de la base ; salaire et taux de charges tous deux renseignés = base
// corrigée, tous deux vides = pas de correction (la correction existante est retirée).
export type BaseRow = { contractKey: string; label: string; salary: string; charges: string };
export function planBases(rows: BaseRow[], existing: Hypothesis[], newId: () => string): GridChange {
  const fixes = new Map(existing.filter((h): h is Fix => h.kind === "base").map((h) => [h.contractKey, h]));
  const out: GridChange = { put: [], remove: [] };
  for (const r of rows) {
    const prior = fixes.get(r.contractKey);
    if (blank(r.salary) && blank(r.charges)) {
      if (prior) out.remove.push(prior.id);
      continue;
    }
    if (blank(r.salary) || blank(r.charges)) throw new Error(`${r.label} : salaire et taux de charges vont ensemble (les deux, ou aucun pour retirer la correction).`);
    const salaryCents = toCents(r.salary);
    const chargesBps = toCents(r.charges);
    if (salaryCents === null || salaryCents < 0) throw new Error(`${r.label} : salaire mensuel de base en euros requis (0 : contrat non payé).`);
    if (chargesBps === null || chargesBps < 0) throw new Error(`${r.label} : taux de charges en pourcentage requis (ex. 42,5).`);
    if (prior && prior.salaryCents === salaryCents && prior.chargesBps === chargesBps) continue;
    out.put.push({ id: prior?.id ?? newId(), kind: "base", label: prior?.label ?? `Base de ${r.label}`, contractKey: r.contractKey, salaryCents, chargesBps });
  }
  return out;
}
