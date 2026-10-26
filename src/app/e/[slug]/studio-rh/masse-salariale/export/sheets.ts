import { formatMonth } from "@/lib/dates";
import { exactRatio, type ColumnSpec, type ExportCell, type SheetSpec } from "@/lib/export/xlsx";
import { dsnBrutWindow, type DsnMonth } from "@/lib/payroll/dsn";
import type { CostPerEtp, EtpMonth, Evolution, MonthPayroll, PayrollWindow } from "@/lib/payroll/engine";
import { serviceLabel, type ServiceRow } from "../synthese-data";

// Feuilles Excel de Masse salariale › Synthèse, construites depuis les mêmes objets que l'écran (moteur de paie, ETP fin de mois,
// contrôle DSN) : montants en centimes écrits en euros, rapports (coût par ETP, parts, écarts en %) en valeur exacte ; un n.d.
// est « n.d. » avec sa raison, jamais un zéro.

type Value<T> = Extract<T, { kind: "value" }>;
const eurCol = (header: string, key: string): ColumnSpec => ({ header, key, kind: "eur" });
const OBS: ColumnSpec = { header: "Observations", key: "observations", kind: "text" };

const money = (w: MonthPayroll | PayrollWindow, pick: (x: Value<MonthPayroll> | Value<PayrollWindow>) => number, prefix = ""): ExportCell => (w.kind === "nd" ? { nd: `${prefix}${w.nd.reason}` } : pick(w));
const etpCell = (e: EtpMonth): ExportCell => (e.etp4 === null ? { nd: e.reason ?? "ETP fin de mois n.d." } : e.etp4);
// Coût par ETP d'un mois : masse chargée ÷ ETP fin de mois (en euros, valeur exacte).
function costEtpCell(r: MonthPayroll, e: EtpMonth): ExportCell {
  if (r.kind === "nd") return { nd: r.nd.reason };
  if (e.etp4 === null) return { nd: `ETP fin de mois : ${e.reason ?? "n.d."}` };
  if (e.etp4 === 0) return { nd: "aucun ETP en fin de mois" };
  return { exact: exactRatio(r.masse * 100, e.etp4) };
}
const costCell = (c: CostPerEtp): ExportCell => (c.kind === "nd" ? { nd: c.nd.reason } : { exact: exactRatio(c.costCents.num, c.costCents.den * 100) });
const gapCell = (e: Evolution): ExportCell => (e.kind === "nd" ? { nd: e.nd.reason } : e.deltaCents);
const pctCell = (e: Evolution): ExportCell => (e.kind === "nd" ? { nd: e.nd.reason } : e.ratio ? { exact: exactRatio(e.ratio.num, e.ratio.den) } : { nd: "N-1 nul : % non défini" });
// Somme des ETP fin de mois de la période (ETP-mois), n.d. dès qu'un mois l'est.
function etpMonthsCell(etp: EtpMonth[]): ExportCell {
  const missing = etp.filter((e) => e.etp4 === null);
  if (missing.length) return { nd: `ETP fin de mois n.d. : ${missing.map((e) => e.month).join(", ")}` };
  return etp.reduce((s, e) => s + (e.etp4 ?? 0), 0);
}

export type MonthlySheetIn = {
  cur: PayrollWindow;
  prev: PayrollWindow;
  evo: Evolution;
  etpCur: EtpMonth[];
  etpPrev: EtpMonth[];
  cost: CostPerEtp;
  costPrev: CostPerEtp;
  months: string[];
  showDsn: boolean;
  dsn: Map<string, DsnMonth>;
};

// Tableau « Mois par mois » : une ligne par mois de la période (avec son N-1), puis la ligne « Période ».
export function monthlySheet(x: MonthlySheetIn): SheetSpec {
  const columns: ColumnSpec[] = [
    { header: "Mois", key: "mois", kind: "text", width: 16 },
    eurCol("Masse chargée", "masse"),
    eurCol("Masse N-1", "masse-n1"),
    eurCol("Écart", "ecart"),
    eurCol("Brut", "brut"),
    eurCol("dont primes", "primes"),
    eurCol("Cotisations", "cotisations"),
    { header: "ETP fin de mois", key: "etp", kind: "etp" },
    { header: "ETP N-1", key: "etp-n1", kind: "etp" },
    eurCol("Coût / ETP", "cout-etp"),
    eurCol("Coût / ETP N-1", "cout-etp-n1"),
    ...(x.showDsn ? [eurCol("Brut DSN (001)", "dsn"), eurCol("Écart journal − DSN", "dsn-ecart")] : []),
    OBS,
  ];
  const rows = x.cur.months.map((r, i): ExportCell[] => {
    const p = x.prev.months[i];
    const e = x.etpCur[i];
    const ep = x.etpPrev[i];
    const notes = [r.open ? "paie non clôturée : montants provisoires" : null, p.open ? "N-1 provisoire" : null];
    const diff: ExportCell = r.kind === "value" && p.kind === "value" ? r.masse - p.masse : { nd: r.kind === "nd" ? r.nd.reason : `N-1 : ${(p as Extract<MonthPayroll, { kind: "nd" }>).nd.reason}` };
    const dsn: ExportCell[] = [];
    if (x.showDsn) {
      const d = x.dsn.get(r.month);
      const b = d && d.status !== "blocked" ? d.byType["001"] : undefined;
      if (!d || b === undefined) {
        const why = !d ? "DSN non déposée" : d.status === "blocked" ? `DSN bloquée${d.messages.length ? ` : ${d.messages.join(" ; ")}` : ""}` : "type 001 absent de la DSN";
        dsn.push({ nd: why }, { nd: `brut DSN n.d. (${why})` });
      } else {
        if (d.status !== "complete") notes.push(`DSN incomplète${d.messages.length ? ` : ${d.messages.join(" ; ")}` : ""}`);
        dsn.push(b, r.kind === "value" ? r.brut - b : { nd: r.nd.reason });
      }
    }
    return [
      formatMonth(r.month),
      money(r, (v) => v.masse),
      money(p, (v) => v.masse),
      diff,
      money(r, (v) => v.brut),
      money(r, (v) => v.byRubric.primes),
      money(r, (v) => v.cotisations),
      etpCell(e),
      etpCell(ep),
      costEtpCell(r, e),
      costEtpCell(p, ep),
      ...dsn,
      notes.filter(Boolean).join(" ; "),
    ];
  });
  const foot: ExportCell[] = [
    "Période",
    money(x.cur, (v) => v.masse),
    money(x.prev, (v) => v.masse),
    gapCell(x.evo),
    money(x.cur, (v) => v.brut),
    money(x.cur, (v) => v.byRubric.primes),
    money(x.cur, (v) => v.cotisations),
    etpMonthsCell(x.etpCur),
    etpMonthsCell(x.etpPrev),
    costCell(x.cost),
    costCell(x.costPrev),
  ];
  const footNotes = ["ETP : somme des ETP fin de mois (ETP-mois) ; coût par ETP-mois"];
  if (x.showDsn) {
    const w = dsnBrutWindow(x.dsn, x.months);
    if (w.kind === "nd") foot.push({ nd: w.reason }, { nd: `brut DSN n.d. (${w.reason})` });
    else {
      if (w.incompleteMonths.length) footNotes.push(`DSN incomplète : ${w.incompleteMonths.join(", ")}`);
      foot.push(w.brutCents, x.cur.kind === "value" ? x.cur.brut - w.brutCents : { nd: x.cur.nd.reason });
    }
  }
  foot.push(footNotes.join(" ; "));
  return { name: "Mois par mois", columns, rows: [...rows, foot], note: "Montants en euros ; ETP et coût par ETP : valeur exacte conservée dans la cellule." };
}

export type ServicesSheetIn = { rows: ServiceRow[]; totalCur: PayrollWindow; totalPrev: PayrollWindow; totalEvo: Evolution; year: number };

// Tableau « Services » : coût de la période et de son N-1 par service (tout le journal), écart, part, composition.
export function servicesSheet(x: ServicesSheetIn): SheetSpec {
  const part = (c: PayrollWindow): ExportCell => {
    if (c.kind === "nd") return { nd: c.nd.reason };
    if (x.totalCur.kind === "nd") return { nd: `total de la période n.d. : ${x.totalCur.nd.reason}` };
    if (x.totalCur.masse <= 0) return { nd: "masse totale de la période nulle ou négative : part non définie" };
    return { exact: exactRatio(c.masse, x.totalCur.masse) };
  };
  const perPerson = (c: PayrollWindow): ExportCell => (c.kind === "nd" ? { nd: c.nd.reason } : c.paidContractMonths > 0 ? { exact: exactRatio(c.masse, c.paidContractMonths * 100) } : { nd: "aucune personne rémunérée sur la période" });
  const line = (label: string, c: PayrollWindow, p: PayrollWindow, evo: Evolution, share: ExportCell): ExportCell[] => [
    label,
    money(c, (v) => v.masse),
    money(p, (v) => v.masse),
    gapCell(evo),
    pctCell(evo),
    share,
    money(c, (v) => v.brut - v.byRubric.primes),
    money(c, (v) => v.byRubric.primes),
    money(c, (v) => v.cotisations),
    perPerson(c),
    "",
  ];
  return {
    name: "Services",
    columns: [
      { header: "Service", key: "service", kind: "text", width: 24 },
      eurCol(`Coût ${x.year}`, "n"),
      eurCol("Coût N-1", "n1"),
      eurCol("Écart", "ecart"),
      { header: "Écart (%)", key: "ecart-pct", kind: "pourcent" },
      { header: "Part du coût", key: "part", kind: "pourcent" },
      eurCol("Hors primes", "hors-primes"),
      eurCol("Primes", "primes"),
      eurCol("Cotisations", "cotisations"),
      eurCol("Coût / personne-mois", "cout-pm"),
      OBS,
    ],
    rows: [...x.rows.map((r) => line(serviceLabel(r.value), r.cur, r.prev, r.evo, part(r.cur))), line("Total", x.totalCur, x.totalPrev, x.totalEvo, "")],
    note: "Tous les services : le filtre Service de l'écran ne s'applique pas à ce tableau. Écart et parts : valeur exacte conservée dans la cellule.",
  };
}

// Tableau « Masse chargée par service et par mois » : une ligne par service, une colonne par mois, puis la période ; total.
export function servicesMonthsSheet(x: { rows: ServiceRow[]; totalCur: PayrollWindow; months: string[] }): SheetSpec {
  const line = (label: string, w: PayrollWindow): ExportCell[] => [label, ...w.months.map((m) => money(m, (v) => v.masse)), money(w, (v) => v.masse), ""];
  return {
    name: "Services par mois",
    columns: [{ header: "Service", key: "service", kind: "text", width: 24 }, ...x.months.map((m) => eurCol(formatMonth(m), m)), eurCol("Période", "periode"), OBS],
    rows: [...x.rows.map((r) => line(serviceLabel(r.value), r.cur)), line("Total", x.totalCur)],
    note: "Tous les services : le filtre Service de l'écran ne s'applique pas à ce tableau.",
  };
}
