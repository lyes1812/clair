import { safeText } from "@/lib/export/safe-text";
import type { ExportCell, WorkbookSpec } from "@/lib/export/xlsx";
import type { RestructuringContext } from "./context";
import type { Metric, RestructuringScenario } from "./model";

type Context = Pick<RestructuringContext, "workspaceName" | "reference" | "proposal" | "model"> & { generatedAt: string };
const cell = (metric: Metric): ExportCell => metric.value === null ? { nd: metric.reason ?? "Valeur non disponible." } : metric.value;
const TOTALS = [
  ["referenceCost", "Coût de référence"], ["proposalCost", "Coût du projet"], ["savings", "Économie nette"],
  ["transitionCost", "Coûts ponctuels supplémentaires (déjà inclus)"], ["exitCost", "Coûts de sortie du projet (déjà inclus)"],
  ["replacementCost", "Coût des remplacements liés du projet (déjà inclus)"],
] as const;
const DEFINITIONS = [
  { term: "Économie nette", definition: "Écart de coût employeur entre deux scénarios explicitement sélectionnés, sur le même horizon et la même base figée. Un écart positif est une économie. Les autres différences d’hypothèses sont également comprises : cet écart ne démontre pas à lui seul un effet causal des départs.", formula: "Coût de référence − coût du projet" },
  { term: "Coûts ponctuels supplémentaires", definition: "Différence entre les contributions marquées non récurrentes des deux scénarios, y compris sorties et tuilages. Elles sont déjà incluses dans les coûts du projet et dans l’économie nette : ne pas les soustraire une seconde fois.", formula: "Non-récurrent du projet − non-récurrent de référence" },
  { term: "Retour à l’équilibre cumulé", definition: "Premier mois non négatif après un déficit cumulé observé, sans retour en négatif jusqu’à la fin de l’horizon. Aucun délai extrapolé. Il s’agit de coûts employeur projetés, pas d’un calendrier de trésorerie ni d’une valorisation juridique." },
  { term: "Données manquantes", definition: "Un coût de sortie non saisi n’est pas un coût nul. Un mois n.d. rend les cumuls et totaux concernés n.d. ; les mois suivants calculables restent visibles séparément." },
  { term: "ETP", definition: "Stock contractuel de fin de mois projeté par le moteur RH. L’écart de fin d’horizon est référence − projet, sans calcul d’une moyenne annuelle." },
];

const source = (label: string, scenario: RestructuringScenario | null) => ({
  label, detail: scenario ? `${scenario.name} ; ${scenario.firstMonth} → ${scenario.lastMonth} ; prorata ${scenario.conventions.prorata} ; mois de base ${scenario.base.refMonth}.` : "Aucun scénario sélectionné.",
  syncedAt: scenario?.base.readAt ?? null, status: scenario ? scenario.status === "fige" ? "Scénario figé" : "Scénario brouillon — peut évoluer" : "Non sélectionné",
});

// Export agrégé seulement : aucun contrat, nom de salarié ni détail nominatif des hypothèses.
export function restructuringWorkbook(ctx: Context): WorkbookSpec {
  return {
    title: "Studio Restructuring — comparaison de scénarios RH", workspaceName: ctx.workspaceName, generatedAt: ctx.generatedAt,
    filters: [
      { label: "Référence", value: ctx.reference?.name ?? "Non sélectionnée" }, { label: "Projet", value: ctx.proposal?.name ?? "Non sélectionné" },
      { label: "Horizon", value: ctx.reference ? `${ctx.reference.firstMonth} → ${ctx.reference.lastMonth}` : "n.d." }, { label: "Devise", value: "EUR, centimes conservés" },
    ],
    sheets: [
      {
        name: "Synthèse", columns: [{ key: "metric", header: "Indicateur", kind: "text", width: 58 }, { key: "amount", header: "Montant EUR", kind: "eur", width: 24 }, { key: "reason", header: "Observation", kind: "text", width: 65 }],
        rows: [...TOTALS.map(([key, label]) => [label, cell(ctx.model.totals[key]), ctx.model.totals[key].reason ?? ""]), ["Retour à l’équilibre cumulé", "", ctx.model.payback.month ?? ctx.model.payback.reason]],
        note: ctx.model.kind === "nd" ? ctx.model.reason ?? "Comparaison indisponible." : "Coûts ponctuels et remplacements déjà inclus dans le coût projeté ; aucun retraitement juridique.",
      },
      {
        name: "Impacts mensuels",
        columns: [
          { key: "month", header: "Mois", kind: "text", width: 16 },
          ...TOTALS.slice(0, 3).map(([key, label]) => ({ key, header: `${label} EUR`, kind: "eur" as const, width: 24 })),
          { key: "cumulative", header: "Économie cumulée EUR", kind: "eur", width: 26 },
          ...TOTALS.slice(3).map(([key, label]) => ({ key, header: `${label} EUR`, kind: "eur" as const, width: 28 })),
          { key: "referenceEtp4", header: "ETP référence fin de mois", kind: "etp", width: 24 }, { key: "proposalEtp4", header: "ETP projet fin de mois", kind: "etp", width: 24 },
          { key: "reason", header: "Observations", kind: "text", width: 70 },
        ],
        rows: ctx.model.months.map((m) => [m.month, ...TOTALS.slice(0, 3).map(([key]) => cell(m[key])), cell(m.cumulative), ...TOTALS.slice(3).map(([key]) => cell(m[key])), cell(m.referenceEtp4), cell(m.proposalEtp4), [...new Set(Object.values(m).flatMap((v) => typeof v === "object" && v?.reason ? [v.reason] : []))].join(" ; ")]),
      },
    ],
    sources: [source("Scénario de référence", ctx.reference), source("Scénario projet", ctx.proposal)],
    definitions: [...DEFINITIONS, ...ctx.model.warnings.map((definition, i) => ({ term: `Limite ${i + 1}`, definition }))],
  };
}

const quote = (value: string) => `"${safeText(value).replaceAll('"', '""')}"`;
const decimal = (metric: Metric, scale = 100n) => {
  if (metric.value === null) return "n.d.";
  const n = BigInt(metric.value), absolute = n < 0n ? -n : n;
  return `${n < 0n ? "-" : ""}${absolute / scale},${String(absolute % scale).padStart(String(scale).length - 1, "0")}`;
};
export function restructuringCsv(ctx: Context): string {
  const rows = [["Section", "Mois", "Indicateur", "Valeur", "Unité", "Observation"]];
  for (const m of ctx.model.months) {
    for (const [key, label] of [...TOTALS, ["cumulative", "Économie cumulée"]] as const) rows.push(["Impacts mensuels", m.month, label, decimal(m[key]), "EUR", m[key].reason ?? ""]);
    for (const [key, label] of [["referenceEtp4", "ETP référence fin de mois"], ["proposalEtp4", "ETP projet fin de mois"]] as const) rows.push(["Effectifs", m.month, label, decimal(m[key], 10000n), "ETP", m[key].reason ?? ""]);
  }
  for (const [key, label] of TOTALS) rows.push(["Synthèse", "", label, decimal(ctx.model.totals[key]), "EUR", ctx.model.totals[key].reason ?? ""]);
  rows.push(["Synthèse", "", "Écart ETP de fin d’horizon (référence − projet)", decimal(ctx.model.endEtpDelta, 10000n), "ETP", ctx.model.endEtpDelta.reason ?? ""]);
  rows.push(["Synthèse", "", "Retour à l’équilibre cumulé", "", "", ctx.model.payback.month ?? ctx.model.payback.reason]);
  const spec = restructuringWorkbook(ctx);
  for (const filter of spec.filters) rows.push(["Filtres", "", filter.label, "", "", filter.value]);
  for (const s of spec.sources) rows.push(["Sources", "", s.label, "", "", `${s.detail} ${s.status}. Date de lecture : ${s.syncedAt ?? "n.d."}.`]);
  for (const d of spec.definitions) rows.push(["Définitions", "", d.term, "", "", `${d.definition}${d.formula ? ` ${d.formula}` : ""}`]);
  return `\uFEFF${rows.map((r) => r.map(quote).join(";")).join("\r\n")}\r\n`;
}
