import type { CategoryNatures, ContractCategories } from "@/lib/budget/categories";
import { monthlyGrid, type EtpService, type RealSource } from "@/lib/budget/monthly";
import { isMonth, monthRange } from "@/lib/connectors/months";
import type { CollectionDiff } from "@/lib/connectors/sync";
import type { JournalInput } from "@/lib/payroll/engine";
import { pennylaneCoverage } from "@/lib/payroll/lot2";
import { KPI_PARSERS, type KpiSettingKey } from "@/lib/rh-kpi-settings";
import { absenceByMotif } from "@/lib/rh/kpi/absence-motifs";
import { absenteeism } from "@/lib/rh/kpi/absence";
import { etpMonthEnd } from "@/lib/rh/kpi/etp";
import { etpProratedMonth } from "@/lib/rh/kpi/etp-prorata";
import { turnover } from "@/lib/rh/kpi/turnover";
import type { KpiInput, Ratio, Window } from "@/lib/rh/kpi/types";

export { buildContractServiceMap } from "@/lib/payroll/service-map";

// Opérations d'administration d'un espace (scripts/workspace-admin.mts) : tout ce qui se décide sans lire ni écrire en base.
// Le script ne fait que lire et écrire ; arguments, plans de modification, plages de mois et diagnostics sont ici.
// Ce module importe pourtant les calculs de l'écran (budget/monthly, réglages KPI), donc le client de base : une DATABASE_URL
// doit être définie à l'import (aucune connexion n'est ouverte).

// --- Arguments

export type AdminCommand = "absence-types" | "kpi-settings" | "pennylane-sync" | "probe";
const COMMANDS: AdminCommand[] = ["absence-types", "kpi-settings", "pennylane-sync", "probe"];
const isCommand = (v: string): v is AdminCommand => (COMMANDS as string[]).includes(v);

// Garde-fous de l'écran Données (launchSync, src/app/e/[slug]/donnees/actions.ts) : mois de fin au plus le mois courant de
// Paris, 24 mois au plus. Ce fichier d'écran (« use server ») n'exporte que des fonctions asynchrones : les valeurs sont
// reprises ici, et un test les compare au texte du fichier d'écran.
export const SYNC_MAX_MONTHS = 24;
export const SYNC_FUTURE_MESSAGE = "Le mois de fin ne peut pas être dans le futur.";
export const syncMaxMonthsMessage = (): string => `${SYNC_MAX_MONTHS} mois au plus par lecture.`;
const parisMonthFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit" });
const parisDayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" });
// Mois courant au calendrier de Paris (AAAA-MM).
export const parisMonth = (now: Date = new Date()): string => parisMonthFormat.format(now);

export const USAGE = [
  "Usage : workspace-admin.mts <commande> <slug-espace> [options]",
  "  absence-types <slug>",
  "      lecture seule : codes présents et retenus, sans aucun compteur",
  "  kpi-settings <slug> --exclude-none --absence-types a,b,c [--dry-run]",
  "      la liste vide des exclusions est enregistrée explicitement (événement d'audit) si la clé n'est pas déjà un réglage enregistré",
  "  pennylane-sync <slug> --from AAAA-MM --to AAAA-MM [--apply [--allow-removals]]",
  `      mois de fin au plus le mois courant (Paris), ${SYNC_MAX_MONTHS} mois au plus ; --apply refuse si des enregistrements sont supprimés ou si des mois couverts`,
  "      par la lecture appliquée ne sont plus dans la plage, sauf --allow-removals",
  "  probe <slug> --months AAAA-MM,AAAA-MM [--old-exclusions 10,20] [--old-absence-types a,b] [--no-rebuild]",
  "      écrit si le référentiel Collaborateurs est périmé ou absent : reconstruction (tables rh_*, événement rh.rebuilt), annoncée dans la sortie",
  "      et refusée sans administrateur ; --no-rebuild refuse au lieu de reconstruire. Une valeur par défaut n'est jamais journalisée :",
  "      si un ancien réglage est introuvable, le fournir par --old-exclusions / --old-absence-types",
].join("\n");

export type ParsedArgs =
  | { ok: false; error: string }
  | { ok: true; command: "absence-types"; slug: string }
  | { ok: true; command: "kpi-settings"; slug: string; excludeNone: true; absenceTypes: string[]; dryRun: boolean }
  | { ok: true; command: "pennylane-sync"; slug: string; from: string; to: string; months: string[]; apply: boolean; allowRemovals: boolean }
  | { ok: true; command: "probe"; slug: string; months: string[]; window: string[]; oldExclusions: string[] | null; oldAbsenceTypes: string[] | null; noRebuild: boolean };

type FlagSpec = { values: string[]; switches: string[] };
const SPECS: Record<AdminCommand, FlagSpec> = {
  "absence-types": { values: [], switches: [] },
  "kpi-settings": { values: ["absence-types"], switches: ["exclude-none", "dry-run"] },
  "pennylane-sync": { values: ["from", "to"], switches: ["apply", "allow-removals"] },
  probe: { values: ["months", "old-exclusions", "old-absence-types"], switches: ["no-rebuild"] },
};

const SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const short = (s: string) => (s.length > 30 ? `${s.slice(0, 30)}…` : s);
export const sortedUnique = (list: string[]): string[] => [...new Set(list)].sort();

type Tokens = { positionals: string[]; values: Map<string, string>; switches: Set<string> };

// Les options se placent avant ou après le slug (premier argument positionnel) ; « --nom valeur » ou « --nom=valeur ».
function tokenize(args: string[], spec: FlagSpec): Tokens | string {
  const positionals: string[] = [];
  const values = new Map<string, string>();
  const switches = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const t = args[i];
    if (!t.startsWith("-") || t === "-") {
      positionals.push(t);
      continue;
    }
    if (!t.startsWith("--")) return `Option inconnue : ${short(t.slice(0, 2))}.`;
    const eq = t.indexOf("=");
    const name = (eq === -1 ? t : t.slice(0, eq)).slice(2);
    const inline = eq === -1 ? null : t.slice(eq + 1);
    if (spec.switches.includes(name)) {
      if (inline !== null) return `L'option --${name} n'attend pas de valeur.`;
      if (switches.has(name)) return `Option répétée : --${name}.`;
      switches.add(name);
      continue;
    }
    if (spec.values.includes(name)) {
      if (values.has(name)) return `Option répétée : --${name}.`;
      let v = inline;
      if (v === null) {
        const next = args[i + 1];
        if (next === undefined || next.startsWith("--")) return `L'option --${name} attend une valeur.`;
        v = next;
        i++;
      }
      if (v === "") return `L'option --${name} attend une valeur.`;
      values.set(name, v);
      continue;
    }
    return `Option inconnue : --${short(name)}.`;
  }
  return { positionals, values, switches };
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

// Liste de codes séparés par des virgules : aucun segment vide. La validation, le tri et le dédoublonnage sont ceux des
// réglages enregistrés (KPI_PARSERS) : une liste acceptée ici est lisible par l'écran KPI.
export function parseCodeList(raw: string, option: string, kind: "absence" | "nature"): Parsed<string[]> {
  const parts = raw.split(",").map((p) => p.trim());
  if (parts.some((p) => p === "")) return { ok: false, error: `${option} : liste vide ou virgule en trop.` };
  const parsed = (kind === "nature" ? KPI_PARSERS.excludedExitNatures : KPI_PARSERS.absenceTypes)(parts);
  if (parsed === null) {
    return { ok: false, error: kind === "nature" ? `${option} : codes de nature à deux chiffres attendus.` : `${option} : codes sans espace, de 128 caractères au plus.` };
  }
  return { ok: true, value: parsed };
}

// Liste de mois AAAA-MM séparés par des virgules, triée et dédoublonnée.
export function parseMonthList(raw: string, option: string): Parsed<string[]> {
  const parts = raw.split(",").map((p) => p.trim());
  if (!parts.every(isMonth)) return { ok: false, error: `${option} : mois au format AAAA-MM séparés par des virgules.` };
  return { ok: true, value: sortedUnique(parts) };
}

// Plage de mois inclusive ; refus si un bout est invalide, si la plage est vide (début après fin), si le mois de fin est
// postérieur au mois courant de Paris ou si elle dépasse SYNC_MAX_MONTHS : mêmes règles et mêmes messages que l'écran Données.
export function parseMonthRange(from: string, to: string, now: Date = new Date()): Parsed<string[]> {
  if (!isMonth(from)) return { ok: false, error: "--from : mois au format AAAA-MM attendu." };
  if (!isMonth(to)) return { ok: false, error: "--to : mois au format AAAA-MM attendu." };
  if (from > to) return { ok: false, error: "Plage de mois vide : --from doit précéder ou égaler --to." };
  if (to > parisMonth(now)) return { ok: false, error: SYNC_FUTURE_MESSAGE };
  // Nombre de mois compté avant de construire la plage : aucune liste démesurée n'est produite avant le refus.
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  if ((ty - fy) * 12 + (tm - fm) + 1 > SYNC_MAX_MONTHS) return { ok: false, error: syncMaxMonthsMessage() };
  return { ok: true, value: monthRange(from, to) };
}

export function parseArgs(argv: string[], now: Date = new Date()): ParsedArgs {
  const [command, ...rest] = argv;
  if (!command) return fail("Commande manquante.");
  if (!isCommand(command)) return fail(`Commande inconnue : ${short(command)}.`);
  const tokens = tokenize(rest, SPECS[command]);
  if (typeof tokens === "string") return fail(tokens);
  const { positionals, values, switches } = tokens;
  if (positionals.length === 0) return fail("Slug de l'espace manquant.");
  if (positionals.length > 1) return fail("Argument en trop après le slug de l'espace.");
  const slug = positionals[0];
  if (!SLUG.test(slug)) return fail("Slug de l'espace invalide.");
  const need = (name: string): string | null => values.get(name) ?? null;

  if (command === "absence-types") return { ok: true, command, slug };

  if (command === "kpi-settings") {
    if (!switches.has("exclude-none")) return fail("--exclude-none est obligatoire : la commande applique « aucune exclusion de nature de sortie ».");
    const raw = need("absence-types");
    if (raw === null) return fail("--absence-types est obligatoire : liste explicite des types d'absence retenus.");
    const list = parseCodeList(raw, "--absence-types", "absence");
    if (!list.ok) return fail(list.error);
    return { ok: true, command, slug, excludeNone: true, absenceTypes: list.value, dryRun: switches.has("dry-run") };
  }

  if (command === "pennylane-sync") {
    const from = need("from");
    const to = need("to");
    if (from === null) return fail("--from est obligatoire (AAAA-MM).");
    if (to === null) return fail("--to est obligatoire (AAAA-MM).");
    const range = parseMonthRange(from, to, now);
    if (!range.ok) return fail(range.error);
    if (switches.has("allow-removals") && !switches.has("apply")) return fail("--allow-removals ne s'utilise qu'avec --apply.");
    return { ok: true, command, slug, from, to, months: range.value, apply: switches.has("apply"), allowRemovals: switches.has("allow-removals") };
  }

  const rawMonths = need("months");
  if (rawMonths === null) return fail("--months est obligatoire (AAAA-MM,AAAA-MM).");
  const months = parseMonthList(rawMonths, "--months");
  if (!months.ok) return fail(months.error);
  const rawExcl = need("old-exclusions");
  const excl = rawExcl === null ? null : parseCodeList(rawExcl, "--old-exclusions", "nature");
  if (excl && !excl.ok) return fail(excl.error);
  const rawTypes = need("old-absence-types");
  const types = rawTypes === null ? null : parseCodeList(rawTypes, "--old-absence-types", "absence");
  if (types && !types.ok) return fail(types.error);
  // Les indicateurs de période couvrent du premier au dernier mois indiqués, mois intermédiaires compris.
  const first = months.value[0];
  const last = months.value[months.value.length - 1];
  return { ok: true, command: "probe", slug, months: months.value, window: monthRange(first, last), oldExclusions: excl ? excl.value : null, oldAbsenceTypes: types ? types.value : null, noRebuild: switches.has("no-rebuild") };
}

// --- Réglages KPI : plan avant / après

export const KPI_ADMIN_KEYS = ["excludedExitNatures", "absenceTypes"] as const satisfies readonly KpiSettingKey[];
export type KpiAdminKey = (typeof KPI_ADMIN_KEYS)[number];
export const KPI_ADMIN_LABELS: Record<KpiAdminKey, string> = {
  excludedExitNatures: "Natures de sortie exclues du turnover",
  absenceTypes: "Types d'absence retenus pour l'absentéisme",
};
export type SettingOrigin = "default" | "setting" | "invalid";
// explicit : valeur identique à la valeur en vigueur, mais à enregistrer quand même (décision de l'administration, clé pas encore enregistrée).
export type KpiPlanRow = { key: KpiAdminKey; label: string; before: string[]; after: string[]; origin: SettingOrigin; changed: boolean; explicit: boolean };
export type KpiPlan =
  | { ok: true; rows: KpiPlanRow[]; changedKeys: KpiAdminKey[] }
  | { ok: false; error: string; unknownCodes: string[]; blockedKeys: string[] };

// Décisions de Lyes : aucune exclusion de nature de sortie ; types d'absence = liste explicite, chaque code présent dans la
// lecture. setKpiSettings réécrit à sa valeur par défaut tout réglage illisible : si un autre réglage que ces deux-là l'est,
// le plan est refusé plutôt que de le toucher. Les valeurs sont des codes de configuration, jamais des données de personnes.
// « Aucune exclusion » est une décision, pas seulement un défaut : tant que la clé n'est pas un réglage enregistré, la liste vide
// est enregistrée explicitement (le script passe par setSetting, setKpiSettings n'écrivant jamais une valeur égale au défaut).
export function planKpiSettings(a: {
  current: Record<KpiAdminKey, string[]>;
  origins: Record<string, SettingOrigin>;
  present: string[];
  absenceTypes: string[];
}): KpiPlan {
  const blockedKeys = Object.entries(a.origins)
    .filter(([k, o]) => o === "invalid" && !(KPI_ADMIN_KEYS as readonly string[]).includes(k))
    .map(([k]) => k)
    .sort();
  if (blockedKeys.length) {
    return {
      ok: false,
      error: `Réglage(s) KPI illisible(s) hors du périmètre de la commande : ${blockedKeys.join(", ")}. Les écrire les remplacerait par leur valeur par défaut : à corriger d'abord dans Paramètres.`,
      unknownCodes: [],
      blockedKeys,
    };
  }
  const wanted = sortedUnique(a.absenceTypes);
  const present = new Set(a.present);
  const unknownCodes = wanted.filter((c) => !present.has(c));
  if (unknownCodes.length) {
    return {
      ok: false,
      error: `Code(s) d'absence absent(s) de la lecture active : ${unknownCodes.join(", ")}. Aucun réglage écrit.`,
      unknownCodes,
      blockedKeys: [],
    };
  }
  const after: Record<KpiAdminKey, string[]> = { excludedExitNatures: [], absenceTypes: wanted };
  const rows: KpiPlanRow[] = KPI_ADMIN_KEYS.map((key) => {
    const origin = a.origins[key] ?? "default";
    const before = sortedUnique(a.current[key]);
    const same = JSON.stringify(before) === JSON.stringify(after[key]);
    const explicit = key === "excludedExitNatures" && origin === "default" && same;
    // Une valeur illisible est toujours réécrite par setKpiSettings ; sinon seule une valeur différente l'est ; à part la décision explicite.
    const changed = origin === "invalid" || !same || explicit;
    return { key, label: KPI_ADMIN_LABELS[key], before, after: after[key], origin, changed, explicit };
  });
  return { ok: true, rows, changedKeys: rows.filter((r) => r.changed).map((r) => r.key) };
}

export const formatList = (list: string[]): string => (list.length ? list.join(", ") : "aucune");
const ORIGIN_TEXT: Record<Exclude<SettingOrigin, "invalid">, string> = { default: "valeur par défaut", setting: "enregistré" };

export function renderPlan(plan: Extract<KpiPlan, { ok: true }>, keyName: (k: KpiAdminKey) => string): string[] {
  const out: string[] = [];
  for (const r of plan.rows) {
    out.push(`${r.label} (${keyName(r.key)})`);
    out.push(`  avant : ${r.origin === "invalid" ? "illisible (réécrit par la commande)" : `${formatList(r.before)} (${ORIGIN_TEXT[r.origin]})`}`);
    out.push(`  après : ${formatList(r.after)}`);
    out.push(`  ${r.explicit ? "à enregistrer explicitement (valeur égale à la valeur par défaut : la décision est enregistrée et tracée, la clé n'étant pas encore un réglage enregistré)" : r.changed ? "à écrire" : "inchangé, rien à écrire"}`);
  }
  return out;
}

// Sortie après écriture : clés écrites, et décisions enregistrées explicitement.
export function renderWritten(plan: Extract<KpiPlan, { ok: true }>, keyName: (k: KpiAdminKey) => string): string[] {
  const out = [`Écrit : ${plan.changedKeys.map(keyName).join(", ")} (un événement d'audit par clé). Aucun autre réglage touché.`];
  for (const r of plan.rows) {
    if (r.explicit) out.push(`  ${r.label} : ${formatList(r.after)}, enregistrée explicitement (liste identique à la valeur par défaut, désormais un réglage enregistré et tracé dans le journal d'audit).`);
  }
  return out;
}

// --- Types d'absence de la lecture active

// Aucun compteur : un effectif faible par code (maternité, longue maladie) révélerait une situation individuelle dans la
// sortie du terminal, donc dans des journaux. Seuls « présent » et « retenu » sortent ; un éventuel count de la lecture est ignoré.
export type AbsenceTypeRow = { type: string; chosen: boolean; inRead: boolean; retainable: boolean };

// Un code ne peut être retenu que s'il est lisible comme réglage (KPI_PARSERS : sans espace, 128 caractères au plus).
const retainable = (type: string) => KPI_PARSERS.absenceTypes([type]) !== null;

export function absenceTypeRows(read: { type: string; count?: number }[], chosen: string[]): AbsenceTypeRow[] {
  const present = new Set(read.map((r) => r.type));
  const types = sortedUnique([...present, ...chosen]);
  return types.map((type) => ({ type, chosen: chosen.includes(type), inRead: present.has(type), retainable: retainable(type) }));
}

export function renderAbsenceTypes(rows: AbsenceTypeRow[]): string[] {
  if (!rows.length) return ["Aucun type d'absence dans la lecture active."];
  return rows.map((r) => `  ${r.type} : ${r.inRead ? "présent" : "absent de la lecture"} · retenu : ${r.chosen ? "oui" : "non"}${r.retainable ? "" : " · non retenable (espace ou plus de 128 caractères)"}`);
}

// --- Synchronisation : compteurs par collection (nombres seulement)

export function syncCounterLines(diff: Record<string, CollectionDiff> | undefined): string[] {
  const entries = Object.entries(diff ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (!entries.length) return ["  aucun compteur par collection"];
  return entries.map(([c, d]) => `  ${collectionName(c)} : ${d.total} au total, ${d.added} ajouté(s), ${d.changed} modifié(s), ${d.removed} supprimé(s)`);
}

// --- Garde-fous de --apply (sauf --allow-removals) : suppressions et mois couverts qui disparaîtraient

const collectionName = (c: string) => (/^[a-z0-9_]{1,40}$/.test(c) ? c : "collection");

// Collections dont le compteur « supprimé(s) » est non nul (nombres seulement), triées.
export function removedCollections(diff: Record<string, CollectionDiff> | undefined): { collection: string; removed: number }[] {
  return Object.entries(diff ?? {})
    .filter(([, d]) => d.removed > 0)
    .map(([c, d]) => ({ collection: collectionName(c), removed: d.removed }))
    .sort((a, b) => (a.collection < b.collection ? -1 : a.collection > b.collection ? 1 : 0));
}

export function removalRefusal(list: { collection: string; removed: number }[]): string {
  const total = list.reduce((s, x) => s + x.removed, 0);
  return `--apply refusé : ${total} enregistrement(s) supprimé(s) par rapport à la lecture appliquée (${list.map((x) => `${x.collection} : ${x.removed}`).join(", ")}). L'aperçu reste en attente, à examiner dans Données ; --allow-removals l'applique malgré tout.`;
}

// Mois couverts par la lecture Pennylane appliquée (ceux que la couverture comptable retient : mois terminés à la date de lecture,
// au calendrier de Paris, voir pennylaneCoverage) qui ne sont plus dans la plage demandée : ils disparaîtraient de la couverture.
// Les mois que cette lecture déclarait déjà n.d. (mois non terminé à la lecture) n'y comptent pas.
export function lostCoverage(previous: { months: string[]; readAt: Date } | null, requested: string[]): string[] {
  if (!previous) return [];
  const wanted = new Set(requested);
  return pennylaneCoverage(previous.months, parisDayFormat.format(previous.readAt)).months.filter((m) => !wanted.has(m));
}

export function coverageRefusal(lost: string[]): string {
  return `--apply refusé : la plage demandée ne couvre pas ${lost.length} mois couvert(s) par la lecture Pennylane appliquée (${lost.join(", ")}) ; ils disparaîtraient de la couverture comptable. Étendre la plage, ou --allow-removals pour l'accepter.`;
}

// Délai d'attente d'une lecture : une minute en deçà du délai (STALE_AFTER_MS, src/lib/connectors/sync.ts) après lequel une
// lecture est déclarée en échec.
export const WAIT_MARGIN_MS = 60_000;
export function waitBudget(staleAfterMs: number): { maxWaitMs: number; waitMinutes: number; staleMinutes: number } {
  const maxWaitMs = staleAfterMs - WAIT_MARGIN_MS;
  return { maxWaitMs, waitMinutes: Math.floor(maxWaitMs / 60_000), staleMinutes: Math.floor(staleAfterMs / 60_000) };
}

// --- Diagnostic structurel : jamais de montant, d'effectif, de taux ni de nom

export type ProbeCell = { kind: "exact" | "lower_bound" | "nd"; code: string | null };
export const probeCell = (v: { kind: "exact" | "lower_bound" } | { kind: "nd"; nd: { code: string } }): ProbeCell => (v.kind === "nd" ? { kind: "nd", code: v.nd.code } : { kind: v.kind, code: null });
export const probeCellText = (c: ProbeCell): string => (c.kind === "nd" ? `nd (code ${c.code ?? "inconnu"})` : c.kind);

// Ordre de deux taux exacts par produits croisés entiers (BigInt) ; « nc » si l'un des deux n'est pas exact.
export type Order = "lt" | "eq" | "gt" | "nc";
export function orderOf(a: { kind: string; ratio?: Ratio }, b: { kind: string; ratio?: Ratio }): Order {
  if (a.kind !== "exact" || b.kind !== "exact" || !a.ratio || !b.ratio) return "nc";
  const left = BigInt(a.ratio.num) * BigInt(b.ratio.den);
  const right = BigInt(b.ratio.num) * BigInt(a.ratio.den);
  return left < right ? "lt" : left > right ? "gt" : "eq";
}
const yn = (b: boolean) => (b ? "oui" : "non");
export const orderText = (o: Order): string => (o === "nc" ? "non comparable (une des valeurs n'est pas exacte)" : `inférieur : ${yn(o === "lt")} ; égal : ${yn(o === "eq")} ; supérieur : ${yn(o === "gt")}`);

export type ProbeOld = { excludedExitNatures: string[] | null; absenceTypes: string[] | null };
export type KpiProbe = {
  window: { from: string; to: string; months: number };
  etpEnd: { month: string; cell: ProbeCell }[];
  etpProrated: { month: string; cell: ProbeCell }[];
  turnover: { current: ProbeCell; old: ProbeCell | null; order: Order | null };
  absenteeism: { current: ProbeCell; old: ProbeCell | null; order: Order | null };
  // Absentéisme par motif sur la fenêtre : une cellule par ligne (dans l'ordre des motifs, sans leur code) et celle du taux tous motifs.
  motifs: { lines: ProbeCell[]; all: ProbeCell };
};

// Mêmes fonctions que les écrans (etpMonthEnd, etpProratedMonth, turnover, absenteeism, absenceByMotif) ; seuls le genre et le
// code n.d. sortent, jamais une valeur, un effectif ou un taux. L'ancien réglage est recalculé sur une copie de l'entrée
// (le mémo des calculs est indexé par l'objet d'entrée).
export function probeKpis(input: KpiInput, months: string[], windowMonths: string[], old: ProbeOld): KpiProbe {
  const from = windowMonths[0];
  const to = windowMonths[windowMonths.length - 1];
  const w: Window = { mode: "rolling", from, to, months: windowMonths, label: `${from} → ${to}` };
  const withParams = (p: Partial<KpiInput["params"]>): KpiInput => ({ ...input, params: { ...input.params, ...p } });
  const t = turnover(input, w);
  const tOld = old.excludedExitNatures ? turnover(withParams({ excludedExitNatures: old.excludedExitNatures }), w) : null;
  const a = absenteeism(input, w);
  const aOld = old.absenceTypes ? absenteeism(withParams({ absenceTypes: old.absenceTypes }), w) : null;
  const motifs = absenceByMotif(input, w);
  return {
    window: { from, to, months: windowMonths.length },
    etpEnd: months.map((month) => ({ month, cell: probeCell(etpMonthEnd(input, month)) })),
    etpProrated: months.map((month) => ({ month, cell: probeCell(etpProratedMonth(input, month)) })),
    turnover: { current: probeCell(t), old: tOld && probeCell(tOld), order: tOld && orderOf(t, tOld) },
    absenteeism: { current: probeCell(a), old: aOld && probeCell(aOld), order: aOld && orderOf(a, aOld) },
    motifs: { lines: motifs.lines.map(probeCell), all: probeCell(motifs.all) },
  };
}

// Ancien réglage : l'option explicite, sinon la valeur la plus récente du journal d'audit qui diffère de la valeur actuelle.
export function previousFromHistory(newestFirst: unknown[], current: string[], parse: (v: unknown) => string[] | null): string[] | null {
  const now = JSON.stringify(sortedUnique(current));
  for (const raw of newestFirst) {
    const p = parse(raw);
    if (p !== null && JSON.stringify(sortedUnique(p)) !== now) return sortedUnique(p);
  }
  return null;
}

export type OldValue = { value: string[] | null; source: "option" | "journal" | "introuvable" };
export function resolveOldValue(option: string[] | null, newestFirst: unknown[], current: string[], parse: (v: unknown) => string[] | null): OldValue {
  if (option) return { value: option, source: "option" };
  const found = previousFromHistory(newestFirst, current, parse);
  return found ? { value: found, source: "journal" } : { value: null, source: "introuvable" };
}

const OLD_SOURCE_TEXT: Record<OldValue["source"], string> = { option: "option de la commande", journal: "journal d'audit", introuvable: "introuvable dans le journal d'audit" };

// Anciens réglages (codes de configuration) ; quand l'un est introuvable, la sortie dit comment le fournir.
export function renderOldSettings(exclusions: OldValue, absenceTypes: OldValue): string[] {
  const out = [
    `Anciens réglages : exclusions de sortie ${exclusions.value ? `= ${exclusions.value.join(", ") || "aucune"}` : "inconnues"} (${OLD_SOURCE_TEXT[exclusions.source]}) ; types d'absence ${absenceTypes.value ? `= ${absenceTypes.value.join(", ") || "aucun"}` : "inconnus"} (${OLD_SOURCE_TEXT[absenceTypes.source]}).`,
  ];
  if (exclusions.source === "introuvable") out.push("  Exclusions de sortie introuvables : une valeur par défaut n'est jamais journalisée ; les fournir par --old-exclusions.");
  if (absenceTypes.source === "introuvable") out.push("  Types d'absence introuvables : une valeur par défaut n'est jamais journalisée ; les fournir par --old-absence-types.");
  return out;
}

// --- Référentiel Collaborateurs de la sonde : reconstruit s'il est périmé (écriture), sauf --no-rebuild

export const RH_REBUILD_REFUSAL = "référentiel périmé ou absent : ouvrir l'écran Collaborateurs";
export const RH_NO_ADMIN_REFUSAL = "aucun administrateur dans cet espace : reconstruction du référentiel Collaborateurs (écriture) refusée";
export const RH_REBUILD_ANNOUNCE = "Référentiel Collaborateurs périmé ou absent : reconstruction en cours (écriture dans les tables rh_* et événement rh.rebuilt, acteur : administrateur de l'espace).";
export const RH_CURRENT_ANNOUNCE = "Référentiel Collaborateurs à jour : utilisé tel quel, non reconstruit.";
export const RH_REBUILT_DONE = "Référentiel Collaborateurs reconstruit : écriture effectuée (tables rh_*, événement rh.rebuilt).";
export const RH_UP_TO_DATE_DONE = "Référentiel Collaborateurs déjà à jour à la reconstruction : aucune écriture.";
export const NO_ADMIN_MESSAGE = "Aucun administrateur dans cet espace : écriture refusée.";
export type RebuildDecision = { action: "use-current" } | { action: "rebuild" } | { action: "refuse"; reason: string };

// Un référentiel à jour est utilisé sans rien écrire ; sinon reconstruction (annoncée), refusée avec --no-rebuild et sans administrateur.
export function rebuildDecision(a: { current: boolean; noRebuild: boolean; hasAdmin: boolean }): RebuildDecision {
  if (a.current) return { action: "use-current" };
  if (a.noRebuild) return { action: "refuse", reason: RH_REBUILD_REFUSAL };
  if (!a.hasAdmin) return { action: "refuse", reason: RH_NO_ADMIN_REFUSAL };
  return { action: "rebuild" };
}

// --- ETP par service (même chemin que l'écran Effectifs mensuels)

// Table « service d'un contrat par mois » : buildContractServiceMap (src/lib/payroll/service-map.ts), même fonction que l'écran.

export type ServiceProbeMonth = { month: string; cell: ProbeCell; sumEqualsTotal: boolean | null };

// ETP d'un service pour un mois, comme l'écran : somme des contributions du mois dont le service est celui demandé.
// Un ETP fin de mois n.d. ou en borne basse rend le service n.d. ; le code est consigné par mois.
function serviceEtp(kpi: KpiInput, contractService: Map<string, string | null> | null, record: (month: string, code: string) => void): EtpService {
  return (month, filter) => {
    const e = etpMonthEnd(kpi, month);
    if (e.kind === "exact") {
      if (!contractService) {
        record(month, "service-map-missing");
        return { kind: "nd", reason: "ETP par service indisponible" };
      }
      const etp4 = e.contributions.filter((c) => (contractService.get(`${month}|${c.externalId}`) ?? null) === filter.value).reduce((s, c) => s + c.etp4, 0);
      return { kind: "value", v: etp4 };
    }
    record(month, e.kind === "nd" ? e.nd.code : "etp-lower-bound");
    return { kind: "nd", reason: "ETP n.d." };
  };
}

// Pour chaque mois : genre et code n.d. de l'ETP par service, et si la somme des services égale l'ETP fin de mois (booléen).
export function probeServiceEtp(a: {
  kpi: KpiInput;
  journal: JournalInput | null;
  contractService: Map<string, string | null> | null;
  natures: CategoryNatures;
  overrides: ContractCategories;
  months: string[];
}): ServiceProbeMonth[] {
  const allNd = (code: string): ServiceProbeMonth[] => a.months.map((month) => ({ month, cell: { kind: "nd", code }, sumEqualsTotal: null }));
  if (!a.journal) return allNd("journal-unavailable");
  if (!a.journal.serviceAxis) return allNd("service-axis-unset");
  const codes = new Map<string, string>();
  const real: RealSource = { kpi: a.kpi, journal: a.journal, natures: a.natures, overrides: a.overrides, etpService: serviceEtp(a.kpi, a.contractService, (m, c) => codes.set(m, c)) };
  const grids = new Map<string, ReturnType<typeof monthlyGrid>>();
  return a.months.map((month) => {
    const year = month.slice(0, 4);
    if (!grids.has(year)) grids.set(year, monthlyGrid({ measure: "etp", axis: "service", year, real, scenario: null }));
    const g = grids.get(year)!;
    const total = g.kind === "value" ? g.total(month) : null;
    if (total && total.kind === "value") {
      const e = etpMonthEnd(a.kpi, month);
      return { month, cell: { kind: "exact", code: null }, sumEqualsTotal: e.kind === "exact" ? e.etp4 === total.v : null };
    }
    // Sans ETP fin de mois n.d., le seul autre motif est un mois sans aucune ligne de paie lue.
    return { month, cell: { kind: "nd", code: codes.get(month) ?? "no-ledger-lines" }, sumEqualsTotal: null };
  });
}

export function renderProbe(a: { months: string[]; service: ServiceProbeMonth[]; kpi: KpiProbe }): string[] {
  const out: string[] = [];
  for (const m of a.months) {
    const etp = a.kpi.etpEnd.find((x) => x.month === m);
    const sv = a.service.find((x) => x.month === m);
    out.push(`Mois ${m}`);
    out.push(`  ETP fin de mois : ${etp ? probeCellText(etp.cell) : "non calculé"}`);
    const pr = a.kpi.etpProrated.find((x) => x.month === m);
    out.push(`  ETP proratisé : ${pr ? probeCellText(pr.cell) : "non calculé"}`);
    out.push(`  ETP par service : ${sv ? probeCellText(sv.cell) : "non calculé"}${sv && sv.sumEqualsTotal !== null ? ` ; somme des services égale à l'ETP fin de mois : ${yn(sv.sumEqualsTotal)}` : ""}`);
  }
  out.push(`Fenêtre des indicateurs de période : ${a.kpi.window.from} → ${a.kpi.window.to} (${a.kpi.window.months} mois)`);
  const block = (name: string, x: KpiProbe["turnover"], oldLabel: string) => {
    out.push(`  ${name} (réglages actuels) : ${probeCellText(x.current)}`);
    out.push(`  ${name} (${oldLabel}) : ${x.old ? probeCellText(x.old) : "non calculé (ancien réglage inconnu)"}`);
    out.push(`  ${name}, actuel comparé à l'ancien : ${x.order ? orderText(x.order) : "non comparé"}`);
  };
  block("Turnover", a.kpi.turnover, "anciennes exclusions de sortie");
  block("Absentéisme", a.kpi.absenteeism, "anciens types d'absence");
  out.push(`Absentéisme par motif (fenêtre ${a.kpi.window.from} → ${a.kpi.window.to})`);
  out.push(`  Lignes de motif : ${a.kpi.motifs.lines.length}`);
  a.kpi.motifs.lines.forEach((c, i) => out.push(`  ligne ${i + 1} : ${probeCellText(c)}`));
  out.push(`  Taux tous motifs : ${probeCellText(a.kpi.motifs.all)}`);
  return out;
}
