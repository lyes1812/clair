import type { NextRequest } from "next/server";
import { CONFIDENTIALITE_TERM, getConfidentialite } from "@/lib/confidentialite";
import { xlsxResponse } from "@/lib/export/response";
import { loadSourceInputs, sourceRows, type SourceRequest } from "@/lib/export/sources";
import { buildWorkbook, definitionsFor, type FilterSpec, type SheetSpec } from "@/lib/export/xlsx";
import { KPI_TERMS } from "@/lib/glossary/kpi";
import { MASSE_TERMS } from "@/lib/glossary/masse";
import { loadPayrollContext } from "@/lib/payroll/context";
import { requireWorkspace } from "@/lib/workspace";
import { periodLabel, serviceLabel, syntheseOf } from "../synthese-data";
import { monthlySheet, servicesMonthsSheet, servicesSheet } from "./sheets";
import { listActualEvents } from "@/lib/payroll/non-recurring-store";
import { actualNonRecurringSheet } from "@/lib/payroll/non-recurring-export";

export const dynamic = "force-dynamic";

// Export Excel de Masse salariale › Synthèse : tableau « Mois par mois » (période, N-1, ETP, coût par ETP, contrôle DSN) et, si un
// axe de service est choisi, tableaux par service. Mêmes paramètres d'adresse et mêmes fonctions que l'écran ; onglets Filtres,
// Sources et Définitions. Aucun CSV n'existait pour ces tableaux : Excel seulement. Aucune donnée nominative : ouvert à tous les
// rôles de l'espace, comme l'écran. Seuil de confidentialité : mêmes cellules n.d. que l'écran (lignes par service ; sous le filtre
// Service, tout le tableau mensuel du service masqué), avec la même raison.
const text = (body: string, status: number) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { workspace } = await requireWorkspace(slug);
  const sp = Object.fromEntries(req.nextUrl.searchParams);
  if (sp.format && sp.format !== "xlsx") return text("Format inconnu : xlsx.", 400);
  const ctx = await loadPayrollContext(slug);
  if (ctx.source === "dsn") return text("Export indisponible : la source RH retenue est la DSN (Synthèse DSN).", 422);
  const confidentialite = await getConfidentialite(workspace.id);
  const s = syntheseOf(ctx, sp, confidentialite);
  if (s.kind === "no-input") return text(`n.d. — ${ctx.unavailable ?? "journal de paie PayFit non lu"}`, 422);
  if (s.kind === "no-month") return text("n.d. — aucun mois de journal de paie dans la lecture appliquée", 422);
  if (s.vue !== "synthese") return text("Export Excel disponible pour la Synthèse seulement.", 404);

  const scope = s.serviceValue === undefined ? "tous les services" : `service ${serviceLabel(s.serviceValue)}`;
  const filters: FilterSpec[] = [
    { label: "Période", value: periodLabel(s.months) },
    { label: "N-1", value: periodLabel(s.prevMonths) },
    { label: "Périmètre", value: scope },
    { label: "Axe du service", value: ctx.service.axis ?? `n.d. — ${s.serviceNd}` },
    { label: "Confidentialité", value: confidentialite.kind === "set" ? `seuil de ${confidentialite.value} ${confidentialite.value > 1 ? "personnes" : "personne"} distinctes` : confidentialite.kind === "absent" ? "seuil non défini (Paramètres)" : "seuil illisible : à ré-enregistrer (Paramètres)" },
    ...(s.guard ? [{ label: "Service retenu", value: `n.d. — ${s.guard.reason}` }] : []),
    ...(s.cur.kind === "value" && s.cur.openMonths.length ? [{ label: "Mois provisoires (paie non clôturée)", value: s.cur.openMonths.join(", ") }] : []),
    ...(s.notices.length ? [{ label: "Paramètres ignorés", value: s.notices.join(" ; ") }] : []),
  ];
  const sheets: SheetSpec[] = [monthlySheet({ ...s, dsn: ctx.dsn })];
  sheets.push(actualNonRecurringSheet(s.input, await listActualEvents(workspace.id), s.months, ctx.read?.syncId ?? null));
  if (ctx.service.axis && s.services.length > 0) {
    sheets.push(servicesSheet({ rows: s.services, totalCur: s.totalCur, totalPrev: s.totalPrev, totalEvo: s.totalEvo, year: s.year }));
    sheets.push(servicesMonthsSheet({ rows: s.services, totalCur: s.totalCur, months: s.months }));
  }

  // Sources : journal de paie PayFit, référentiel Collaborateurs (ETP fin de mois) et, s'il est affiché, le contrôle DSN.
  const rh = ctx.kpi.input?.data.build.source === "dsn" ? "dsn" : "payfit";
  const usage = { payfit: ["journal comptable de paie (masse, brut, cotisations, services)"], dsn: [] as string[] };
  usage[rh].push("référentiel Collaborateurs (ETP fin de mois)");
  if (s.showDsn) usage.dsn.push("contrôle : brut déclaré (type 001)");
  const requests: SourceRequest[] = (["payfit", "dsn"] as const).filter((p) => usage[p].length).map((provider) => ({ provider, usage: usage[provider].join(" ; ") }));
  const { definitions, unknown } = definitionsFor([MASSE_TERMS.montants, MASSE_TERMS.mois, MASSE_TERMS.masse, MASSE_TERMS.brut, MASSE_TERMS.cotisations, MASSE_TERMS.evolution, MASSE_TERMS.coutEtp, KPI_TERMS.etpMonthEnd, MASSE_TERMS.service, CONFIDENTIALITE_TERM, ...(s.showDsn ? [MASSE_TERMS.controleDsn] : [])]);
  if (unknown.length) console.warn(`export de la masse salariale : identifiants de glossaire inconnus (${unknown.join(", ")})`);

  const buffer = await buildWorkbook({
    title: "Masse salariale — Synthèse",
    workspaceName: workspace.name,
    generatedAt: new Date().toISOString(),
    filters,
    sheets,
    sources: sourceRows(await loadSourceInputs(workspace.id, requests)),
    definitions,
  });
  return xlsxResponse(buffer, `masse-salariale-${s.year}-${s.from}-${s.to}`);
}
