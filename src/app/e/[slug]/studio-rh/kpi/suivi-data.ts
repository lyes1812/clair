import { categoryMonth, categoryOfContract, getCategoryNatures, getContractCategories, type CategoryMonth, type CategoryNatures, type ContractCategories } from "@/lib/budget/categories";
import { CATEGORY_IDS, CATEGORY_LABELS } from "@/lib/budget/types";
import { confidentialiteSettingReason, getConfidentialite, isHidden, linkFromReferential, maskGroups, maskReason, personsOfContracts, SEUIL_NON_DEFINI, type ConfidentialiteSetting, type MaskInput, type PersonLink, type PersonsOfContracts } from "@/lib/confidentialite";
import { groupInput, NO_GROUP } from "@/lib/croisee/confidentialite";
import { formatDate, monthEnd } from "@/lib/dates";
import { contractNatureLabel } from "@/lib/dsn/labels";
import { coverageAt, gateAt, headcountAt } from "@/lib/rh/headcount";
import { kpiDashboard } from "@/lib/rh/kpi/dashboard";
import { etpMonthEnd } from "@/lib/rh/kpi/etp";
import { civilWindow, closedMonths, countedOpts, defaultYear, lastClosedMonth, previousWindow, rollingWindow, selectableYears } from "@/lib/rh/kpi/period";
import type { KpiDashboard, KpiInput, KpiScope, Window } from "@/lib/rh/kpi/types";
import { loadKpiContext, type KpiContext } from "@/lib/rh/kpi-context";
import type { PayfitHistoryLimit } from "@/lib/rh/raw-history";
import type { RhBuildData } from "@/lib/rh/referential/types";
import type { Shown } from "@/lib/rh/view";
import { seuilOf, type CategoryCellIn, type SeuilRead } from "@/lib/viz/kpi";
import { resolveKpiVue, type KpiVue } from "./tabs";

// Chargement commun de KPI RH (page et export) : contexte, mois clos, paramètres d'adresse (mode, fin, année, établissement,
// nature ; une valeur invalide est remplacée par le défaut et signalée), fenêtre, tableau de bord, seuil de confidentialité de l'espace
// (module partagé, sans valeur par défaut) et garde du périmètre retenu par un filtre. Rien n'est enregistré.
type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

// Couverture d'un mois du tableau : complet, borne basse ou n.d. avec la raison.
export function coverageShown(data: RhBuildData, month: string, establishments?: string[], raw?: PayfitHistoryLimit | null): Shown {
  const ref = data.build.referenceDate;
  if (ref && monthEnd(month) > ref) return { text: `n.d. — mois non clos à la date de référence (${formatDate(ref)})`, kind: "nd" };
  const cov = coverageAt(data, month, establishments);
  const g = gateAt(data, monthEnd(month), establishments);
  if (g.nd) return { text: `n.d. — ${g.nd.reason}`, kind: "nd" };
  const lower = cov.filter((c) => c.presenceStatus === "lower_bound");
  if (lower.length) return { text: "borne basse", kind: "lower", foot: lower[0].presenceReason ?? undefined };
  // Historique PayFit brut : mois antérieur à la limite de conservation, calculé sur ce que l'API renvoie (mention en tête).
  if (raw && month >= raw.lowerFrom && month <= raw.lowerTo) return { text: "brut (API PayFit)", kind: "value" };
  return { text: "complet", kind: "value" };
}

// Colonnes du tableau « Mois par mois » : toutes pour le Suivi ; Turnover et Absentéisme n'en montrent qu'une sélection.
export const SUIVI_COLUMNS = ["coverage", "headcount", "etp", "etp-prorated", "entries", "exits", "theoretical", "absence-days", "absenteeism", "etp-n1", "absenteeism-n1"] as const;
export type SuiviColumn = (typeof SUIVI_COLUMNS)[number];
const TURNOVER_COLUMNS: string[] = ["coverage", "headcount", "entries", "exits"];
const ABSENCE_COLUMNS: string[] = ["coverage", "theoretical", "absence-days", "absenteeism", "absenteeism-n1"];
export const suiviColumnOn = (vue: KpiVue, c: string): boolean => vue === "suivi" || (vue === "turnover" ? TURNOVER_COLUMNS.includes(c) : ABSENCE_COLUMNS.includes(c));

type Ready = {
  kind: "ready";
  ctx: KpiContext & { input: KpiInput };
  data: RhBuildData;
  open: string[];
  rawLimit: PayfitHistoryLimit | null;
  closed: string[];
  last: string;
  years: { year: number; closed: boolean }[];
  vue: KpiVue;
  mode: "civil" | "glissant";
  fin: string;
  year: number;
  etab: string;
  nature: string;
  w: Window;
  input: KpiInput; // entrée du moteur avec le périmètre choisi (établissement, nature)
  dash: KpiDashboard;
  notices: string[]; // paramètres écartés, avec leur raison (la page y ajoute ceux du détail)
  confidentialite: ConfidentialiteSetting; // seuil de l'espace, transmis aux répartitions de l'écran et de l'export
  guard: ScopeGuard | null; // périmètre retenu par un filtre (établissement, nature) sous le seuil ou seuil non défini : tout l'écran n.d.
};
export type KpiSuivi =
  | { kind: "no-input"; ctx: KpiContext }
  | { kind: "settings-invalid"; ctx: KpiContext & { input: KpiInput }; last: string | null }
  | { kind: "no-closed-month"; ctx: KpiContext & { input: KpiInput }; data: RhBuildData }
  | Ready;

// Fonction pure (le contexte et le seuil sont déjà chargés) : mêmes règles que l'écran pour chaque paramètre d'adresse.
export function kpiSuiviOf(ctx: KpiContext, sp: Search, confidentialite: ConfidentialiteSetting): KpiSuivi {
  if (!ctx.input) return { kind: "no-input", ctx };
  const c = ctx as KpiContext & { input: KpiInput };
  const data = c.input.data;
  const open = c.input.openMonths ?? [];
  const rawLimit = ctx.collab.payfitHistory?.mode === "raw" ? ctx.collab.payfitHistory.limit : null;
  const closed = closedMonths(data, open);
  const last = lastClosedMonth(data, open);
  if (ctx.settings.invalid.length) return { kind: "settings-invalid", ctx: c, last };
  if (!last) return { kind: "no-closed-month", ctx: c, data };

  const notices: string[] = [];
  const ignore = (k: string, v: string, why: string) => notices.push(`paramètre ignoré : ${k}=${v} (${why})`);
  const vue = resolveKpiVue(one(sp.vue));
  const rawMode = one(sp.mode);
  const mode = rawMode === "civil" ? "civil" : "glissant";
  if (rawMode && rawMode !== "civil" && rawMode !== "glissant") ignore("mode", rawMode, "valeurs possibles : glissant, civil");
  const rawFin = one(sp.fin);
  const fin = closed.includes(rawFin) ? rawFin : last;
  if (rawFin && rawFin !== fin) ignore("fin", rawFin, "hors des mois clos");
  const years = selectableYears(data, open);
  const rawYear = one(sp.annee);
  const year = years.some((y) => String(y.year) === rawYear) ? Number(rawYear) : defaultYear(data, open)!;
  if (rawYear && String(year) !== rawYear) ignore("annee", rawYear, "hors des années couvertes");
  const rawEtab = one(sp.etab);
  const etab = ctx.collab.establishments.some((e) => e.id === rawEtab) ? rawEtab : "";
  if (rawEtab && !etab) ignore("etab", rawEtab, "établissement inconnu");
  const rawNature = one(sp.nature);
  const nature = ctx.collab.natures.codes.includes(rawNature) ? rawNature : "";
  if (rawNature && !nature) ignore("nature", rawNature, "nature non comptée dans l'effectif");

  const w: Window = mode === "civil" ? civilWindow(year) : rollingWindow(fin);
  const input: KpiInput = { ...c.input, scope: { establishments: etab ? [etab] : undefined, nature: nature || undefined } };
  // Garde du périmètre : les mois de la période et de N-1 (tuiles, colonnes N-1 du tableau).
  const guard = scopeGuard({ input, months: [...w.months, ...previousWindow(w).months], establishments: ctx.collab.establishments.map((e) => e.id), natures: ctx.collab.natures.codes, confidentialite });
  return { kind: "ready", ctx: c, data, open, rawLimit, closed, last, years, vue, mode, fin, year, etab, nature, w, input, dash: kpiDashboard(input, w), notices, confidentialite, guard };
}

export async function loadKpiSuivi(slug: string, sp: Search): Promise<KpiSuivi> {
  const ctx = await loadKpiContext(slug, {});
  return kpiSuiviOf(ctx, sp, await getConfidentialite(ctx.collab.workspace.id));
}

// --- Garde du périmètre (filtres Établissement et Nature) ---------------------------------------------------------------------------
// Sous un filtre Établissement ou Nature, tous les chiffres de l'écran (tuiles, tableau mensuel, tableau par catégorie, détails) décrivent
// un seul groupe de personnes : le périmètre retenu. Comme le service retenu de la Masse salariale (serviceGuard), il est n.d. dans son
// ensemble dès que, un mois de la période ou de N-1, il compte de 1 à (seuil − 1) personnes distinctes ou n'est pas dénombré, et dès que
// le seuil n'est pas défini (lien vers les Paramètres). Masquage secondaire : chaque mois, le périmètre est une cellule d'une
// répartition dont le total est publié (l'effectif de fin de mois de l'entreprise, ou de l'établissement retenu) ; les autres valeurs du
// même filtre (les autres natures comptées, les autres établissements, le reste sans établissement) forment les autres cellules, et le
// moteur partagé masque le périmètre quand il protégerait seul une valeur masquée (sinon le filtre révélerait par différence ce que le
// masquage cache). Rien n'est recalculé : les groupes sont ceux de l'effectif de fin de mois (headcountAt, mêmes contrats que les
// indicateurs), en personnes reliées par le référentiel. null : aucun filtre, ou périmètre affiché.
export type ScopeGuard = { cause: "parametre" | "seuil"; reason: string };
type ScopeGroup = { contracts: string[]; persons: PersonsOfContracts };
export function scopeGuard(p: { input: KpiInput; months: string[]; establishments: string[]; natures: string[]; confidentialite: ConfidentialiteSetting }): ScopeGuard | null {
  const { input, confidentialite } = p;
  const scope = input.scope;
  const etab = scope.establishments?.[0];
  if (etab === undefined && !scope.nature) return null;
  const settingNd = confidentialiteSettingReason(confidentialite);
  if (settingNd !== null || confidentialite.kind !== "set") return { cause: "parametre", reason: settingNd ?? SEUIL_NON_DEFINI };
  const seuil = confidentialite.value;
  const link: PersonLink = new Map(input.data.contracts.flatMap((c) => (c.personKey === null ? [] : [[c.contractKey, c.personKey] as const])));
  const group = (s: KpiScope, m: string): ScopeGroup | null => {
    const h = headcountAt(input.data, monthEnd(m), countedOpts({ ...input, scope: s }));
    return h.kind === "nd" ? null : { contracts: h.contractKeys, persons: personsOfContracts(h.contractKeys, link) };
  };
  const cell = (g: ScopeGroup | null): MaskInput => (g ? groupInput(g.persons, seuil, g.contracts.length) : { size: null, value: null });
  // Reste d'une partition : contrats du périmètre élargi qui ne sont dans aucune valeur du filtre (sans établissement, par exemple).
  const rest = (whole: ScopeGroup | null, parts: (ScopeGroup | null)[]): ScopeGroup | null => {
    if (!whole) return null;
    const seen = new Set(parts.flatMap((g) => g?.contracts ?? []));
    const contracts = whole.contracts.filter((k) => !seen.has(k));
    return contracts.length ? { contracts, persons: personsOfContracts(contracts, link) } : null;
  };
  const partitions: { values: string[]; selected: string; of: (v: string) => KpiScope; whole: KpiScope }[] = [];
  if (scope.nature) partitions.push({ values: p.natures, selected: scope.nature, of: (v) => ({ establishments: scope.establishments, nature: v }), whole: { establishments: scope.establishments } });
  if (etab !== undefined) partitions.push({ values: p.establishments, selected: etab, of: (v) => ({ establishments: [v], nature: scope.nature }), whole: { nature: scope.nature } });
  for (const m of p.months) {
    const selected = group(scope, m);
    if (!selected) continue; // mois n.d. pour le périmètre : aucun chiffre affiché
    for (const part of partitions) {
      const at = part.values.indexOf(part.selected);
      // Valeur inconnue des listes de l'espace : le périmètre seul, masquage principal (jamais une valeur affichée sans contrôle).
      if (at < 0) {
        const [st] = maskGroups([cell(selected)], seuil, false);
        if (isHidden(st)) return { cause: "seuil", reason: maskReason(st, seuil)! };
        continue;
      }
      const groups = part.values.map((v) => group(part.of(v), m));
      const extra = rest(group(part.whole, m), groups);
      const st = maskGroups([...groups, ...(extra ? [extra] : [])].map(cell), seuil, true);
      if (isHidden(st[at])) return { cause: "seuil", reason: maskReason(st[at], seuil)! };
    }
  }
  return null;
}

// Effectif et ETP par catégorie (Suivi) : un calcul par mois de la fenêtre, sur l'entrée FILTRÉE des indicateurs (établissement,
// nature) : la somme des catégories égale la tuile « ETP contractuel fin de mois » du même périmètre. Seules les catégories
// présentes au moins un mois sont des colonnes ; `hidden` : catégories présentes dans toute l'entreprise sur la période mais sans
// contrat dans le périmètre retenu (aucune colonne ; la mention sous le tableau les nomme). Jamais un zéro à leur place.
// Seuil de confidentialité : c'est une répartition par catégorie ; chaque mois, chaque catégorie est une cellule comptée en personnes
// distinctes (contrats de l'ETP de fin de mois reliés par le référentiel) et masquée par le moteur partagé, le total du mois (effectif
// et ETP du périmètre, publiés dans les indicateurs) portant le masquage secondaire ; seuil absent ou illisible : cellules n.d. avec
// la raison du paramètre. Le total de chaque mois n'est jamais masqué. `masked` : cellules masquées par le seuil.
export type CategoryMonthMasked =
  | { kind: "value"; month: string; lowerBound: boolean; byCategory: Record<string, CategoryCellIn>; total: { headcount: number; etp4: number | null } }
  | { kind: "nd"; month: string; reason: string };
export type CategoryMonths = { months: CategoryMonthMasked[]; keys: string[]; hidden: string[]; seuil: SeuilRead; masked: number };
export const CATEGORY_TABLE_LABELS: Record<string, string> = { ...CATEGORY_LABELS, nc: "Non classé" };
const categoryKeys = (months: CategoryMonth[]) => [...CATEGORY_IDS, "nc"].filter((k) => months.some((c) => c.kind === "value" && c.byCategory[k]));

// Personnes distinctes de chaque catégorie un mois donné : les contrats que categoryMonth compte (contributions et contrats sans quotité
// de l'ETP de fin de mois), rangés par la même règle de catégorie, reliés à leur personne par le référentiel ; mois n.d. : aucun groupe.
function categoryPersons(kpi: KpiInput, month: string, natures: CategoryNatures, overrides: ContractCategories, link: PersonLink): Record<string, PersonsOfContracts> {
  const e = etpMonthEnd(kpi, month);
  if (e.kind === "nd") return {};
  const byKey = new Map(kpi.data.contracts.map((c) => [c.contractKey, c]));
  const ids = new Map<string, Set<string>>();
  for (const x of [...e.contributions, ...e.missing]) {
    const c = byKey.get(x.contractKey);
    const k = (c ? categoryOfContract(c.externalId, c.nature, natures, overrides) : null) ?? "nc";
    let s = ids.get(k);
    if (!s) ids.set(k, (s = new Set()));
    s.add(x.externalId);
  }
  return Object.fromEntries([...ids].map(([k, s]) => [k, personsOfContracts(s, link)]));
}

// Mois après seuil : total (effectif, ETP n.d. dès qu'une catégorie l'est) calculé avant masquage et jamais modifié ; chaque colonne du
// tableau est une cellule (valeur : l'effectif affiché ; une catégorie sans contrat ce mois-là : 0, ne désigne personne), masquage
// principal et secondaire du moteur partagé avec la même raison ; seuil absent ou illisible : chaque cellule n.d. avec la raison.
function maskCategoryMonth(c: CategoryMonth, keys: string[], groups: Record<string, PersonsOfContracts>, read: SeuilRead): { month: CategoryMonthMasked; masked: number } {
  if (c.kind === "nd") return { month: c, masked: 0 };
  const all = Object.values(c.byCategory);
  const total = { headcount: all.reduce((n, x) => n + x.headcount, 0), etp4: all.some((x) => x.etp4 === null) ? null : all.reduce((n, x) => n + (x.etp4 ?? 0), 0) };
  const base = { kind: "value" as const, month: c.month, lowerBound: c.lowerBound, total };
  if (read.seuil === null) return { month: { ...base, byCategory: Object.fromEntries(keys.map((k) => [k, { kind: "nd", reason: read.reason }])) }, masked: 0 };
  const seuil = read.seuil;
  const st = maskGroups(keys.map((k) => groupInput(groups[k] ?? NO_GROUP, seuil, c.byCategory[k]?.headcount ?? 0)), seuil, true);
  const byCategory: Record<string, CategoryCellIn> = {};
  let masked = 0;
  keys.forEach((k, i) => {
    const x = c.byCategory[k];
    if (isHidden(st[i])) {
      masked += 1;
      byCategory[k] = { kind: "nd", reason: maskReason(st[i], seuil)! };
    } else if (x) byCategory[k] = { kind: "value", headcount: x.headcount, etp4: x.etp4 };
  });
  return { month: { ...base, byCategory }, masked };
}

export async function loadCategoryMonths(kpi: KpiInput, w: Window, workspaceId: string, confidentialite: ConfidentialiteSetting): Promise<CategoryMonths> {
  const [catNatures, catOverrides] = await Promise.all([getCategoryNatures(workspaceId), getContractCategories(workspaceId)]);
  const monthsOf = (input: KpiInput) => w.months.map((m) => categoryMonth(input, m, catNatures.natures, catOverrides));
  const raw = monthsOf(kpi);
  const keys = categoryKeys(raw);
  const scoped = Boolean(kpi.scope.establishments?.length || kpi.scope.nature);
  const hidden = scoped ? categoryKeys(monthsOf({ ...kpi, scope: {} })).filter((k) => !keys.includes(k)) : [];
  const read = seuilOf(confidentialite);
  const link = linkFromReferential(kpi.data);
  let masked = 0;
  const months = raw.map((c) => {
    const r = maskCategoryMonth(c, keys, categoryPersons(kpi, c.month, catNatures.natures, catOverrides, link), read);
    masked += r.masked;
    return r.month;
  });
  return { months, keys, hidden, seuil: read, masked };
}

// Mention du périmètre du tableau par catégorie (sous le tableau à l'écran, note de la feuille Excel) quand un filtre
// Établissement ou Nature est retenu ; null sans filtre. Les catégories hors du périmètre sont nommées, sans colonne ni zéro.
export function categoryScopeNote(s: Pick<Ready, "etab" | "nature" | "ctx">, hidden: string[], labels: Record<string, string> = CATEGORY_TABLE_LABELS): string | null {
  const etab = s.etab ? (s.ctx.collab.establishments.find((e) => e.id === s.etab)?.label ?? s.etab) : null;
  const filters = [etab ? `établissement ${etab}` : null, s.nature ? `nature ${contractNatureLabel(s.nature)}` : null].filter((x): x is string => x !== null);
  if (!filters.length) return null;
  const out = hidden.length ? ` ; hors de ce périmètre, sans colonne : ${hidden.map((k) => labels[k] ?? k).join(", ")}` : "";
  return `Filtres appliqués : ${filters.join(" · ")}. Mêmes contrats que les indicateurs${out}.`;
}
