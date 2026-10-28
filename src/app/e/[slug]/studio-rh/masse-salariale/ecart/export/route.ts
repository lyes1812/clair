import type { NextRequest } from "next/server";
import { aggregate, diff, type Agg, type Diff } from "@/lib/budget/versions";
import { HORS_SALARIE, zoomOf, ZOOM_RUBRICS, type ZoomRubric } from "@/lib/budget/zoom";
import { getConfidentialite } from "@/lib/confidentialite";
import { xlsxResponse } from "@/lib/export/response";
import { safeText } from "@/lib/export/safe-text";
import { loadSourceInputs, sourceRows, type SourceRequest } from "@/lib/export/sources";
import { buildWorkbook, definitionsFor, percentCell, rationalCell, type ColumnSpec, type ExportCell, type FilterSpec } from "@/lib/export/xlsx";
import { ECART_TERMS } from "@/lib/glossary/ecart";
import { MASSE_TERMS } from "@/lib/glossary/masse";
import { formatEuros } from "@/lib/money";
import { hasAtLeast } from "@/lib/roles";
import { type ServiceGuard } from "@/lib/payroll/service-rows";
import { periodText } from "@/lib/viz/ecart";
import { requireWorkspace, type WorkspaceAccess } from "@/lib/workspace";
import { ecartServiceGuard, loadVersions, type Loaded } from "../../ecart-data";
import { ecartRows, type EcartRow } from "../../ecart-rows";
import { peopleIndex, type PersonAbsent, type PersonInfo } from "../../people-index";

export const dynamic = "force-dynamic";

// Export de l'écart budgétaire : le tableau affiché (agrégats), ou le détail par salarié d'une rubrique (nominatif :
// administrateurs et éditeurs seulement, comme à l'écran). Mêmes versions, période et filtres que la page.
// CSV par défaut ; Excel avec ?format=xlsx (filtres, sources et définitions dans des onglets). Seuil de confidentialité : sous le
// filtre Service, la même garde que l'écran (ecartServiceGuard) : service masqué ou seuil non défini, chaque cellule du tableau est
// n.d. avec la raison, dans le CSV comme dans le classeur (onglet Filtres : « Service retenu »).
const BOM = "﻿";
const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
// Libellé texte du CSV : jamais pris pour une formule à l'ouverture. Les cellules numériques (écarts, y compris négatifs) restent telles quelles.
const qt = (s: string) => q(safeText(s));
function decimal(num: number, den: number, decimals: number): string {
  const n = BigInt(num);
  const d = BigInt(den);
  const scale = 10n ** BigInt(decimals);
  const neg = n < 0n;
  const a = neg ? -n : n;
  const v = (a * scale * 2n + d) / (d * 2n); // arrondi au plus proche, demi vers le haut
  const int = v / scale;
  const frac = (v % scale).toString().padStart(decimals, "0");
  return `${neg ? "-" : ""}${int}${decimals ? `,${frac}` : ""}`;
}
const cell = (a: Agg, unit: "eur" | "etp" | "nombre") => (a.kind === "nd" ? `n.d. (${a.reason})` : a.kind === "na" ? "" : unit === "eur" ? decimal(a.num, 100, 2) : unit === "etp" ? decimal(a.num, a.den, 2) : String(a.num));
const gapCell = (d: Diff, unit: "eur" | "etp" | "nombre") => (d.kind === "nd" ? `n.d. (${d.reason})` : d.kind === "na" ? "" : unit === "eur" ? decimal(d.num, 100, 2) : unit === "etp" ? decimal(d.num, d.den, 2) : String(d.num));
const pctCell = (d: Diff) => (d.kind !== "value" ? "" : d.pct ? decimal(d.pct.num * 100, d.pct.den, 2) : "n.d. (valeur de départ nulle)");

// --- Excel ---------------------------------------------------------------------------------------------------------------------

const UNIT_LABEL = { eur: "€", etp: "ETP", nombre: "Nombre" } as const;
const isZoomRubric = (s: string): s is ZoomRubric => Object.hasOwn(ZOOM_RUBRICS, s); // jamais « in » : les clés héritées (constructor, toString…) sont refusées
const USAGE = { payfit: "journal de paie et référentiel Collaborateurs (versions réelles)", dsn: "déclarations (DSN) et référentiel Collaborateurs (versions réelles)" } as const;
const TABLE_DEFINITIONS = [ECART_TERMS.versions, ECART_TERMS.rangsDeMois, ECART_TERMS.rubriques, ECART_TERMS.effectifs, ECART_TERMS.ecart, ECART_TERMS.ecartPourcentage, "etp-average", MASSE_TERMS.masse, MASSE_TERMS.brut, MASSE_TERMS.cotisations, "lecture-nd"];
const ZOOM_DEFINITIONS = [ECART_TERMS.zoom, ECART_TERMS.versions, ECART_TERMS.rangsDeMois, ECART_TERMS.ecart, "lecture-nd"];

const scopeLabel = (l: Loaded) => (l.filter ? `service ${l.filter.value ?? "non ventilé"}` : "tous les services");
const commonFilters = (l: Loaded, guard: ServiceGuard | null = null): FilterSpec[] => [
  ...l.versions.map((v, i) => ({ label: `Version ${i + 1}`, value: v.label })),
  { label: "Période", value: `${periodText(l.from, l.to)} (rangs de mois ${l.from} à ${l.to})` },
  { label: "Périmètre", value: scopeLabel(l) },
  ...(guard ? [{ label: "Service retenu", value: `n.d. — ${guard.reason}` }] : []),
];
// Lignes du tableau sous la garde du filtre Service : chaque valeur et chaque écart n.d. avec la raison du seuil, jamais un montant.
const guardedRows = (rows: EcartRow[], guard: ServiceGuard | null): EcartRow[] =>
  guard ? rows.map((r) => ({ ...r, aggs: r.aggs.map(() => ({ kind: "nd", reason: guard.reason })), gaps: r.gaps.map(() => ({ kind: "nd", reason: guard.reason })) })) : rows;
const definitionsOf = (ids: string[]) => {
  const { definitions, unknown } = definitionsFor(ids);
  if (unknown.length) console.warn(`export de l'écart : identifiants de glossaire inconnus (${unknown.join(", ")})`);
  return definitions;
};

// Sources : la source RH retenue dans Données (ou les deux si aucune n'est retenue) et, si une version est saisie, les hypothèses.
async function sourcesOf(l: Loaded, workspaceId: string) {
  const providers = l.ctx.source ? [l.ctx.source] : (["payfit", "dsn"] as const);
  const requests: SourceRequest[] = providers.map((provider) => ({ provider, usage: USAGE[provider] }));
  const inputs = await loadSourceInputs(workspaceId, requests);
  if (l.versions.some((v) => v.kind !== "reel")) inputs.push({ label: "Hypothèses budgétaires", usage: "scénarios et budgets saisis dans Clair", last: null, applied: null, neverStatus: "Saisie dans Clair" });
  return sourceRows(inputs);
}

async function tableXlsx(workspace: WorkspaceAccess, loaded: Loaded, vue: "synthese" | "detail", guard: ServiceGuard | null): Promise<Response> {
  const rows = guardedRows(ecartRows(loaded, vue), guard);
  const columns: ColumnSpec[] = [
    { header: "Rubrique", key: "rubrique", kind: "text", width: 54 },
    { header: "Unité", key: "unite", kind: "text", width: 10 },
    ...loaded.versions.flatMap((v, i): ColumnSpec[] =>
      i === 0
        ? [{ header: v.label, key: "v1", kind: "eur" }]
        : [
            { header: v.label, key: `v${i + 1}`, kind: "eur" },
            { header: `Écart ${i + 1}−${i}`, key: `ecart${i}`, kind: "eur" },
            { header: `Écart ${i + 1}−${i} %`, key: `pct${i}`, kind: "pourcent" },
          ],
    ),
    { header: "Observations", key: "observations", kind: "text" },
  ];
  const buffer = await buildWorkbook({
    title: "Écart budgétaire",
    workspaceName: workspace.name,
    generatedAt: new Date().toISOString(),
    filters: [...commonFilters(loaded, guard), { label: "Niveau de détail", value: vue === "detail" ? "Détail" : "Synthèse" }],
    sheets: [
      {
        name: "Écart budgétaire",
        columns,
        // Chaque ligne a son unité (ETP, effectifs, montants) : le type d'affichage suit la ligne, pas la colonne.
        rowKinds: rows.map((r) => r.unit),
        rows: rows.map((r) => [
          r.label,
          UNIT_LABEL[r.unit],
          ...r.aggs.flatMap((a, i): ExportCell[] => (i === 0 ? [rationalCell(a, r.unit)] : [rationalCell(a, r.unit), rationalCell(r.gaps[i - 1], r.unit), percentCell(r.gaps[i - 1])])),
          "",
        ]),
        note: "Montants en euros ; ETP et pourcentages affichés au centième, valeur exacte conservée dans la cellule.",
      },
    ],
    sources: await sourcesOf(loaded, workspace.id),
    definitions: definitionsOf(TABLE_DEFINITIONS),
  });
  return xlsxResponse(buffer, "ecart-budgetaire");
}

type ZoomEntry = { k: string; i: PersonInfo; av: number | null; bv: number | null };

// Salarié du détail absent de l'index (ni référentiel Collaborateurs, ni base ou embauche d'un scénario choisi).
const NOT_INDEXED = { nd: "salarié absent du référentiel Collaborateurs" };
const UNKNOWN: PersonAbsent = { service: NOT_INDEXED, contract: NOT_INDEXED, start: NOT_INDEXED, end: NOT_INDEXED };
const UNSAID = { nd: "raison non précisée" }; // index sans raison : jamais produit par peopleIndex

// Service, contrat et dates : un champ null prend ce que l'index dit de son absence (« Non ventilé » ou n.d. avec sa raison
// exacte). Restent vides (sans objet) la date de sortie d'un contrat en cours et la ligne « Hors salarié », qui n'est pas une personne.
const identityCells = (e: ZoomEntry): ExportCell[] => {
  if (e.k === HORS_SALARIE) return ["", "", "", ""];
  const why = e.i.absent ?? { service: UNSAID, contract: UNSAID, start: UNSAID };
  return [e.i.service ?? why.service, e.i.contract ?? why.contract, e.i.start ?? why.start, e.i.end ?? why.end ?? ""];
};

async function zoomXlsx(workspace: WorkspaceAccess, loaded: Loaded, rubric: ZoomRubric, pair: number, entries: ZoomEntry[]): Promise<Response> {
  const a = loaded.versions[pair];
  const b = loaded.versions[pair + 1];
  const total = entries.reduce((s, e) => s + (e.bv ?? 0) - (e.av ?? 0), 0);
  const gap = diff(aggregate(a, loaded.months(a.year), rubric), aggregate(b, loaded.months(b.year), rubric));
  const reconciliation = gap.kind === "value" ? (gap.num === total ? `rapproché de l'écart de la rubrique (${formatEuros(gap.num)})` : `écart de rubrique ${formatEuros(gap.num)}, différent de la somme des salariés`) : "écart de rubrique n.d.";
  const buffer = await buildWorkbook({
    title: `Écart budgétaire — détail par salarié (${ZOOM_RUBRICS[rubric]})`,
    workspaceName: workspace.name,
    generatedAt: new Date().toISOString(),
    filters: [...commonFilters(loaded), { label: "Rubrique", value: ZOOM_RUBRICS[rubric] }, { label: "Écart détaillé", value: `${b.label} − ${a.label}` }],
    sheets: [
      {
        name: "Détail par salarié",
        // Identité d'abord (première colonne figée au défilement), puis les deux versions et l'écart.
        columns: [
          { header: "Nom", key: "nom", kind: "text", width: 36 },
          { header: "Matricule", key: "matricule", kind: "text", width: 16 },
          { header: "Service", key: "service", kind: "text", width: 24 },
          { header: "Contrat", key: "contrat", kind: "text", width: 22 },
          { header: "Date d'embauche", key: "embauche", kind: "date" },
          { header: "Date de sortie", key: "sortie", kind: "date" },
          { header: a.label, key: "v1", kind: "eur", width: 22 },
          { header: b.label, key: "v2", kind: "eur", width: 22 },
          { header: "Écart", key: "ecart", kind: "eur" },
        ],
        rows: entries.map((e) => [e.i.label, e.i.externalId ?? "", ...identityCells(e), e.av ?? "", e.bv ?? "", (e.bv ?? 0) - (e.av ?? 0)]),
        note: `Somme des écarts : ${formatEuros(total)} · ${reconciliation}.`,
      },
    ],
    sources: await sourcesOf(loaded, workspace.id),
    definitions: definitionsOf(ZOOM_DEFINITIONS),
  });
  return xlsxResponse(buffer, `ecart-detail-${rubric}`);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { workspace } = await requireWorkspace(slug);
  const sp = Object.fromEntries(req.nextUrl.searchParams);
  if (sp.format && sp.format !== "csv" && sp.format !== "xlsx") return new Response("Format inconnu : csv ou xlsx.", { status: 400 });
  const xlsx = sp.format === "xlsx";
  const loaded = await loadVersions(slug, workspace.id, sp, 3);
  const headers = { "content-type": "text/csv; charset=utf-8", "cache-control": "no-store" };
  const [zr, zp] = (sp.zoom ?? "").split(":");
  if (zr) {
    if (!hasAtLeast(workspace.role, "editor")) return new Response("Détail nominatif réservé aux administrateurs et aux éditeurs.", { status: 403 });
    const pair = zp === "2" ? 1 : 0;
    const a = loaded.versions[pair];
    const b = loaded.versions[pair + 1];
    if (!isZoomRubric(zr) || !a || !b) return new Response("Détail introuvable.", { status: 404 });
    const rubric = zr;
    const za = zoomOf(loaded.sources[pair], loaded.months(a.year), rubric);
    const zb = zoomOf(loaded.sources[pair + 1], loaded.months(b.year), rubric);
    if (za.kind === "nd" || zb.kind === "nd") return new Response(`n.d. — ${za.kind === "nd" ? za.reason : (zb as { reason: string }).reason}`, { status: 422 });
    const people = peopleIndex(loaded);
    const keys = [...new Set([...za.byKey.keys(), ...zb.byKey.keys()])];
    const entries: ZoomEntry[] = keys
      .map((x): { k: string; i: PersonInfo } => ({ k: x, i: x === HORS_SALARIE ? { label: "Hors salarié", externalId: null, service: null, contract: null, start: null, end: null } : (people.get(x) ?? { label: x, externalId: x, service: null, contract: null, start: null, end: null, absent: UNKNOWN }) }))
      .sort((x, y) => x.i.label.localeCompare(y.i.label))
      .map((k) => ({ ...k, av: za.byKey.get(k.k) ?? null, bv: zb.byKey.get(k.k) ?? null }));
    if (xlsx) return zoomXlsx(workspace, loaded, rubric, pair, entries);
    const lines = [["Écart (€)", a.label, b.label, "Matricule", "Nom", "Service", "Contrat", "Date d'embauche", "Date de sortie"].map(qt).join(";")];
    for (const k of entries) {
      const amounts = [decimal((k.bv ?? 0) - (k.av ?? 0), 100, 2), k.av === null ? "" : decimal(k.av, 100, 2), k.bv === null ? "" : decimal(k.bv, 100, 2)].map(q);
      const texts = [k.i.externalId ?? "", k.i.label, k.i.service ?? "", k.i.contract ?? "", k.i.start ?? "", k.i.end ?? ""].map(qt);
      lines.push([...amounts, ...texts].join(";"));
    }
    return new Response(BOM + lines.join("\n") + "\n", { headers: { ...headers, "content-disposition": `attachment; filename="ecart-detail-${rubric}.csv"` } });
  }
  const vue = sp.vue === "detail" ? "detail" : "synthese";
  const guard = ecartServiceGuard(loaded, await getConfidentialite(workspace.id));
  if (xlsx) return tableXlsx(workspace, loaded, vue, guard);
  const rows = guardedRows(ecartRows(loaded, vue), guard);
  const head = ["Rubrique", ...loaded.versions.flatMap((v, i) => (i === 0 ? [v.label] : [v.label, `Écart ${i + 1}−${i}`, `Écart ${i + 1}−${i} %`]))];
  const lines = [head.map(qt).join(";")];
  for (const r of rows) lines.push([qt(r.label), ...r.aggs.flatMap((a, i) => (i === 0 ? [cell(a, r.unit)] : [cell(a, r.unit), gapCell(r.gaps[i - 1], r.unit), pctCell(r.gaps[i - 1])])).map((x) => q(String(x)))].join(";"));
  return new Response(BOM + lines.join("\n") + "\n", { headers: { ...headers, "content-disposition": 'attachment; filename="ecart-budgetaire.csv"' } });
}
