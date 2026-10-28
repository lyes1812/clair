import { getConfidentialite, linkFromReferential, type ConfidentialiteSetting, type PersonLink } from "@/lib/confidentialite";
import { formatMonth } from "@/lib/dates";
import { costPerEtp, evolution, monthPayroll, servicesOf, shiftYear, windowPayroll, withService, type CostPerEtp, type EtpMonth, type Evolution, type JournalInput, type PayrollWindow } from "@/lib/payroll/engine";
import { loadPayrollContext, type PayrollContext } from "@/lib/payroll/context";
import { maskServiceRows, serviceGuard, serviceRows as serviceRowsOf, type MaskedServiceRow, type ServiceGuard, type ServiceRow } from "@/lib/payroll/service-rows";
import type { Affichage } from "./components";

// Chargement commun de Masse salariale › Synthèse (page et export Excel) : période (année, premier et dernier mois), service, onglet
// et affichage lus dans l'adresse ; une valeur invalide est remplacée et signalée. Montants de la période et de son N-1, ETP fin de
// mois, coût par ETP, tableau par service (toujours sur tout le journal). Aucun autre calcul que ceux du moteur de paie.
// Seuil de confidentialité (paramètre d'espace, src/lib/confidentialite) : les lignes par service sont masquées en personnes distinctes
// (services), et, sous le filtre Service, un service masqué (colonne de masse ou colonne des stocks d'un mois de la période ou de N-1)
// rend tous les chiffres de l'écran n.d. (guard) : période, N-1, mois, ETP, coût par ETP sont alors remplacés par des n.d. qui portent
// la raison, pour l'écran comme pour l'export.
type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const MM = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
const MONTH_NAMES = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const AFFICHAGES: Affichage[] = ["tout", "graphique", "tableau"];
const isAffichage = (v: string): v is Affichage => (AFFICHAGES as string[]).includes(v);

// Service (code analytique de l'axe choisi) : « __nv__ » = lignes sans code de l'axe (non ventilé).
export const NV = "__nv__";
// Onglets de l'écran (sous-vues de Masse salariale, pas des entrées de menu).
export const VUES = { synthese: "Synthèse", "fixe-variable": "Fixe & variable", "paie-compta": "Paie & comptabilité" } as const;
export type MsVue = keyof typeof VUES;
// Lignes par service et leur libellé : règle partagée avec la Masse salariale croisée (src/lib/payroll/service-rows.ts).
export { serviceLabel, type MaskedServiceRow, type ServiceGuard, type ServiceRow } from "@/lib/payroll/service-rows";
// « janvier → mars 2026 », ou le mois seul.
export const periodLabel = (ms: string[]) => (ms.length === 1 ? formatMonth(ms[0]) : `${MONTH_NAMES[Number(ms[0].slice(5)) - 1]} → ${MONTH_NAMES[Number(ms.at(-1)!.slice(5)) - 1]} ${ms[0].slice(0, 4)}`);

export type SyntheseReady = {
  kind: "ready";
  ctx: PayrollContext;
  fullInput: JournalInput;
  last: string;
  notices: string[];
  vue: MsVue;
  aff: Affichage;
  knownServices: (string | null)[];
  serviceValue: string | null | undefined; // undefined : tous les services ; null : non ventilé
  input: JournalInput; // journal filtré sur le service choisi
  years: number[];
  year: number;
  lastOfYear: string;
  from: string;
  to: string;
  months: string[];
  prevMonths: string[];
  cur: PayrollWindow;
  prev: PayrollWindow;
  evo: Evolution;
  etpCur: EtpMonth[];
  etpPrev: EtpMonth[];
  cost: CostPerEtp;
  costPrev: CostPerEtp;
  serviceRows: ServiceRow[]; // lignes du moteur, avant seuil : ne pas afficher ; l'écran et l'export lisent `services`
  services: MaskedServiceRow[]; // lignes par service après seuil de confidentialité (mêmes n.d. à l'écran et dans l'export)
  confidentialite: ConfidentialiteSetting;
  link: PersonLink; // contrat du journal → personne du référentiel Collaborateurs
  guard: ServiceGuard | null; // service retenu par le filtre masqué ou seuil non défini : les chiffres du service sont n.d.
  totalCur: PayrollWindow;
  totalPrev: PayrollWindow;
  totalEvo: Evolution;
  serviceNd: string; // raison d'une ventilation par service indisponible
  showDsn: boolean; // contrôle DSN : total entreprise seulement, s'il y a une DSN sur la période ou son N-1
};
export type Synthese = { kind: "no-input"; ctx: PayrollContext } | { kind: "no-month"; ctx: PayrollContext; fullInput: JournalInput } | SyntheseReady;

// Fonction pure (le contexte de paie est déjà chargé) : mêmes règles que l'écran pour chaque paramètre d'adresse. Le seuil de
// confidentialité est lu par l'appelant (getConfidentialite) ; omis, il est traité comme non défini (jamais un masquage par défaut
// plus faible : tout est n.d. avec la raison du paramètre).
export function syntheseOf(ctx: PayrollContext, sp: Search, confidentialite: ConfidentialiteSetting = { kind: "absent" }): Synthese {
  const fullInput = ctx.input;
  if (!fullInput) return { kind: "no-input", ctx };
  const valueMonths = fullInput.months.filter((m) => monthPayroll(fullInput, m).kind === "value");
  const closed = valueMonths.filter((m) => !fullInput.openMonths.includes(m));
  const last = closed.at(-1) ?? valueMonths.at(-1) ?? null;
  if (!last) return { kind: "no-month", ctx, fullInput };

  const notices: string[] = [];
  const ignore = (k: string, v: string, why: string) => notices.push(`paramètre ignoré : ${k}=${v} (${why})`);
  const rawVue = one(sp.vue);
  const vue: MsVue = Object.hasOwn(VUES, rawVue) ? (rawVue as MsVue) : "synthese";
  if (rawVue && !Object.hasOwn(VUES, rawVue)) ignore("vue", rawVue, "vues : synthese, fixe-variable, paie-compta");
  // Affichage : tout, graphiques seuls ou tableaux seuls (comme Écart budgétaire).
  const rawAff = one(sp.affichage);
  const aff: Affichage = isAffichage(rawAff) ? rawAff : "tout";
  if (rawAff && !isAffichage(rawAff)) ignore("affichage", rawAff, `valeurs : ${AFFICHAGES.join(", ")}`);
  const rawService = one(sp.service);
  const knownServices = ctx.service.axis ? servicesOf(fullInput, fullInput.months) : [];
  const serviceValue: string | null | undefined = !rawService ? undefined : rawService === NV && knownServices.includes(null) ? null : knownServices.includes(rawService) ? rawService : undefined;
  if (rawService && serviceValue === undefined) ignore("service", rawService, ctx.service.axis ? "service absent du journal" : "aucun axe analytique choisi");
  const input: JournalInput = serviceValue === undefined ? fullInput : withService(fullInput, serviceValue);
  const years = [...new Set(input.months.map((m) => Number(m.slice(0, 4))))].sort();
  const rawYear = one(sp.annee);
  const yearOk = years.map(String).includes(rawYear);
  const year = yearOk ? Number(rawYear) : Number(last.slice(0, 4));
  if (rawYear && !yearOk) ignore("annee", rawYear, `années lues : ${years.join(", ")}`);
  const lastOfYear = year === Number(last.slice(0, 4)) ? last.slice(5, 7) : (input.months.filter((m) => m.startsWith(`${year}-`)).at(-1)?.slice(5, 7) ?? "12");
  const rawFrom = one(sp.de);
  const rawTo = one(sp.a);
  let from = MM.includes(rawFrom) ? rawFrom : "01";
  let to = MM.includes(rawTo) ? rawTo : lastOfYear;
  if (rawFrom && from !== rawFrom) ignore("de", rawFrom, "mois 01 à 12 attendu");
  if (rawTo && to !== rawTo) ignore("a", rawTo, "mois 01 à 12 attendu");
  if (from > to) {
    ignore("de", from, "après le dernier mois");
    from = "01";
    to = to < from ? lastOfYear : to;
  }
  const months = MM.filter((m) => m >= from && m <= to).map((m) => `${year}-${m}`);
  const prevMonths = months.map((m) => shiftYear(m, -1));

  let cur = windowPayroll(input, months);
  let prev = windowPayroll(input, prevMonths);
  let evo = evolution(cur, prev, (w) => w.masse);
  const svcFilter = serviceValue === undefined ? undefined : { value: serviceValue };
  let etpCur = ctx.etp(months, svcFilter);
  let etpPrev = ctx.etp(prevMonths, svcFilter);
  let cost = costPerEtp(cur, etpCur);
  let costPrev = costPerEtp(prev, etpPrev);
  // Table par service (toujours sur tout le journal) : la somme des services, non ventilé compris, égale le total.
  const serviceRows: ServiceRow[] = ctx.service.axis ? serviceRowsOf(fullInput, months, prevMonths) : [];
  // Seuil de confidentialité : lignes par service en personnes distinctes (contrats du journal reliés par le référentiel).
  const link: PersonLink = ctx.kpi.input ? linkFromReferential(ctx.kpi.input.data) : new Map();
  const services = maskServiceRows(serviceRows, link, confidentialite);
  // Service retenu par le filtre : masqué sans filtre (masquage secondaire compris), ou seuil non défini → tous les chiffres du service
  // sont n.d. (écran et export), avec la raison nue du moteur ; la garde est la même pour tous les écrans filtrés par service. L'écran
  // publie aussi l'ETP de fin de mois du service (période et N-1 : ETP, coût par ETP) : la garde lit en plus la colonne des stocks de
  // ces mois, celle de KPI RH › Effectifs mensuels (ETP × service) et de la croisée 02.
  const guard = serviceValue === undefined ? null : serviceGuard(services, serviceValue, confidentialite, { kpi: ctx.kpi.input, journal: fullInput, months: [...months, ...prevMonths], link });
  if (guard) {
    const reason = guard.reason;
    const nd = { code: "month-nd" as const, reason }; // code générique du moteur : seule la raison est lue par les écrans et l'export
    const ndMonths = (w: PayrollWindow) => w.months.map((m) => ({ month: m.month, kind: "nd" as const, open: m.open, nd }));
    cur = { kind: "nd", nd, months: ndMonths(cur) };
    prev = { kind: "nd", nd, months: ndMonths(prev) };
    evo = { kind: "nd", nd };
    etpCur = months.map((month) => ({ month, etp4: null, reason }));
    etpPrev = prevMonths.map((month) => ({ month, etp4: null, reason }));
    cost = { kind: "nd", nd };
    costPrev = { kind: "nd", nd };
  }
  const totalCur = windowPayroll(fullInput, months);
  const totalPrev = windowPayroll(fullInput, prevMonths);
  const totalEvo = evolution(totalCur, totalPrev, (w) => w.masse);
  const serviceNd = ctx.service.origin === "setting" ? "ventilation par service désactivée par un administrateur" : ctx.axes.length === 0 ? "aucun code analytique dans le journal PayFit" : `plusieurs axes analytiques (${ctx.axes.join(", ")}) : choisir celui du service`;
  // Contrôle DSN : affiché sur le total entreprise seulement (la DSN ne porte pas le code analytique du journal).
  const showDsn = serviceValue === undefined && [...months, ...prevMonths].some((m) => ctx.dsn.has(m));
  return { kind: "ready", ctx, fullInput, last, notices, vue, aff, knownServices, serviceValue, input, years, year, lastOfYear, from, to, months, prevMonths, cur, prev, evo, etpCur, etpPrev, cost, costPrev, serviceRows, services, confidentialite, link, guard, totalCur, totalPrev, totalEvo, serviceNd, showDsn };
}

export async function loadSynthese(slug: string, sp: Search): Promise<Synthese> {
  const ctx = await loadPayrollContext(slug);
  return syntheseOf(ctx, sp, await getConfidentialite(ctx.kpi.collab.workspace.id));
}
