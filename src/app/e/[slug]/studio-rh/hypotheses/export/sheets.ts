import { roundDiv } from "@/lib/budget/engine";
import { bridge, gap, type Layer, type Point, type Series } from "@/lib/budget/series";
import type { BaseSnapshot, Hypothesis, ProjectedMonth } from "@/lib/budget/types";
import { formatMonth } from "@/lib/dates";
import { exactRatio, type ColumnKind, type ColumnSpec, type ExportCell, type SheetSpec } from "@/lib/export/xlsx";
import { frDates, natureChart } from "@/lib/viz/hypotheses";
import { baseFixes, baseMonthlyCost, type Constant, type Envelope, type RateScope } from "../grids-data";
import type { ProjectionRow } from "../resultat-data";

// Feuilles Excel des Hypothèses budgétaires, construites depuis les mêmes objets que l'écran (base figée, hypothèses enregistrées,
// moteur de projection, séries de lecture) : montants en euros (vrais nombres), taux en pourcentage ; un n.d. est « n.d. » avec sa
// raison ; une cellule vide est sans objet (aucune hypothèse ce mois-là, aucune contribution de cette nature).

const OBS: ColumnSpec = { header: "Observations", key: "observations", kind: "text" };
const eurCol = (header: string, key: string): ColumnSpec => ({ header, key, kind: "eur" });

// --- Projection -----------------------------------------------------------------------------------------------------------------

const NOT_SPLIT = "élément saisi en coût chargé, non ventilé en brut et charges (coût employeur exact)";
const natureText = (r: ProjectionRow) => (r.layer === "reel" ? "Réel" : r.layer === "parent" ? (r.source ?? "Projeté (scénario parent)") : "Projeté");

// Tableau « Mois par mois » : réel figé puis projeté, mêmes lignes que l'écran.
export function projectionSheet(rows: ProjectionRow[]): SheetSpec {
  const split = (r: ProjectionRow, v: number | null): ExportCell => (v !== null ? v : { nd: r.nd ?? (r.cost !== null && r.layer !== "reel" ? NOT_SPLIT : "n.d.") });
  return {
    name: "Mois par mois",
    columns: [
      { header: "Mois", key: "mois", kind: "text", width: 16 },
      { header: "Nature", key: "nature", kind: "text", width: 22 },
      eurCol("Brut", "brut"),
      eurCol("Charges", "charges"),
      eurCol("Coût employeur", "cost"),
      { header: "Effectif fin de mois", key: "headcount", kind: "nombre" },
      { header: "ETP", key: "etp", kind: "etp" },
      OBS,
    ],
    rows: rows.map((r) => [
      formatMonth(r.month),
      natureText(r),
      split(r, r.brut),
      split(r, r.charges),
      r.cost === null ? { nd: r.nd ?? "n.d." } : r.cost,
      r.headcount === null ? { nd: r.nd ?? "effectif de fin de mois non disponible dans la base figée" } : r.headcount,
      r.etp4 === null ? { nd: r.etpNd ?? r.nd ?? "ETP non disponible" } : r.etp4,
      "",
    ]),
    note: "Montants en euros ; ETP au centième, valeur exacte conservée dans la cellule.",
  };
}

// Tableau « Coût projeté par nature de contribution » : somme des contributions du moteur, par nature et par mois projeté.
export function natureSheet(months: ProjectedMonth[]): SheetSpec | null {
  const nature = natureChart(months);
  if (!nature.series.some((s) => s.values.some((v) => v !== null))) return null;
  const why = (m: ProjectedMonth) => (m.kind === "nd" ? frDates(m.reasons.join(" ; ")) : "n.d.");
  return {
    name: "Par nature",
    columns: [{ header: "Nature", key: "nature", kind: "text", width: 28 }, ...months.map((m) => eurCol(formatMonth(m.month), m.month)), OBS],
    rows: [
      ...nature.series.map((s, si): ExportCell[] => [s.name, ...s.values.map((v, i): ExportCell => (v === null ? { nd: why(months[i]) } : nature.contributing[si][i] ? v : "")), ""]),
      ["Coût du mois", ...months.map((m): ExportCell => (m.kind === "value" ? m.cost : { nd: why(m) })), ""],
    ],
    note: "Mois projetés ; cellule vide : aucune contribution de cette nature ce mois-là.",
  };
}

// --- Comparaison ----------------------------------------------------------------------------------------------------------------

const LAYER: Record<Layer, string> = { reel: "réel", "projete-parent": "projeté (parent)", projete: "projeté", budget: "budget" };
const NOT_COVERED = "mois non couvert par cette lecture";
const pointCell = (p: Point | undefined): ExportCell => (!p ? { nd: NOT_COVERED } : p.kind === "nd" ? { nd: frDates(p.reason) } : p.cost);
const originCell = (p: Point | undefined): ExportCell => (p?.kind === "value" ? (p.source ?? LAYER[p.layer]) : "");
const reasonOf = (p: Point | undefined): string | null => (!p ? NOT_COVERED : p.kind === "nd" ? frDates(p.reason) : null);
const yearMonths = (year: string) => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);

// Tableau « Mois par mois » de la comparaison : coût du scénario, de chaque lecture et écart (scénario − lecture), puis l'année.
export function comparisonSheet(principal: Series, compared: Series[], year: string): SheetSpec {
  const months = yearMonths(year);
  const columns: ColumnSpec[] = [
    { header: "Mois", key: "mois", kind: "text", width: 16 },
    eurCol(principal.label, "principal"),
    { header: `Origine — ${principal.label}`, key: "principal-origine", kind: "text" },
    ...compared.flatMap((c): ColumnSpec[] => [eurCol(c.label, c.key), { header: `Origine — ${c.label}`, key: `${c.key}-origine`, kind: "text" }, eurCol(`Écart vs ${c.label}`, `${c.key}-ecart`)]),
    OBS,
  ];
  const rows = months.map((m): ExportCell[] => {
    const a = principal.points.get(m);
    return [
      formatMonth(m),
      pointCell(a),
      originCell(a),
      ...compared.flatMap((c): ExportCell[] => {
        const b = c.points.get(m);
        const delta: ExportCell = a?.kind === "value" && b?.kind === "value" ? a.cost - b.cost : { nd: reasonOf(a) ?? reasonOf(b) ?? "n.d." };
        return [pointCell(b), originCell(b), delta];
      }),
      "",
    ];
  });
  const total = (g: ReturnType<typeof gap>, pick: "a" | "delta"): ExportCell => (g.kind === "nd" ? { nd: frDates(g.reason) } : g[pick]);
  rows.push([`Année ${year}`, total(gap(principal, principal, months), "a"), "", ...compared.flatMap((c): ExportCell[] => [total(gap(c, c, months), "a"), "", total(gap(principal, c, months), "delta")]), ""]);
  return { name: "Mois par mois", columns, rows, note: `Coût employeur mensuel ; écart = ${principal.label} − lecture comparée.` };
}

// Tuiles « Écarts » : écart sur l'année et sur les mois déjà réalisés (mêmes mois), montant et pourcentage.
export function gapsSheet(principal: Series, compared: Series[], year: string, refMonth: string): SheetSpec {
  const months = yearMonths(year);
  const done = months.filter((m) => m <= refMonth);
  const cells = (g: ReturnType<typeof gap> | null): ExportCell[] => {
    if (!g) return ["", ""];
    if (g.kind === "nd") return [{ nd: frDates(g.reason) }, { nd: frDates(g.reason) }];
    return [g.delta, g.pct ? { exact: exactRatio(g.pct.num, g.pct.den) } : { nd: "référence nulle" }];
  };
  return {
    name: "Écarts",
    columns: [
      { header: "Lecture comparée", key: "lecture", kind: "text", width: 34 },
      eurCol(`${principal.label} — année`, "a"),
      eurCol("Lecture — année", "b"),
      eurCol("Écart sur l'année", "ecart"),
      { header: "Écart sur l'année (%)", key: "ecart-pct", kind: "pourcent" },
      eurCol(done.length ? `Écart ${formatMonth(done[0]).toLowerCase()} → ${formatMonth(done.at(-1)!).toLowerCase()}` : "Écart mois réalisés", "ytd"),
      { header: "Écart mois réalisés (%)", key: "ytd-pct", kind: "pourcent" },
      OBS,
    ],
    rows: compared.map((c) => {
      const y = gap(principal, c, months);
      return [c.label, y.kind === "nd" ? { nd: frDates(y.reason) } : y.a, y.kind === "nd" ? { nd: frDates(y.reason) } : y.b, ...cells(y), ...cells(done.length ? gap(principal, c, done) : null), done.length ? "" : "aucun mois réalisé dans l'année"];
    }),
    note: `Écart = ${principal.label} − lecture comparée ; pourcentages : valeur exacte conservée dans la cellule.`,
  };
}

// Pont d'écart volume / coût moyen, par lecture comparée (effet de structure non calculé : n.d. avec sa raison).
export function bridgeSheet(principal: Series, compared: Series[], year: string): SheetSpec {
  const months = yearMonths(year);
  const STRUCTURE = { nd: "non calculé : données individuelles datées des deux lectures requises" };
  const cpe = (x: { cost: number; etpMonths4: number }) => roundDiv(BigInt(x.cost) * 10000n, BigInt(x.etpMonths4));
  return {
    name: "Pont d'écart",
    columns: [
      { header: "Lecture comparée", key: "lecture", kind: "text", width: 34 },
      eurCol("Écart total", "delta"),
      eurCol("Effet volume", "volume"),
      eurCol("Effet coût moyen", "cout-moyen"),
      eurCol("Effet de structure", "structure"),
      { header: `ETP-mois — ${principal.label}`, key: "etp-a", kind: "etp" },
      { header: "ETP-mois — lecture", key: "etp-b", kind: "etp" },
      eurCol(`Coût par ETP-mois — ${principal.label}`, "cpe-a"),
      eurCol("Coût par ETP-mois — lecture", "cpe-b"),
      OBS,
    ],
    rows: compared.map((c) => {
      const b = bridge(principal, c, months);
      if (b.kind === "nd") {
        const nd = { nd: frDates(b.reason) };
        return [c.label, nd, nd, nd, STRUCTURE, nd, nd, nd, nd, ""];
      }
      return [c.label, b.delta, b.volume, b.averageCost, STRUCTURE, b.a.etpMonths4, b.b.etpMonths4, cpe(b.a), cpe(b.b), ""];
    }),
    note: `Année ${year} ; coût par ETP-mois arrondi au centime, comme à l'écran.`,
  };
}

// --- Grilles de saisie ----------------------------------------------------------------------------------------------------------

// Bases individuelles (nominatif) : base figée de chaque contrat et correction saisie.
export function basesSheet(base: BaseSnapshot, hypotheses: Hypothesis[]): SheetSpec {
  const fixes = baseFixes(hypotheses);
  return {
    name: "Bases individuelles",
    columns: [
      { header: "Contrat", key: "contrat", kind: "text", width: 30 },
      { header: "Service", key: "service", kind: "text", width: 18 },
      { header: "Statut", key: "statut", kind: "text", width: 20 },
      { header: "Entrée", key: "entree", kind: "date", width: 12 },
      { header: "Fin connue", key: "fin", kind: "date", width: 12 },
      { header: "ETP", key: "etp", kind: "etp" },
      eurCol("Salaire", "salaire"),
      { header: "Taux de charges", key: "taux", kind: "pourcent" },
      eurCol("Coût mensuel", "cout"),
      eurCol("Salaire corrigé", "salaire-corrige"),
      { header: "Taux de charges corrigé", key: "taux-corrige", kind: "pourcent" },
      { header: "État", key: "etat", kind: "text", width: 40 },
      OBS,
    ],
    rows: base.contracts.map((c): ExportCell[] => {
      const fix = fixes.get(c.contractKey);
      const baseNd = { nd: c.baseNd ? frDates(c.baseNd) : "base du contrat n.d." };
      const cost = baseMonthlyCost(c);
      return [
        c.label,
        c.service ?? "Non ventilé",
        c.executive === true ? "Cadre dirigeant" : c.executive === false ? "Hors cadre dirigeant" : { nd: c.executive === undefined ? "statut absent de la base figée (scénario créé avant sa conservation)" : "statut cadre dirigeant non renseigné dans les données lues" },
        c.startDate ?? { nd: "date d'entrée non renseignée" },
        c.endDate ?? "",
        c.etp4 === null ? { nd: c.etpNd ? frDates(c.etpNd) : "ETP non disponible" } : c.etp4,
        c.base ? c.base.salaryCents : baseNd,
        c.base ? (c.base.refBrutCents > 0 ? { exact: exactRatio(c.base.refCotisationsCents, c.base.refBrutCents) } : { nd: "brut du mois de référence nul" }) : baseNd,
        cost === null ? baseNd : cost,
        fix ? fix.salaryCents : "",
        fix ? fix.chargesBps : "",
        // Correction : ses montants sont dans les colonnes « corrigé » (vrais nombres), jamais répétés en texte.
        fix ? "corrigée" : c.baseNd ? `n.d. — ${frDates(c.baseNd)}` : c.baseNote ? `figée — ${frDates(c.baseNote)}` : "figée",
        c.service === null && c.serviceNd ? `Service : ${frDates(c.serviceNd)}` : "",
      ];
    }),
    note: "Valeurs enregistrées. Montants en euros ; taux et ETP : valeur exacte conservée dans la cellule.",
  };
}

// Enveloppes d'un axe : une ligne par enveloppe, une colonne par mois du scénario.
export function envelopesSheet(rows: Envelope[], axis: Envelope["axis"], months: string[]): SheetSpec {
  return {
    name: axis === "service" ? "Enveloppes par service" : "Enveloppes par rubrique",
    columns: [
      { header: axis === "service" ? "Centre de coûts" : "Rubrique", key: "cible", kind: "text", width: 26 },
      { header: "Saisie", key: "saisie", kind: "text", width: 16 },
      { header: "Taux de charges", key: "taux", kind: "pourcent" },
      { header: "Non récurrent", key: "nr", kind: "text", width: 12 },
      ...months.map((m) => eurCol(m, m)),
      OBS,
    ],
    rows: rows.map((e) => [e.target, e.chargesBps === null ? "Coût chargé" : "Brut + charges", e.chargesBps ?? "", e.nonRecurring ? "oui" : "non", ...months.map((m): ExportCell => e.monthly[m] ?? ""), ""]),
    note: "Valeurs enregistrées ; montants chargés ou bruts selon la colonne « Saisie » ; cellule vide : aucune enveloppe ce mois-là.",
  };
}

// Taux d'augmentation par périmètre et par mois (points de base écrits en pourcentage).
export function ratesSheet(scopes: RateScope[], rate: Map<string, number>, months: string[]): SheetSpec {
  return {
    name: "Taux d'augmentation",
    columns: [{ header: "Périmètre", key: "perimetre", kind: "text", width: 40 }, ...months.map((m): ColumnSpec => ({ header: m, key: m, kind: "pourcent" })), OBS],
    rows: scopes.map((s) => [s.label, ...months.map((m): ExportCell => rate.get(`${s.key}|${m}`) ?? ""), ""]),
    note: "Valeurs enregistrées ; taux en % du salaire ; cellule vide : aucune augmentation ce mois-là.",
  };
}

const UNIT_TEXT: Record<Constant["unit"], string> = { eur: "montant en euros", pct: "taux en %", nombre: "nombre" };
// Constantes de référence : valeurs en centièmes de l'unité (€ → centimes ; % et nombre → centièmes, écrits avec deux décimales).
export function constantsSheet(rows: Constant[], months: string[]): SheetSpec {
  const cell = (c: Constant, v: number | undefined): ExportCell => (v === undefined ? "" : c.unit === "eur" ? v : { exact: exactRatio(v, 100) });
  return {
    name: "Constantes",
    columns: [{ header: "Constante", key: "constante", kind: "text", width: 30 }, { header: "Unité", key: "unite", kind: "text", width: 18 }, { header: "Source", key: "source", kind: "text", width: 30 }, ...months.map((m) => eurCol(m, m)), OBS],
    rows: rows.map((c) => [c.label, UNIT_TEXT[c.unit], c.source || { nd: "source non renseignée" }, ...months.map((m) => cell(c, c.values[m])), ""]),
    rowKinds: rows.map((c): ColumnKind => (c.unit === "eur" ? "eur" : "etp")),
    note: "Valeurs enregistrées, sans effet sur le calcul ; un taux s'écrit en % (5,25 = 5,25 %).",
  };
}
