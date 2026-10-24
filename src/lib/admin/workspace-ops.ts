import type { CategoryNatures, ContractCategories } from "@/lib/budget/categories";
import { monthlyGrid, type EtpService, type RealSource } from "@/lib/budget/monthly";
import { isMonth, monthRange } from "@/lib/connectors/months";
import type { CollectionDiff } from "@/lib/connectors/sync";
import { serviceOf, type JournalInput, type LedgerLine } from "@/lib/payroll/engine";
import { classify, gridRubrics, type AccountGrid } from "@/lib/payroll/grid";
import type { KpiSettingKey } from "@/lib/rh-kpi-settings";
import { absenteeism } from "@/lib/rh/kpi/absence";
import { etpMonthEnd } from "@/lib/rh/kpi/etp";
import { turnover } from "@/lib/rh/kpi/turnover";
import type { KpiInput, Ratio, Window } from "@/lib/rh/kpi/types";

// Opérations d'administration d'un espace (scripts/workspace-admin.mts) : tout ce qui se décide sans base de données.
// Le script ne fait que lire et écrire ; arguments, plans de modification, plages de mois et diagnostics sont ici.

// --- Arguments

export type AdminCommand = "absence-types" | "kpi-settings" | "pennylane-sync" | "probe";
const COMMANDS: AdminCommand[] = ["absence-types", "kpi-settings", "pennylane-sync", "probe"];
const isCommand = (v: string): v is AdminCommand => (COMMANDS as string[]).includes(v);

export const USAGE = [
  "Usage : workspace-admin.mts <commande> <slug-espace> [options]",
  "  absence-types <slug>",
  "  kpi-settings <slug> --exclude-none --absence-types a,b,c [--dry-run]",
  "  pennylane-sync <slug> --from AAAA-MM --to AAAA-MM [--apply]",
  "  probe <slug> --months AAAA-MM,AAAA-MM [--old-exclusions 10,20] [--old-absence-types a,b]",
].join("\n");

export type ParsedArgs =
  | { ok: false; error: string }
  | { ok: true; command: "absence-types"; slug: string }
  | { ok: true; command: "kpi-settings"; slug: string; excludeNone: true; absenceTypes: string[]; dryRun: boolean }
  | { ok: true; command: "pennylane-sync"; slug: string; from: string; to: string; months: string[]; apply: boolean }
  | { ok: true; command: "probe"; slug: string; months: string[]; window: string[]; oldExclusions: string[] | null; oldAbsenceTypes: string[] | null };

type FlagSpec = { values: string[]; switches: string[] };
const SPECS: Record<AdminCommand, FlagSpec> = {
  "absence-types": { values: [], switches: [] },
  "kpi-settings": { values: ["absence-types"], switches: ["exclude-none", "dry-run"] },
  "pennylane-sync": { values: ["from", "to"], switches: ["apply"] },
  probe: { values: ["months", "old-exclusions", "old-absence-types"], switches: [] },
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

// Liste de codes séparés par des virgules : aucun segment vide ; triée et dédoublonnée comme dans les réglages enregistrés.
export function parseCodeList(raw: string, option: string, kind: "absence" | "nature"): Parsed<string[]> {
  const parts = raw.split(",").map((p) => p.trim());
  if (parts.some((p) => p === "")) return { ok: false, error: `${option} : liste vide ou virgule en trop.` };
  const valid = (c: string) => (kind === "nature" ? /^\d{2}$/.test(c) : c.length <= 128 && !/\s/.test(c));
  if (!parts.every(valid)) {
    return { ok: false, error: kind === "nature" ? `${option} : codes de nature à deux chiffres attendus.` : `${option} : codes sans espace, de 128 caractères au plus.` };
  }
  return { ok: true, value: sortedUnique(parts) };
}

// Liste de mois AAAA-MM séparés par des virgules, triée et dédoublonnée.
export function parseMonthList(raw: string, option: string): Parsed<string[]> {
  const parts = raw.split(",").map((p) => p.trim());
  if (!parts.every(isMonth)) return { ok: false, error: `${option} : mois au format AAAA-MM séparés par des virgules.` };
  return { ok: true, value: sortedUnique(parts) };
}

// Plage de mois inclusive ; refus si un bout est invalide ou si la plage est vide (début après fin).
export function parseMonthRange(from: string, to: string): Parsed<string[]> {
  if (!isMonth(from)) return { ok: false, error: "--from : mois au format AAAA-MM attendu." };
  if (!isMonth(to)) return { ok: false, error: "--to : mois au format AAAA-MM attendu." };
  const months = monthRange(from, to);
  if (!months.length) return { ok: false, error: "Plage de mois vide : --from doit précéder ou égaler --to." };
  return { ok: true, value: months };
}

export function parseArgs(argv: string[]): ParsedArgs {
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
    const range = parseMonthRange(from, to);
    if (!range.ok) return fail(range.error);
    return { ok: true, command, slug, from, to, months: range.value, apply: switches.has("apply") };
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
  return { ok: true, command: "probe", slug, months: months.value, window: monthRange(first, last), oldExclusions: excl ? excl.value : null, oldAbsenceTypes: types ? types.value : null };
}

// --- Réglages KPI : plan avant / après

export const KPI_ADMIN_KEYS = ["excludedExitNatures", "absenceTypes"] as const satisfies readonly KpiSettingKey[];
export type KpiAdminKey = (typeof KPI_ADMIN_KEYS)[number];
export const KPI_ADMIN_LABELS: Record<KpiAdminKey, string> = {
  excludedExitNatures: "Natures de sortie exclues du turnover",
  absenceTypes: "Types d'absence retenus pour l'absentéisme",
};
export type SettingOrigin = "default" | "setting" | "invalid";
export type KpiPlanRow = { key: KpiAdminKey; label: string; before: string[]; after: string[]; origin: SettingOrigin; changed: boolean };
export type KpiPlan =
  | { ok: true; rows: KpiPlanRow[]; changedKeys: KpiAdminKey[] }
  | { ok: false; error: string; unknownCodes: string[]; blockedKeys: string[] };

// Décisions de Lyes : aucune exclusion de nature de sortie ; types d'absence = liste explicite, chaque code présent dans la
// lecture. setKpiSettings réécrit à sa valeur par défaut tout réglage illisible : si un autre réglage que ces deux-là l'est,
// le plan est refusé plutôt que de le toucher. Les valeurs sont des codes de configuration, jamais des données de personnes.
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
    // Une valeur illisible est toujours réécrite par setKpiSettings ; sinon seule une valeur différente l'est.
    const changed = origin === "invalid" || JSON.stringify(before) !== JSON.stringify(after[key]);
    return { key, label: KPI_ADMIN_LABELS[key], before, after: after[key], origin, changed };
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
    out.push(`  ${r.changed ? "à écrire" : "inchangé, rien à écrire"}`);
  }
  return out;
}

// --- Types d'absence de la lecture active

export type AbsenceTypeRow = { type: string; count: number; chosen: boolean; inRead: boolean; retainable: boolean };

// Un code ne peut être retenu que sans espace et en 128 caractères au plus (règle de lecture des réglages).
const retainable = (type: string) => type.length > 0 && type.length <= 128 && !/\s/.test(type);

export function absenceTypeRows(read: { type: string; count: number }[], chosen: string[]): AbsenceTypeRow[] {
  const counts = new Map(read.map((r) => [r.type, r.count]));
  const types = sortedUnique([...counts.keys(), ...chosen]);
  return types.map((type) => ({ type, count: counts.get(type) ?? 0, chosen: chosen.includes(type), inRead: counts.has(type), retainable: retainable(type) }));
}

export function renderAbsenceTypes(rows: AbsenceTypeRow[]): string[] {
  if (!rows.length) return ["Aucun type d'absence dans la lecture active."];
  return rows.map((r) => {
    const n = r.inRead ? `${r.count} absence(s)` : "absent de la lecture";
    return `  ${r.type} : ${n} · retenu : ${r.chosen ? "oui" : "non"}${r.retainable ? "" : " · non retenable (espace ou plus de 128 caractères)"}`;
  });
}

// --- Synchronisation : compteurs par collection (nombres seulement)

export function syncCounterLines(diff: Record<string, CollectionDiff> | undefined): string[] {
  const entries = Object.entries(diff ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (!entries.length) return ["  aucun compteur par collection"];
  return entries.map(([c, d]) => `  ${/^[a-z0-9_]{1,40}$/.test(c) ? c : "collection"} : ${d.total} au total, ${d.added} ajouté(s), ${d.changed} modifié(s), ${d.removed} supprimé(s)`);
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
  turnover: { current: ProbeCell; old: ProbeCell | null; order: Order | null };
  absenteeism: { current: ProbeCell; old: ProbeCell | null; order: Order | null };
};

// Mêmes fonctions que les écrans (etpMonthEnd, turnover, absenteeism) ; seuls le genre et le code n.d. sortent. L'ancien
// réglage est recalculé sur une copie de l'entrée (le mémo des calculs est indexé par l'objet d'entrée).
export function probeKpis(input: KpiInput, months: string[], windowMonths: string[], old: ProbeOld): KpiProbe {
  const from = windowMonths[0];
  const to = windowMonths[windowMonths.length - 1];
  const w: Window = { mode: "rolling", from, to, months: windowMonths, label: `${from} → ${to}` };
  const withParams = (p: Partial<KpiInput["params"]>): KpiInput => ({ ...input, params: { ...input.params, ...p } });
  const t = turnover(input, w);
  const tOld = old.excludedExitNatures ? turnover(withParams({ excludedExitNatures: old.excludedExitNatures }), w) : null;
  const a = absenteeism(input, w);
  const aOld = old.absenceTypes ? absenteeism(withParams({ absenceTypes: old.absenceTypes }), w) : null;
  return {
    window: { from, to, months: windowMonths.length },
    etpEnd: months.map((month) => ({ month, cell: probeCell(etpMonthEnd(input, month)) })),
    turnover: { current: probeCell(t), old: tOld && probeCell(tOld), order: tOld && orderOf(t, tOld) },
    absenteeism: { current: probeCell(a), old: aOld && probeCell(aOld), order: aOld && orderOf(a, aOld) },
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

// --- ETP par service (même chemin que l'écran Effectifs mensuels)

// Service d'un contrat pour un mois : celui de ses lignes de brut, à défaut de ses autres lignes de charges de personnel ;
// les contreparties (42/43…) ne comptent pas. Sans ligne : absent de la table (non ventilé). Même règle que
// src/lib/payroll/context.ts, dont le chargeur dépend d'une requête web.
export function buildContractServiceMap(lines: LedgerLine[], grid: AccountGrid, axis: string): Map<string, string | null> {
  const map = new Map<string, string | null>();
  const rank = new Map<string, number>();
  const rubrics = gridRubrics(grid);
  for (const l of lines) {
    if (!l.contractId) continue;
    const c = classify(l.accountId, rubrics);
    const r = c.rubric?.role === "brut" ? 2 : c.rubric || c.payroll ? 1 : 0;
    const k = `${l.month}|${l.contractId}`;
    if (r > (rank.get(k) ?? 0)) {
      rank.set(k, r);
      map.set(k, serviceOf(l, axis));
    }
  }
  return map;
}

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
  return out;
}
