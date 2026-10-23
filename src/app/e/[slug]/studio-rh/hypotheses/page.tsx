import { notFound } from "next/navigation";
import { dateTimeFmt } from "@/lib/connectors/labels";
import { addMonths, formatMonth, monthEnd } from "@/lib/dates";
import { BUDGET_DEFINITIONS } from "@/lib/budget/definitions";
import { landing, project } from "@/lib/budget/engine";
import type { BaseSnapshot, Hypothesis, Projection } from "@/lib/budget/types";
import type { ScenarioRow } from "@/lib/budget/store";
import { getConventions, PRORATA_LABELS } from "@/lib/budget/settings";
import { getScenario, KIND_LABELS, listBudgets, listScenarios, type BudgetRow } from "@/lib/budget/store";
import { budgetSeries, liveSeries, scenarioSeries, shifted, type Series } from "@/lib/budget/series";
import { monthRange } from "@/lib/connectors/months";
import { formatEuros } from "@/lib/money";
import { STUDIO_RH_ITEMS } from "@/lib/nav";
import { monthPayroll } from "@/lib/payroll/engine";
import { loadPayrollContext } from "@/lib/payroll/context";
import { hasAtLeast } from "@/lib/roles";
import { requireWorkspace } from "@/lib/workspace";
import { ActionForm } from "./ActionForm";
import { createChainedScenarioAction, createScenarioAction, deleteBudgetAction, deleteScenarioAction, duplicateScenarioAction, freezeScenarioAction, saveBudgetAction } from "./actions";
import { ComparisonView, type Option } from "./ComparisonView";
import { LandingView, variantOptions } from "./LandingView";
import { SalariesView } from "./SalariesView";
import { measures, retraite, sensitivities, type Variant, type VariantKind } from "@/lib/budget/lot3";
import { toCents } from "@/lib/money";
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

// Onglet Atterrissage : retraité, mesures de management, sensibilités (variations lues dans l'URL, jamais enregistrées).
function landingTab(slug: string, s: ScenarioRow, base: BaseSnapshot, hyps: Hypothesis[], proj: Projection, sp: Search) {
  const year = s.firstMonth.slice(0, 4);
  const options = variantOptions(hyps);
  const svs = (Array.isArray(sp.sv) ? sp.sv : sp.sv ? [sp.sv] : []).map(String);
  const sds = (Array.isArray(sp.sd) ? sp.sd : sp.sd ? [sp.sd] : []).map(String);
  const chosen: { value: string; delta: string }[] = [];
  const variants: Variant[] = [];
  const bad: string[] = [];
  svs.slice(0, 5).forEach((v, i) => {
    if (!v) return;
    const delta = (sds[i] ?? "").trim();
    chosen.push({ value: v, delta });
    const [id, kind] = v.split("|") as [string, VariantKind];
    const c = kind === "jours" ? (/^[+-]?\d+$/.test(delta) ? Number(delta) : null) : toCents(delta);
    if (!options.some((o) => o.value === v) || c === null || c === 0) bad.push(`variation ${i + 1} ignorée (valeur manquante, nulle ou invalide)`);
    else variants.push({ hypothesisId: id, kind, delta: c });
  });
  const { reference, landing: land, rows } = sensitivities(base, s.firstMonth, s.lastMonth, hyps, s.conventions, year, variants);
  return (
    <>
      {bad.map((b) => <p key={b} className="notice">{b}</p>)}
      <LandingView hrefBase={`/e/${slug}/studio-rh/hypotheses`} scenarioId={s.id} year={year} landing={land} retraite={reference} measures={measures(base, s.firstMonth, s.lastMonth, hyps, s.conventions, year)} sens={rows} options={options} chosen={chosen} />
    </>
  );
}

// Onglet Comparaison : lectures choisies (paramètre « cmp ») ; par défaut réel courant, N-1 et budgets saisis de l'année.
async function comparison(slug: string, workspaceId: string, s: ScenarioRow, base: BaseSnapshot, proj: Projection, sp: Search) {
  const years = [...new Set(monthRange(s.firstMonth, s.lastMonth).map((m) => m.slice(0, 4)))];
  const year = years.includes(one(sp.annee)) ? one(sp.annee) : years[0];
  const [budgets, scenarios] = await Promise.all([listBudgets(workspaceId), listScenarios(workspaceId)]);
  const options: Option[] = [
    { value: "reel", label: "Réel courant (lecture PayFit appliquée)" },
    { value: "n1", label: "N-1 (réel figé du scénario, projeté du parent le cas échéant)" },
    ...budgets.filter((b: BudgetRow) => b.year === year).map((b) => ({ value: `budget:${b.id}`, label: `Budget saisi « ${b.name} » (${b.year})` })),
    ...scenarios.filter((x) => x.scenario.id !== s.id).map((x) => ({ value: `scenario:${x.scenario.id}`, label: `Scénario « ${x.scenario.name} » (${KIND_LABELS[x.scenario.kind]}, ${x.scenario.status === "fige" ? "figé" : "brouillon"})` })),
  ];
  const raw = Array.isArray(sp.cmp) ? sp.cmp : sp.cmp ? [sp.cmp] : null;
  const selected = (raw ?? ["reel", "n1", ...options.filter((o) => o.value.startsWith("budget:")).map((o) => o.value)]).filter((v) => options.some((o) => o.value === v)).slice(0, 3);
  const principal = scenarioSeries(s.id, s.name, base, proj);
  const compared: Series[] = [];
  for (const v of selected) {
    if (v === "n1") compared.push(shifted(principal, 12, "n1", "N-1"));
    else if (v === "reel") {
      const ctx = await loadPayrollContext(slug);
      // Sans journal PayFit (source DSN, lecture absente) : chaque mois est n.d. avec la raison réelle.
      const why = ctx.unavailable ?? (ctx.source === "dsn" ? "source RH retenue : DSN — journal de paie PayFit non lu" : "journal de paie indisponible");
      compared.push(ctx.input ? liveSeries("reel", "Réel courant", ctx.input, ctx.kpi.input) : { key: "reel", label: "Réel courant", points: new Map(monthRange(`${year}-01`, `${year}-12`).map((m) => [m, { month: m, kind: "nd" as const, reason: why }])) });
    } else if (v.startsWith("budget:")) {
      const b = budgets.find((x) => x.id === v.slice(7));
      if (b) compared.push(budgetSeries(`budget-${b.id.slice(0, 8)}`, `Budget « ${b.name} »`, b.year, b.amounts));
    } else if (v.startsWith("scenario:")) {
      const o = await getScenario(workspaceId, v.slice(9));
      if (o) compared.push(scenarioSeries(`scenario-${o.scenario.id.slice(0, 8)}`, `« ${o.scenario.name} »`, o.base, project(o.base, o.scenario.firstMonth, o.scenario.lastMonth, o.hypotheses, o.scenario.conventions)));
    }
  }
  return <ComparisonView hrefBase={`/e/${slug}/studio-rh/hypotheses`} scenarioId={s.id} years={years} year={year} principal={principal} compared={compared} options={options} selected={selected} refMonth={base.refMonth} />;
}

const centsText = (c: number | null) => (c === null ? "" : `${Math.trunc(c / 100)},${String(Math.abs(c % 100)).padStart(2, "0")}`);

// Budgets saisis : montants chargés globaux par mois (budget fait hors de Clair), référence des comparaisons.
function BudgetForm({ slug, budget, testid }: { slug: string; budget: BudgetRow | null; testid: string }) {
  const y = budget?.year ?? String(new Date().getFullYear());
  return (
    <ActionForm action={saveBudgetAction.bind(null, slug, budget?.id ?? null)} submit={budget ? "Enregistrer les montants" : "Créer le budget"} testid={testid}>
      <div className="filters">
        <div className="field-row">
          <label htmlFor={`${testid}-name`}>Nom</label>
          <input className="input" id={`${testid}-name`} name="name" defaultValue={budget?.name ?? ""} maxLength={120} required />
        </div>
        <div className="field-row">
          <label htmlFor={`${testid}-year`}>Année</label>
          <input className="input" id={`${testid}-year`} name="year" defaultValue={y} pattern="\d{4}" required />
        </div>
      </div>
      <div className="filters">
        {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0")).map((mm) => (
          <div className="field-row" key={mm}>
            <label htmlFor={`${testid}-m${mm}`}>{formatMonth(`${y}-${mm}`).split(" ")[0]} (€ chargés)</label>
            <input className="input" id={`${testid}-m${mm}`} name={`m${mm}`} inputMode="decimal" defaultValue={centsText(budget?.amounts[`${y}-${mm}`] ?? null)} />
          </div>
        ))}
      </div>
      <p className="tile-foot">Mois vide : non saisi (n.d.), jamais compté pour 0. Saisir 0 pour un montant nul.</p>
    </ActionForm>
  );
}

function BudgetsSection({ slug, budgets, canEdit }: { slug: string; budgets: BudgetRow[]; canEdit: boolean }) {
  const totalOf = (b: BudgetRow) => {
    const v = Object.values(b.amounts);
    return v.length === 12 && v.every((x) => x !== null) ? formatEuros(v.reduce((s, x) => s! + x!, 0)!) : `n.d. — ${12 - v.filter((x) => x !== null).length} mois non saisi(s)`;
  };
  return (
    <section className="panel" data-testid="hyp-budgets">
      <h2>Budgets saisis <span className="desc">— référence des comparaisons : coût employeur global par mois</span></h2>
      {budgets.length === 0 ? (
        <p className="desc">Aucun budget saisi.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table" data-testid="hyp-budgets-table">
            <thead><tr><th>Budget</th><th>Année</th><th className="num">Total annuel</th><th>Modifié le</th></tr></thead>
            <tbody>
              {budgets.map((b) => (
                <tr key={b.id} data-budget={b.name}>
                  <td>
                    {canEdit ? (
                      <details>
                        <summary>{b.name}</summary>
                        <BudgetForm slug={slug} budget={b} testid={`budget-edit-${b.id.slice(0, 8)}`} />
                        <ActionForm action={deleteBudgetAction.bind(null, slug, b.id)} submit="Supprimer ce budget" testid={`budget-delete-${b.id.slice(0, 8)}`} className="inline-form" danger />
                      </details>
                    ) : b.name}
                  </td>
                  <td>{b.year}</td>
                  <td className="num" data-col="total">{totalOf(b)}</td>
                  <td>{dateTimeFmt.format(b.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canEdit && (
        <details>
          <summary>Saisir un budget</summary>
          <BudgetForm slug={slug} budget={null} testid="budget-create" />
        </details>
      )}
    </section>
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
    const vue = one(sp.vue) === "hypotheses" ? "hypotheses" : one(sp.vue) === "comparaison" ? "comparaison" : one(sp.vue) === "atterrissage" ? "atterrissage" : one(sp.vue) === "salaries" ? "salaries" : "projection";
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
            {full.base.origin
              ? <>Base dérivée du scénario « {full.base.origin.scenarioName} » (état projeté fin {formatMonth(full.base.origin.month).toLowerCase()}, le {full.base.origin.at}) ·</>
              : <>Base figée sur {formatMonth(full.base.refMonth).toLowerCase()} (lecture PayFit du {full.base.readAt}) ·</>} projection {formatMonth(s.firstMonth).toLowerCase()} → {formatMonth(s.lastMonth).toLowerCase()} ·
            prorata : {s.conventions.prorata === "calendaire" ? "jours calendaires" : s.conventions.prorata === "ouvres" ? "jours ouvrés" : "aucun"} · {full.hypotheses.length} hypothèse(s) · créé le {dateTimeFmt.format(s.createdAt)}
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
          {canEdit && !draft && (
            <details style={{ marginTop: 12 }}>
              <summary>Préparer le budget suivant (simulateur N+1)</summary>
              <p className="desc">Nouveau scénario dont la base est l'état projeté de celui-ci fin {formatMonth(s.lastMonth).toLowerCase()} : contrats encore présents au salaire du mois complet (augmentations comprises), embauches reprises, départs et éléments ponctuels non repris. Projection à partir de {formatMonth(addMonths(s.lastMonth, 1)).toLowerCase()}.</p>
              <ActionForm action={createChainedScenarioAction.bind(null, slug, s.id)} submit="Créer le scénario dérivé" testid="hyp-chain">
                <div className="filters">
                  <div className="field-row">
                    <label htmlFor="chain-name">Nom</label>
                    <input className="input" id="chain-name" name="name" maxLength={120} required />
                  </div>
                  <div className="field-row">
                    <label htmlFor="chain-kind">Type</label>
                    <select className="select" id="chain-kind" name="kind" defaultValue="">
                      <option value="" disabled>Choisir…</option>
                      <option value="budget">Budget</option>
                      <option value="revise">Révisé</option>
                      <option value="simulation">Simulation</option>
                    </select>
                  </div>
                  <div className="field-row">
                    <label htmlFor="chain-last">Dernier mois projeté</label>
                    <input className="input" type="month" id="chain-last" name="lastMonth" defaultValue={`${addMonths(s.lastMonth, 1).slice(0, 4)}-12`} required />
                  </div>
                </div>
              </ActionForm>
            </details>
          )}
          {canEdit && draft && <p className="tile-foot" data-testid="hyp-chain-frozen-only">Simulateur N+1 : figez ce scénario pour en dériver le budget suivant.</p>}
        </section>
        <nav className="tabs" data-testid="hyp-tabs">
          <a href={href("projection")} aria-current={vue === "projection" ? "page" : undefined}>Projection</a>
          <a href={href("salaries")} aria-current={vue === "salaries" ? "page" : undefined}>Salariés</a>
          <a href={href("hypotheses")} aria-current={vue === "hypotheses" ? "page" : undefined}>Hypothèses</a>
          <a href={href("comparaison")} aria-current={vue === "comparaison" ? "page" : undefined}>Comparaison</a>
          <a href={href("atterrissage")} aria-current={vue === "atterrissage" ? "page" : undefined}>Atterrissage</a>
        </nav>
        {vue === "projection" ? (
          <ProjectionView slug={slug} scenario={s} base={full.base} proj={proj} landing={landing(full.base, proj, year)} month={one(sp.mois)} />
        ) : vue === "salaries" ? (
          <SalariesView slug={slug} scenario={s} base={full.base} hyps={full.hypotheses} proj={proj} q={one(sp.q)} selected={one(sp.salarie)} canEdit={canEdit && draft} />
        ) : vue === "atterrissage" ? (
          landingTab(slug, s, full.base, full.hypotheses, proj, sp)
        ) : vue === "comparaison" ? (
          await comparison(slug, workspace.id, s, full.base, proj, sp)
        ) : (
          <HypothesesView slug={slug} scenario={s} base={full.base} hypotheses={full.hypotheses} proj={proj} canEdit={canEdit && draft} />
        )}
        <Definitions />
      </Header>
    );
  }

  // Liste des scénarios et création.
  const [rows, conv, ctx, budgets] = await Promise.all([listScenarios(workspace.id), getConventions(workspace.id), loadPayrollContext(slug), listBudgets(workspace.id)]);
  const input = ctx.source === "payfit" ? ctx.input : null;
  // Mois de référence possibles : paie clôturée, journal lu, et mois fini à la date de lecture du référentiel.
  const refDate = ctx.kpi.input?.data.build.referenceDate ?? null;
  const closed = input ? input.months.filter((m) => !input.openMonths.includes(m) && refDate !== null && monthEnd(m) <= refDate && monthPayroll(input, m).kind === "value").sort() : [];
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
      <BudgetsSection slug={slug} budgets={budgets} canEdit={canEdit} />
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
