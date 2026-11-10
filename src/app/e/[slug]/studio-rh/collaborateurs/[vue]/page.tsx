import "@/styles/collaborateurs.css";
import "@/styles/collaborateurs-exploration.css";
import { notFound } from "next/navigation";
import { isMonth } from "@/lib/connectors/months";
import { loadPayrollContext } from "@/lib/payroll/context";
import { buildExploration, type ExplorationAxis } from "@/lib/rh/exploration";
import { buildExplorationAbsences } from "@/lib/rh/exploration-absences";
import { loadKpiContext } from "@/lib/rh/kpi-context";
import { buildPayfitPayrollItems } from "@/lib/rh/payroll-items";
import { loadDsnPayrollItems } from "@/lib/rh/payroll-items-store";
import { loadCollabContext } from "@/lib/rh/view";
import { defaultMonth } from "@/lib/viz/collaborateurs";
import { CollabHeader } from "../components";
import { ExplorationView, type ExplorationViewFilters, type ExplorationViewOptions } from "../ExplorationView";

export const dynamic = "force-dynamic";
type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const MODES = ["tree", "rubrique", "pointage", "pivot"] as const;
type Mode = (typeof MODES)[number];
const AXES: ExplorationAxis[] = ["team", "nature", "establishment", "state"];
const axis = (value: string, fallback: ExplorationAxis) => AXES.includes(value as ExplorationAxis) ? value as ExplorationAxis : fallback;

// Référentiel appliqué uniquement ; aucune synchronisation ni décision RH n'est modifiée.
export default async function CollabExplorationPage({ params, searchParams }: { params: Promise<{ slug: string; vue: string }>; searchParams: Promise<Search> }) {
  const { slug, vue } = await params;
  if (!MODES.includes(vue as Mode)) notFound();
  const mode = vue as Mode;
  const sp = await searchParams;
  const payrollContext = mode === "rubrique" ? await loadPayrollContext(slug) : null;
  const pointageContext = mode === "pointage" ? await loadKpiContext(slug, {}) : null;
  const ctx = payrollContext?.kpi.collab ?? pointageContext?.collab ?? await loadCollabContext(slug);
  const data = ctx.data;
  const knownMonths = [...new Set([
    ...(data?.coverage.map(c => c.month) ?? []),
    ...(payrollContext?.input?.months ?? []),
  ])].filter(isMonth).sort();
  const requested = one(sp.mois);
  // Un mois demandé hors couverture ne recycle jamais le dernier mois disponible.
  const month = sp.mois !== undefined ? requested : defaultMonth(knownMonths, data?.build.referenceDate, knownMonths.at(-1) ?? null) || "";
  const months = [...new Set([...knownMonths, ...(isMonth(month) ? [month] : [])])].sort();
  const filters: ExplorationViewFilters = {
    month, q: one(sp.q).trim().slice(0, 80),
    establishment: mode === "rubrique" ? "" : one(sp.etab).slice(0, 180),
    nature: mode === "rubrique" ? "" : one(sp.nature).slice(0, 180),
    team: mode === "rubrique" ? "" : one(sp.equipe).slice(0, 180),
    rowAxis: axis(one(sp.lignes), "team"), colAxis: axis(one(sp.colonnes), "nature"),
    measure: one(sp.mesure) === "contracts" ? "contracts" : "persons",
    rubric: one(sp.rubrique).slice(0, 180),
  };
  const options: ExplorationViewOptions = {
    months, establishments: ctx.establishments.map(e => ({ value: e.id, label: e.label })), natures: [], teams: [],
  };
  if (mode === "rubrique" && payrollContext) {
    const payroll = ctx.chosen === "dsn"
      ? await loadDsnPayrollItems(ctx, month)
      : buildPayfitPayrollItems({ month, input: payrollContext.input, rh: data,
          readAt: payrollContext.read?.startedAt.toISOString() ?? null,
          syncId: payrollContext.read?.syncId ?? null, unavailable: payrollContext.unavailable });
    return <CollabHeader ctx={ctx} tab={mode} notices={payroll.notices}><ExplorationView slug={slug} mode={mode} filters={filters} options={options} payroll={payroll} showVigilance={!ctx.data} /></CollabHeader>;
  }
  if (!data) return <CollabHeader ctx={ctx} tab={mode} />;
  const exploration = buildExploration(data, month, {
    natures: ctx.natures.codes, establishments: filters.establishment ? [filters.establishment] : undefined,
    q: filters.q, nature: filters.nature, team: filters.team,
  });
  options.natures = exploration.natures.map(c => ({ value: c.key, label: c.value === null ? `${c.label} · n.d.` : c.label }));
  options.teams = exploration.teams.map(c => ({ value: c.key, label: c.value === null ? `${c.label} · n.d.` : c.label }));
  filters.nature = exploration.natures.find(c => c.key === filters.nature || c.value === filters.nature)?.key ?? filters.nature;
  filters.team = exploration.teams.find(c => c.key === filters.team || c.value === filters.team)?.key ?? filters.team;
  const absences = mode === "pointage" ? buildExplorationAbsences(exploration, pointageContext?.input?.absences ?? null,
    data.build.inputs.source === "payfit" ? data.build.inputs.syncId : null,
    { knownContractKeys: data.contracts.map(c => c.contractKey), observedContractKeys: buildExploration(data, month, { natures: ctx.natures.codes }).rows.map(r => r.contractKey) }) : undefined;
  const notices = [...new Set([...exploration.notices, ...(absences?.notices ?? []), ...(absences?.reason ? [absences.reason] : [])])];
  return <CollabHeader ctx={ctx} tab={mode} notices={notices}><ExplorationView slug={slug} mode={mode} filters={filters} options={options} exploration={exploration} absences={absences} showVigilance={false} /></CollabHeader>;
}
