import { notFound } from "next/navigation";
import { dateTimeFmt } from "@/lib/connectors/labels";
import { addMonths, formatMonth } from "@/lib/dates";
import { BUDGET_DEFINITIONS } from "@/lib/budget/definitions";
import { landing, project } from "@/lib/budget/engine";
import { getConventions, PRORATA_LABELS } from "@/lib/budget/settings";
import { getScenario, KIND_LABELS, listScenarios } from "@/lib/budget/store";
import { STUDIO_RH_ITEMS } from "@/lib/nav";
import { monthPayroll } from "@/lib/payroll/engine";
import { loadPayrollContext } from "@/lib/payroll/context";
import { hasAtLeast } from "@/lib/roles";
import { requireWorkspace } from "@/lib/workspace";
import { ActionForm } from "./ActionForm";
import { createScenarioAction, deleteScenarioAction, duplicateScenarioAction, freezeScenarioAction } from "./actions";
import { HypothesesView } from "./HypothesesView";
import { ProjectionView } from "./ProjectionView";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const ITEM = STUDIO_RH_ITEMS.find((i) => i.path === "studio-rh/hypotheses")!;
const STATUS = { brouillon: "Brouillon", fige: "Figé" } as const;

function Header({ children }: { children?: React.ReactNode }) {
  return (
    <>
      <div style={{ display: "grid", gap: 8 }}>
        <span className="label">Studio RH</span>
        <h1>{ITEM.label}</h1>
        <p className="desc">{ITEM.summary}</p>
      </div>
      {children}
    </>
  );
}

function Definitions() {
  return (
    <details className="panel" data-testid="hyp-definitions" id="definitions">
      <summary>Définitions et règles de calcul</summary>
      <dl className="defs">
        {BUDGET_DEFINITIONS.map((d) => (
          <div key={d.id} id={`def-${d.id}`}><dt>{d.title}</dt><dd>{d.text}</dd></div>
        ))}
      </dl>
    </details>
  );
}

export default async function HypothesesPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Search> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { workspace } = await requireWorkspace(slug);
  const canEdit = hasAtLeast(workspace.role, "editor");
  const base = `/e/${slug}/studio-rh/hypotheses`;
  const scenarioId = one(sp.scenario);

  if (scenarioId) {
    const full = await getScenario(workspace.id, scenarioId);
    if (!full) notFound();
    const s = full.scenario;
    const vue = one(sp.vue) === "hypotheses" ? "hypotheses" : "projection";
    const proj = project(full.base, s.firstMonth, s.lastMonth, full.hypotheses, s.conventions);
    const year = s.firstMonth.slice(0, 4);
    const draft = s.status === "brouillon";
    const href = (v: string) => `${base}?scenario=${s.id}${v === "projection" ? "" : `&vue=${v}`}`;
    return (
      <Header>
        <p className="desc"><a href={base}>← Tous les scénarios</a></p>
        <section className="panel" data-testid="hyp-scenario">
          <h2>{s.name} <span className="tag">{KIND_LABELS[s.kind]}</span> <span className="tag" data-testid="hyp-status">{STATUS[s.status]}</span></h2>
          <p className="desc" data-testid="hyp-context">
            Base figée sur {formatMonth(full.base.refMonth).toLowerCase()} (lecture PayFit du {full.base.readAt}) · projection {formatMonth(s.firstMonth).toLowerCase()} → {formatMonth(s.lastMonth).toLowerCase()} ·
            prorata : {s.conventions.prorata === "calendaire" ? "jours calendaires" : "aucun"} · {full.hypotheses.length} hypothèse(s) · créé le {dateTimeFmt.format(s.createdAt)}
            {s.frozenAt ? ` · figé le ${dateTimeFmt.format(s.frozenAt)}` : ""} · <a href="#definitions">Définitions</a>
          </p>
          {canEdit && (
            <div className="strip" style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
              {draft && (
                <ActionForm action={freezeScenarioAction.bind(null, slug, s.id)} submit="Figer le scénario" testid="hyp-freeze" className="inline-form" />
              )}
              <ActionForm action={duplicateScenarioAction.bind(null, slug, s.id)} submit="Dupliquer" testid="hyp-duplicate" className="inline-form">
                <div className="field-row">
                  <label htmlFor="dup-name">Nom de la copie</label>
                  <input className="input" id="dup-name" name="name" defaultValue={`${s.name} (copie)`} maxLength={120} required />
                </div>
              </ActionForm>
              {draft && <ActionForm action={deleteScenarioAction.bind(null, slug, s.id)} submit="Supprimer le brouillon" testid="hyp-delete" className="inline-form" danger />}
            </div>
          )}
        </section>
        <nav className="tabs" data-testid="hyp-tabs">
          <a href={href("projection")} aria-current={vue === "projection" ? "page" : undefined}>Projection</a>
          <a href={href("hypotheses")} aria-current={vue === "hypotheses" ? "page" : undefined}>Hypothèses</a>
        </nav>
        {vue === "projection" ? (
          <ProjectionView slug={slug} scenario={s} base={full.base} proj={proj} landing={landing(full.base, proj, year)} month={one(sp.mois)} />
        ) : (
          <HypothesesView slug={slug} scenario={s} base={full.base} hypotheses={full.hypotheses} proj={proj} canEdit={canEdit && draft} />
        )}
        <Definitions />
      </Header>
    );
  }

  // Liste des scénarios et création.
  const [rows, conv, ctx] = await Promise.all([listScenarios(workspace.id), getConventions(workspace.id), loadPayrollContext(slug)]);
  const input = ctx.source === "payfit" ? ctx.input : null;
  const closed = input ? input.months.filter((m) => !input.openMonths.includes(m) && monthPayroll(input, m).kind === "value").sort() : [];
  const firsts = closed.map((m) => addMonths(m, 1));
  const unavailable = !input || !ctx.kpi.input ? (ctx.unavailable ?? "journal de paie PayFit et référentiel Collaborateurs requis") : closed.length === 0 ? "aucun mois de paie clos dans la lecture PayFit appliquée" : null;
  return (
    <Header>
      <section className="panel" data-testid="hyp-list">
        <h2>Scénarios</h2>
        {rows.length === 0 ? (
          <p className="desc">Aucun scénario pour l'instant.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table" data-testid="hyp-scenarios">
              <thead><tr><th>Scénario</th><th>Type</th><th>Statut</th><th>Base figée</th><th>Projection</th><th>Créé le</th></tr></thead>
              <tbody>
                {rows.map(({ scenario: s, refMonth }) => (
                  <tr key={s.id} data-scenario={s.name}>
                    <td><a href={`${base}?scenario=${s.id}`}>{s.name}</a></td>
                    <td>{KIND_LABELS[s.kind]}</td>
                    <td>{STATUS[s.status]}</td>
                    <td>{formatMonth(refMonth)}</td>
                    <td>{formatMonth(s.firstMonth)} → {formatMonth(s.lastMonth)}</td>
                    <td>{dateTimeFmt.format(s.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="panel" data-testid="hyp-create">
        <h2>Nouveau scénario</h2>
        {unavailable ? (
          <p className="nd" data-testid="hyp-nd">n.d. — base figée impossible : {unavailable}. <a href={`/e/${slug}/donnees`}>Données</a></p>
        ) : !conv ? (
          <p className="nd" data-testid="hyp-conventions-nd">n.d. — conventions de calcul non renseignées : un administrateur doit choisir la règle de prorata dans <a href={`/e/${slug}/parametres#projection`}>Paramètres › Projection</a>. Clair ne projette pas sans elle.</p>
        ) : !canEdit ? (
          <p className="desc">Création réservée aux éditeurs et administrateurs.</p>
        ) : (
          <>
            <p className="desc">
              La base est figée sur le mois qui précède le premier mois projeté (dernier mois clos de la lecture PayFit du {ctx.read ? dateTimeFmt.format(ctx.read.startedAt) : "n.d."}). Prorata : {PRORATA_LABELS[conv.conventions.prorata]}.
            </p>
            <ActionForm action={createScenarioAction.bind(null, slug)} submit="Créer le scénario" testid="hyp-create-form">
              <div className="filters">
                <div className="field-row">
                  <label htmlFor="name">Nom</label>
                  <input className="input" id="name" name="name" maxLength={120} required />
                </div>
                <div className="field-row">
                  <label htmlFor="kind">Type</label>
                  <select className="select" id="kind" name="kind" defaultValue="">
                    <option value="" disabled>Choisir…</option>
                    <option value="budget">Budget</option>
                    <option value="revise">Révisé</option>
                    <option value="simulation">Simulation</option>
                  </select>
                </div>
                <div className="field-row">
                  <label htmlFor="firstMonth">Premier mois projeté</label>
                  <select className="select" id="firstMonth" name="firstMonth" defaultValue={firsts.at(-1)}>
                    {firsts.map((m) => <option key={m} value={m}>{formatMonth(m)} (base {formatMonth(addMonths(m, -1)).toLowerCase()})</option>)}
                  </select>
                </div>
                <div className="field-row">
                  <label htmlFor="lastMonth">Dernier mois projeté</label>
                  <input className="input" type="month" id="lastMonth" name="lastMonth" defaultValue={`${firsts.at(-1)!.slice(0, 4)}-12`} required />
                </div>
              </div>
            </ActionForm>
          </>
        )}
      </section>
      <Definitions />
    </Header>
  );
}
