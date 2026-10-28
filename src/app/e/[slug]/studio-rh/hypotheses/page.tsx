import { MoneyText } from "@/components/Money";
import "@/styles/hypotheses-saisie.css";
import { notFound, redirect } from "next/navigation";
import { dateTimeFmt } from "@/lib/connectors/labels";
import { addMonths, formatMonth, monthEnd } from "@/lib/dates";
import { GlossaryLink } from "@/components/GlossaryLink";
import { BUDGET_TERMS } from "@/lib/glossary/budget";
import { landing, project } from "@/lib/budget/engine";
import type { BaseSnapshot, Hypothesis, Projection } from "@/lib/budget/types";
import type { ScenarioRow } from "@/lib/budget/store";
import { getConventions, PRORATA_LABELS } from "@/lib/budget/settings";
import { getScenario, KIND_LABELS, listBudgets, listScenarios, type BudgetRow } from "@/lib/budget/store";
import { monthRange } from "@/lib/connectors/months";
import { dateFr } from "@/lib/viz/hyp-saisie";
import { formatEuros } from "@/lib/money";
import { STUDIO_RH_ITEMS } from "@/lib/nav";
import { monthPayroll } from "@/lib/payroll/engine";
import { loadPayrollContext } from "@/lib/payroll/context";
import { listActualEvents } from "@/lib/payroll/non-recurring-store";
import { hasAtLeast } from "@/lib/roles";
import { requireWorkspace } from "@/lib/workspace";
import { ActionForm } from "./ActionForm";
import { createChainedScenarioAction, createScenarioAction, deleteBudgetAction, deleteScenarioAction, duplicateScenarioAction, freezeScenarioAction, saveBudgetAction } from "./actions";
import { ComparisonView } from "./ComparisonView";
import { ActualNonRecurringStatus, LandingView, variantOptions } from "./LandingView";
import { measures, sensitivities, type ActualNonRecurringInput, type Variant, type VariantKind } from "@/lib/budget/lot3";
import { toCents } from "@/lib/money";
import { ProjectionView } from "./ProjectionView";
import { loadComparison } from "./resultat-data";
import { FamilyTabs } from "@/components/FamilyTabs";
import { Prevu } from "@/components/Prevu";
import { BasesView } from "./BasesView";
import { ControlesChangements, ControlesEffectifs } from "./ControlesView";
import { EmbauchesView } from "./EmbauchesView";
import { EnveloppesView } from "./EnveloppesView";
import { GlobalesView } from "./GlobalesView";
import { PostesView } from "./PostesView";
import { CardTitle, Field, FieldGroup } from "./shared";
import { resolveVue, SOUS, VUES } from "./tabs";

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
      </div>
      {children}
    </>
  );
}

// Onglet Atterrissage : retraité, mesures de management, sensibilités (variations lues dans l'URL, jamais enregistrées).
async function landingTab(slug: string, workspaceId: string, s: ScenarioRow, base: BaseSnapshot, hyps: Hypothesis[], sp: Search) {
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
  let actual: ActualNonRecurringInput;
  try {
    actual = { kind: "value", events: await listActualEvents(workspaceId) };
  } catch {
    actual = { kind: "nd", reason: "Les éléments non récurrents du Réel n’ont pas pu être lus. Recharge la page avant de lire l’atterrissage retraité." };
  }
  const { reference, landing: land, rows } = sensitivities(base, s.firstMonth, s.lastMonth, hyps, s.conventions, year, variants, actual);
  const actualStatuses = actual.kind === "value" ? actual.events.filter((event) => event.month.startsWith(`${year}-`) && event.month <= base.refMonth).sort((a, b) => a.month.localeCompare(b.month) || a.kind.localeCompare(b.kind)).map((event) => ({
    kind: event.kind, month: event.month, amountMissing: event.chargedCents === null,
    sourceMismatch: event.syncId.toLowerCase() !== base.syncId.toLowerCase(),
    monthUnavailable: !base.actuals.some((month) => month.month === event.month && month.kind === "value"),
    legacyOverlap: hyps.some((hypothesis) => hypothesis.kind === "realise" && hypothesis.month === event.month),
  })) : [];
  return (
    <>
      {bad.map((b) => <p key={b} className="notice">{b}</p>)}
      <p className="tile-foot" data-testid="atr-actual-source">L’atterrissage brut reste inchangé. Le retraité isole les coûts passés identifiés dans Réel et les éléments non récurrents prévus. <a href={`/e/${slug}/studio-rh/masse-salariale`}>Identifier les coûts passés dans Réel</a>.</p>
      <ActualNonRecurringStatus items={actualStatuses} />
      <LandingView hrefBase={`/e/${slug}/studio-rh/hypotheses`} scenarioId={s.id} year={year} landing={land} retraite={reference} measures={measures(base, s.firstMonth, s.lastMonth, hyps, s.conventions, year)} sens={rows} options={options} chosen={chosen} affichage={one(sp.affichage)} />
    </>
  );
}

// Onglet Comparaison : lectures choisies (paramètre « cmp ») ; par défaut réel courant, N-1 et budgets saisis de l'année. Chargement
// commun avec l'export Excel.
async function comparison(slug: string, workspaceId: string, s: ScenarioRow, base: BaseSnapshot, proj: Projection, sp: Search) {
  const { years, year, options, selected, principal, compared } = await loadComparison(slug, workspaceId, s, base, proj, sp);
  return <ComparisonView hrefBase={`/e/${slug}/studio-rh/hypotheses`} scenarioId={s.id} years={years} year={year} principal={principal} compared={compared} options={options} selected={selected} refMonth={base.refMonth} affichage={one(sp.affichage)} />;
}

const centsText = (c: number | null) => (c === null ? "" : `${Math.trunc(c / 100)},${String(Math.abs(c % 100)).padStart(2, "0")}`);

// Budgets saisis : montants chargés globaux par mois (budget fait hors de Clair), référence des comparaisons.
function BudgetForm({ slug, budget, testid }: { slug: string; budget: BudgetRow | null; testid: string }) {
  const y = budget?.year ?? String(new Date().getFullYear());
  return (
    <ActionForm action={saveBudgetAction.bind(null, slug, budget?.id ?? null)} submit={budget ? "Enregistrer les montants" : "Créer le budget"} testid={testid}>
      <FieldGroup title="Budget">
        <Field id={`${testid}-name`} label="Nom"><input className="input" id={`${testid}-name`} name="name" defaultValue={budget?.name ?? ""} maxLength={120} required /></Field>
        <Field id={`${testid}-year`} label="Année" hint="Quatre chiffres."><input className="input" id={`${testid}-year`} name="year" defaultValue={y} pattern="\d{4}" required /></Field>
      </FieldGroup>
      <FieldGroup title="Coût employeur global par mois" hint="Mois vide : n.d. ; saisir 0 pour un montant nul.">
        {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0")).map((mm) => (
          <div className="field-row" key={mm}>
            <label htmlFor={`${testid}-m${mm}`}>{formatMonth(`${y}-${mm}`).split(" ")[0]} (€ chargés)</label>
            <input className="input" id={`${testid}-m${mm}`} name={`m${mm}`} inputMode="decimal" defaultValue={centsText(budget?.amounts[`${y}-${mm}`] ?? null)} />
          </div>
        ))}
      </FieldGroup>
    </ActionForm>
  );
}

function BudgetsSection({ slug, budgets, canEdit }: { slug: string; budgets: BudgetRow[]; canEdit: boolean }) {
  const totalOf = (b: BudgetRow) => {
    const v = Object.values(b.amounts);
    return v.length === 12 && v.every((x) => x !== null) ? formatEuros(v.reduce((s, x) => s! + x!, 0)!) : `n.d. — ${12 - v.filter((x) => x !== null).length} mois non saisi(s)`;
  };
  return (
    <MoneyText><section className="panel" data-testid="hyp-budgets">
      <CardTitle title="Budgets saisis" help={<GlossaryLink slug={slug} term={BUDGET_TERMS.budgetSaisi} />} />
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
                        <ActionForm action={deleteBudgetAction.bind(null, slug, b.id)} submit="Supprimer ce budget" testid={`budget-delete-${b.id.slice(0, 8)}`} className="inline-form" danger confirm={`Supprimer définitivement le budget « ${b.name} » ?`} />
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
          <summary className="hs-disclose">Saisir un budget</summary>
          <BudgetForm slug={slug} budget={null} testid="budget-create" />
        </details>
      )}
    </section></MoneyText>
  );
}

// Autres scénarios de l'espace : on change de scénario sans perdre l'entrée du menu en cours.
function ScenarioSwitch({ current, rows, hrefOf }: { current: string; rows: { scenario: ScenarioRow }[]; hrefOf: (id: string) => string }) {
  if (rows.length < 2) return null;
  return (
    <details className="hs-switch" data-testid="hyp-switch">
      <summary className="btn">Changer de scénario ({rows.length})</summary>
      <ul className="hs-switch-list">
        {rows.map(({ scenario: x }) => (
          <li key={x.id}>
            <a href={hrefOf(x.id)} aria-current={x.id === current ? "page" : undefined}>
              <span className="hs-switch-name">{x.name}</span>
              <span className="hs-switch-meta">{KIND_LABELS[x.kind]} · {STATUS[x.status]} · {formatMonth(x.firstMonth).toLowerCase()} → {formatMonth(x.lastMonth).toLowerCase()}</span>
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}

const PRORATA_SHORT = { calendaire: "jours calendaires", ouvres: "jours ouvrés", aucun: "aucun" } as const;

export default async function HypothesesPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Search> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { workspace } = await requireWorkspace(slug);
  const canEdit = hasAtLeast(workspace.role, "editor");
  const base = `/e/${slug}/studio-rh/hypotheses`;
  const scenarioId = one(sp.scenario);
  const vueParam = one(sp.vue);

  // Une entrée du menu général (…/hypotheses?vue=…) mène directement à l'écran voulu : on ouvre le brouillon le plus récent,
  // à défaut le scénario le plus récent, avec la même entrée. Sans scénario, la liste dit quoi faire.
  let noScenarioFor: string | null = null;
  if (!scenarioId && vueParam) {
    const all = [...(await listScenarios(workspace.id))].sort((a, b) => b.scenario.createdAt.getTime() - a.scenario.createdAt.getTime());
    const target = all.find((r) => r.scenario.status === "brouillon") ?? all[0];
    if (target) {
      const qs = new URLSearchParams({ scenario: target.scenario.id });
      for (const [k, v] of Object.entries(sp)) {
        if (k === "scenario" || v === undefined) continue;
        for (const x of Array.isArray(v) ? v : [v]) qs.append(k, x);
      }
      redirect(`${base}?${qs.toString()}`);
    }
    noScenarioFor = VUES.find((v) => v.key === resolveVue(vueParam, "").vue)?.label ?? null;
  }

  if (scenarioId) {
    const full = await getScenario(workspace.id, scenarioId);
    if (!full) notFound();
    const s = full.scenario;
    const { vue, sous } = resolveVue(vueParam, one(sp.sous));
    const proj = project(full.base, s.firstMonth, s.lastMonth, full.hypotheses, s.conventions);
    const year = s.firstMonth.slice(0, 4);
    const draft = s.status === "brouillon";
    const editing = canEdit && draft;
    const all = await listScenarios(workspace.id);
    const href = (v: string) => `${base}?scenario=${s.id}${v === "resultat" ? "" : `&vue=${v}`}`;
    const switchHref = (id: string) => `${base}?scenario=${id}${vue === "resultat" ? `&vue=resultat&sous=${sous}` : `&vue=${vue}`}`;
    const nMonths = monthRange(s.firstMonth, s.lastMonth).length;
    // Seul un état qui interdit la saisie s'écrit sous l'en-tête (il explique pourquoi rien ne se saisit) ; le reste est au glossaire.
    const mode = !draft ? "Scénario figé : lecture seule." : !canEdit ? "Brouillon en lecture seule : votre rôle ne permet pas de modifier les hypothèses." : null;
    return (
      <Header>
        <div className="hs-crumb">
          <a href={base}>← Tous les scénarios</a>
          <ScenarioSwitch current={s.id} rows={all} hrefOf={switchHref} />
        </div>
        <section className="panel hs-scenario" data-testid="hyp-scenario">
          <div className="hs-scn-line">
            <div className="hs-scn-head">
              <h2>{s.name}</h2>
              <span className="tag">{KIND_LABELS[s.kind]}</span>
              <span className={`tag hs-status ${draft ? "is-draft" : "is-frozen"}`} data-testid="hyp-status">{STATUS[s.status]}</span>
              <GlossaryLink slug={slug} term={BUDGET_TERMS.scenarioStatut} />
            </div>
            <dl className="facts hs-facts">
              <div><dt>Projection</dt><dd>{formatMonth(s.firstMonth)} → {formatMonth(s.lastMonth)} <span className="hs-nw">({nMonths} mois)</span></dd></div>
              <div><dt>Prorata</dt><dd>{PRORATA_SHORT[s.conventions.prorata]}<GlossaryLink slug={slug} term={BUDGET_TERMS.prorata} /></dd></div>
              <div data-testid="hyp-count"><dt>Hypothèses</dt><dd><a href={href("ctrl-changements")} title="Voir toutes les hypothèses et leur effet">{full.hypotheses.length}</a></dd></div>
              <div><dt>Créé le</dt><dd className="hs-nw">{dateTimeFmt.format(s.createdAt)}</dd></div>
              {s.frozenAt && <div><dt>Figé le</dt><dd className="hs-nw">{dateTimeFmt.format(s.frozenAt)}</dd></div>}
            </dl>
          </div>
          <p className="hs-context" data-testid="hyp-context">
            {full.base.origin
              ? <>Base dérivée du scénario « {full.base.origin.scenarioName} » (état projeté fin {formatMonth(full.base.origin.month).toLowerCase()}, le <span className="hs-nw">{dateFr(full.base.origin.at)}</span>)</>
              : <>Base figée sur {formatMonth(full.base.refMonth).toLowerCase()} (lecture PayFit du <span className="hs-nw">{dateFr(full.base.readAt)}</span>)</>}
            <GlossaryLink slug={slug} term={BUDGET_TERMS.base} />
          </p>
          {mode && <p className="tile-foot" data-testid="hyp-mode">{mode}</p>}
          {canEdit && vue !== "societes" && (
            <>
              <div className="hs-bar" role="group" aria-label="Actions sur le scénario">
                {draft && <ActionForm action={freezeScenarioAction.bind(null, slug, s.id)} submit="Figer le scénario" testid="hyp-freeze" className="inline-form" plain hint="Verrouille les hypothèses : plus aucune modification" />}
                <ActionForm action={duplicateScenarioAction.bind(null, slug, s.id)} submit="Dupliquer" testid="hyp-duplicate" className="inline-form hs-dup" plain hint="Crée un brouillon indépendant avec les mêmes hypothèses">
                  <div className="field-row">
                    <label htmlFor="dup-name">Nom de la copie</label>
                    <input className="input" id="dup-name" name="name" defaultValue={`${s.name} (copie)`} maxLength={120} required />
                  </div>
                </ActionForm>
                {draft && <p className="tile-foot hs-bar-note" data-testid="hyp-chain-frozen-only">Simulateur N+1 : disponible une fois le scénario figé.</p>}
                {draft && (
                  <details className="hs-manage" data-testid="hyp-manage">
                    <summary className="hs-disclose">Gérer le scénario</summary>
                    <div className="hs-manage-body">
                      <div className="hs-act-danger">
                        <h3>Supprimer</h3>
                        <ActionForm action={deleteScenarioAction.bind(null, slug, s.id)} submit="Supprimer le brouillon" testid="hyp-delete" className="inline-form" danger confirm={`Supprimer définitivement le brouillon « ${s.name} » et ses hypothèses ?`} />
                      </div>
                    </div>
                  </details>
                )}
              </div>
              {!draft && (
                <details className="hs-chain">
                  <summary className="hs-disclose">Préparer le budget suivant (simulateur N+1)</summary>
                  <p className="hs-context" style={{ margin: "10px 0" }}>Base : état projeté fin {formatMonth(s.lastMonth).toLowerCase()} · projection à partir de {formatMonth(addMonths(s.lastMonth, 1)).toLowerCase()}<GlossaryLink slug={slug} term={BUDGET_TERMS.derivee} /></p>
                  <ActionForm action={createChainedScenarioAction.bind(null, slug, s.id)} submit="Créer le scénario dérivé" testid="hyp-chain">
                    <FieldGroup title="Scénario dérivé">
                      <Field id="chain-name" label="Nom"><input className="input" id="chain-name" name="name" maxLength={120} required /></Field>
                      <Field id="chain-kind" label="Type">
                        <select className="select" id="chain-kind" name="kind" defaultValue="">
                          <option value="" disabled>Choisir…</option>
                          <option value="budget">Budget</option>
                          <option value="revise">Révisé</option>
                          <option value="simulation">Simulation</option>
                        </select>
                      </Field>
                      <Field id="chain-last" label="Dernier mois projeté" hint="24 mois au plus."><input className="input" type="month" id="chain-last" name="lastMonth" defaultValue={`${addMonths(s.lastMonth, 1).slice(0, 4)}-12`} required /></Field>
                    </FieldGroup>
                  </ActionForm>
                </details>
              )}
            </>
          )}
        </section>
        <FamilyTabs label="Entrées du scénario" testid="hyp-tabs" current={vue} tabs={VUES.map((v) => ({ key: v.key, label: v.label, href: href(v.key), soon: "soon" in v ? v.soon : false }))} />
        {vue === "postes" ? (
          <PostesView slug={slug} scenario={s} base={full.base} hyps={full.hypotheses} proj={proj} q={one(sp.q)} selected={one(sp.salarie)} canEdit={editing} page={one(sp.page)} forme={one(sp.forme)} service={one(sp.service)} />
        ) : vue === "embauches" ? (
          <EmbauchesView slug={slug} scenario={s} base={full.base} hypotheses={full.hypotheses} canEdit={editing} par={one(sp.par)} affichage={one(sp.affichage)} />
        ) : vue === "bases" ? (
          <BasesView slug={slug} scenario={s} base={full.base} hypotheses={full.hypotheses} canEdit={editing} xlsx={canEdit} />
        ) : vue === "env-service" || vue === "env-rubrique" ? (
          <EnveloppesView slug={slug} scenario={s} base={full.base} hypotheses={full.hypotheses} axis={vue === "env-service" ? "service" : "rubrique"} canEdit={editing} />
        ) : vue === "globales" ? (
          <GlobalesView slug={slug} scenario={s} base={full.base} hypotheses={full.hypotheses} canEdit={editing} />
        ) : vue === "societes" ? (
          <Prevu
            title="Hypothèses par société"
            lead="Non réalisé : un espace Clair correspond aujourd'hui à une seule société. Des hypothèses propres à chaque société n'ont de sens qu'avec plusieurs sociétés dans l'espace."
            existing={[{ href: href("globales"), title: "Hypothèses globales", text: "Taux d'augmentation par mois pour toute l'entreprise, chaque service et chaque statut, et constantes de référence." }]}
            open={["À quelle société rattacher une hypothèse lorsque l'espace en compte plusieurs.", "Priorité entre une hypothèse de société et une hypothèse globale pour un même mois.", "Périmètre des contrôles et de la projection : une société ou l'ensemble."]}
          />
        ) : vue === "ctrl-effectifs" ? (
          <ControlesEffectifs slug={slug} base={full.base} hypotheses={full.hypotheses} proj={proj} />
        ) : vue === "ctrl-changements" ? (
          <ControlesChangements slug={slug} scenario={s} base={full.base} hypotheses={full.hypotheses} proj={proj} canEdit={editing} q={one(sp.q)} type={one(sp.type)} page={one(sp.page)} others={editing ? all.filter((x) => x.scenario.id !== s.id).map((x) => ({ id: x.scenario.id, name: x.scenario.name, label: `${x.scenario.name} (${KIND_LABELS[x.scenario.kind]}, ${x.scenario.status === "fige" ? "figé" : "brouillon"}, ${formatMonth(x.scenario.firstMonth).toLowerCase()} → ${formatMonth(x.scenario.lastMonth).toLowerCase()})` })) : []} />
        ) : (
          <>
            <nav className="tabs" aria-label="Résultat du scénario" data-testid="res-tabs">
              {SOUS.map((x) => <a key={x.key} href={`${base}?scenario=${s.id}&vue=resultat&sous=${x.key}`} aria-current={x.key === sous ? "page" : undefined}>{x.label}</a>)}
            </nav>
            {sous === "projection" ? (
              <ProjectionView slug={slug} scenario={s} base={full.base} proj={proj} landing={landing(full.base, proj, year)} month={one(sp.mois)} affichage={one(sp.affichage)} />
            ) : sous === "atterrissage" ? (
              await landingTab(slug, workspace.id, s, full.base, full.hypotheses, sp)
            ) : (
              await comparison(slug, workspace.id, s, full.base, proj, sp)
            )}
          </>
        )}
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
      {noScenarioFor && (
        <p className="notice" data-testid="hyp-vue-no-scenario">
          Aucun scénario pour l'instant : « {noScenarioFor} » s'ouvre dans un scénario. {canEdit ? "Créez-en un pour commencer." : "Un éditeur ou un administrateur doit en créer un."}
        </p>
      )}
      <section className="panel" data-testid="hyp-list">
        <CardTitle title="Scénarios" help={<GlossaryLink slug={slug} term={BUDGET_TERMS.scenario} />} />
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
                    <td><span className={`tag hs-status ${s.status === "brouillon" ? "is-draft" : "is-frozen"}`}>{STATUS[s.status]}</span></td>
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
        <CardTitle title="Nouveau scénario" help={<GlossaryLink slug={slug} term={BUDGET_TERMS.scenario} />} />
        {unavailable ? (
          <p className="nd" data-testid="hyp-nd">n.d. — base figée impossible : {unavailable}. <a href={`/e/${slug}/donnees`}>Données</a></p>
        ) : !conv ? (
          <p className="nd" data-testid="hyp-conventions-nd">n.d. — conventions de calcul non renseignées : un administrateur doit choisir la règle de prorata dans <a href={`/e/${slug}/parametres#projection`}>Paramètres › Projection</a>. Clair ne projette pas sans elle.</p>
        ) : !canEdit ? (
          <p className="desc">Création réservée aux éditeurs et administrateurs.</p>
        ) : (
          <>
            <p className="desc">Lecture PayFit du {ctx.read ? dateTimeFmt.format(ctx.read.startedAt) : "n.d."} · prorata : {PRORATA_LABELS[conv.conventions.prorata]}</p>
            <ActionForm action={createScenarioAction.bind(null, slug)} submit="Créer le scénario" testid="hyp-create-form">
              <FieldGroup title="Scénario">
                <Field id="name" label="Nom"><input className="input" id="name" name="name" maxLength={120} required /></Field>
                <Field id="kind" label="Type">
                  <select className="select" id="kind" name="kind" defaultValue="">
                    <option value="" disabled>Choisir…</option>
                    <option value="budget">Budget</option>
                    <option value="revise">Révisé</option>
                    <option value="simulation">Simulation</option>
                  </select>
                </Field>
              </FieldGroup>
              <FieldGroup title="Horizon de projection">
                <Field id="firstMonth" label="Premier mois projeté">
                  <select className="select" id="firstMonth" name="firstMonth" defaultValue={firsts.at(-1)}>
                    {firsts.map((m) => <option key={m} value={m}>{formatMonth(m)} (base {formatMonth(addMonths(m, -1)).toLowerCase()})</option>)}
                  </select>
                </Field>
                <Field id="lastMonth" label="Dernier mois projeté" hint="24 mois au plus."><input className="input" type="month" id="lastMonth" name="lastMonth" defaultValue={`${firsts.at(-1)!.slice(0, 4)}-12`} required /></Field>
              </FieldGroup>
            </ActionForm>
          </>
        )}
      </section>
    </Header>
  );
}
