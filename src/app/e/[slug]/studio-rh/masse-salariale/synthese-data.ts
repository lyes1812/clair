import { formatMonth } from "@/lib/dates";
import { costPerEtp, evolution, monthPayroll, servicesOf, shiftYear, windowPayroll, withService, type CostPerEtp, type EtpMonth, type Evolution, type JournalInput, type PayrollWindow } from "@/lib/payroll/engine";
import { loadPayrollContext, type PayrollContext } from "@/lib/payroll/context";
import type { Affichage } from "./components";

// Chargement commun de Masse salariale › Synthèse (page et export Excel) : période (année, premier et dernier mois), service, onglet
// et affichage lus dans l'adresse ; une valeur invalide est remplacée et signalée. Montants de la période et de son N-1, ETP fin de
// mois, coût par ETP, tableau par service (toujours sur tout le journal). Aucun autre calcul que ceux du moteur de paie.
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
export const serviceLabel = (v: string | null) => (v === null ? "Non ventilé" : v);
// « janvier → mars 2026 », ou le mois seul.
export const periodLabel = (ms: string[]) => (ms.length === 1 ? formatMonth(ms[0]) : `${MONTH_NAMES[Number(ms[0].slice(5)) - 1]} → ${MONTH_NAMES[Number(ms.at(-1)!.slice(5)) - 1]} ${ms[0].slice(0, 4)}`);

export type ServiceRow = { value: string | null; cur: PayrollWindow; prev: PayrollWindow; evo: Evolution };
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
  serviceRows: ServiceRow[];
  totalCur: PayrollWindow;
  totalPrev: PayrollWindow;
  totalEvo: Evolution;
  serviceNd: string; // raison d'une ventilation par service indisponible
  showDsn: boolean; // contrôle DSN : total entreprise seulement, s'il y a une DSN sur la période ou son N-1
};
export type Synthese = { kind: "no-input"; ctx: PayrollContext } | { kind: "no-month"; ctx: PayrollContext; fullInput: JournalInput } | SyntheseReady;

// Fonction pure (le contexte de paie est déjà chargé) : mêmes règles que l'écran pour chaque paramètre d'adresse.
export function syntheseOf(ctx: PayrollContext, sp: Search): Synthese {
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

  const cur = windowPayroll(input, months);
  const prev = windowPayroll(input, prevMonths);
  const evo = evolution(cur, prev, (w) => w.masse);
  const svcFilter = serviceValue === undefined ? undefined : { value: serviceValue };
  const etpCur = ctx.etp(months, svcFilter);
  const etpPrev = ctx.etp(prevMonths, svcFilter);
  const cost = costPerEtp(cur, etpCur);
  const costPrev = costPerEtp(prev, etpPrev);
  // Table par service (toujours sur tout le journal) : la somme des services, non ventilé compris, égale le total.
  const serviceRows: ServiceRow[] = ctx.service.axis
    ? servicesOf(fullInput, [...months, ...prevMonths]).map((v) => {
        const si = withService(fullInput, v);
        const c = windowPayroll(si, months);
        const p = windowPayroll(si, prevMonths);
        return { value: v, cur: c, prev: p, evo: evolution(c, p, (w) => w.masse) };
      })
    : [];
  const totalCur = windowPayroll(fullInput, months);
  const totalPrev = windowPayroll(fullInput, prevMonths);
  const totalEvo = evolution(totalCur, totalPrev, (w) => w.masse);
  const masseOf = (w: PayrollWindow) => (w.kind === "value" ? w.masse : -1);
  serviceRows.sort((a, b) => (a.value === null ? 1 : b.value === null ? -1 : masseOf(b.cur) - masseOf(a.cur)));
  const serviceNd = ctx.service.origin === "setting" ? "ventilation par service désactivée par un administrateur" : ctx.axes.length === 0 ? "aucun code analytique dans le journal PayFit" : `plusieurs axes analytiques (${ctx.axes.join(", ")}) : choisir celui du service`;
  // Contrôle DSN : affiché sur le total entreprise seulement (la DSN ne porte pas le code analytique du journal).
  const showDsn = serviceValue === undefined && [...months, ...prevMonths].some((m) => ctx.dsn.has(m));
  return { kind: "ready", ctx, fullInput, last, notices, vue, aff, knownServices, serviceValue, input, years, year, lastOfYear, from, to, months, prevMonths, cur, prev, evo, etpCur, etpPrev, cost, costPrev, serviceRows, totalCur, totalPrev, totalEvo, serviceNd, showDsn };
}

export async function loadSynthese(slug: string, sp: Search): Promise<Synthese> {
  return syntheseOf(await loadPayrollContext(slug), sp);
}
