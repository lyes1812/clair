import "@/styles/donnees.css";
import { and, eq } from "drizzle-orm";
import { workspaceSetting } from "@/db/schema";
import { withWorkspace } from "@/db/workspace-scope";
import { dateTimeFmt } from "@/lib/connectors/labels";
import { ABSENCE_STATUSES } from "@/lib/connectors/payfit/client";
import { getKpiSettings, kpiOriginText, type KpiSettingKey } from "@/lib/rh-kpi-settings";
import { getHeadcountNatures, getPayfitHistoryMode, HEADCOUNT_NATURES_KEY, natureChoices, PAYFIT_HISTORY_KEY } from "@/lib/rh-settings";
import { PAYFIT_ARCHIVED_RETENTION_MONTHS } from "@/lib/rh/referential/build-payfit";
import { ABSENCE_STATUS_LABELS } from "@/lib/rh/labels";
import { activePayFitSync, loadAbsenceTypes } from "@/lib/rh/referential/store";
import { KpiForm } from "./KpiForm";
import { requireWorkspace } from "@/lib/workspace";
import { HeadcountForm } from "./HeadcountForm";
import { PayfitHistoryForm } from "./PayfitHistoryForm";
import { PayrollGridForm } from "./PayrollGridForm";
import { getPayrollGrid, getServiceAxis } from "@/lib/payroll-settings";
import { journalAxes } from "@/lib/payroll/context";
import { ServiceAxisForm } from "./ServiceAxisForm";
import { gridRubrics } from "@/lib/payroll/grid";
import { getConventions, PRORATA_LABELS } from "@/lib/budget/settings";
import { ProrataForm } from "./ProrataForm";
import { CategoryNaturesForm } from "./CategoryNaturesForm";
import { categoryOfNature, getCategoryNatures, getContractCategories } from "@/lib/budget/categories";
import { ContractCategoriesForm } from "./ContractCategoriesForm";
import { loadCollabContext } from "@/lib/rh/view";
import { contractNatureLabel } from "@/lib/dsn/labels";
import { personLabel } from "@/lib/rh/view";
import { ParamLayout } from "@/components/ParamLayout";
import { PageHead, Pill, type Tone } from "../donnees/ui";

export const dynamic = "force-dynamic";

export default async function ParametresPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { workspace } = await requireWorkspace(slug);
  const isAdmin = workspace.role === "admin";
  const [kpi, active] = await Promise.all([getKpiSettings(workspace.id), activePayFitSync(workspace.id)]);
  const readTypes = active ? await loadAbsenceTypes(workspace.id, active.id) : [];
  const typeRows = [...new Set([...readTypes.map((t) => t.type), ...kpi.values.absenceTypes])].sort().map((type) => {
    const t = readTypes.find((x) => x.type === type);
    return { type, count: t?.count ?? 0, inRead: Boolean(t) };
  });
  const origins = Object.fromEntries((Object.keys(kpi.origins) as KpiSettingKey[]).map((k) => [k, kpiOriginText(k, kpi.origins[k], (d) => dateTimeFmt.format(d))]));
  const updatedAt = (key: string) =>
    withWorkspace(workspace.id, (tx) =>
      tx.select({ updatedAt: workspaceSetting.updatedAt }).from(workspaceSetting).where(and(eq(workspaceSetting.workspaceId, workspace.id), eq(workspaceSetting.key, key))),
    ).then(([r]) => r?.updatedAt ?? null);
  const axes = await journalAxes(workspace.id);
  const serviceAxis = await getServiceAxis(workspace.id, axes);
  const [natures, row, history, historyAt, payroll, projection] = await Promise.all([getHeadcountNatures(workspace.id), updatedAt(HEADCOUNT_NATURES_KEY), getPayfitHistoryMode(workspace.id), updatedAt(PAYFIT_HISTORY_KEY), getPayrollGrid(workspace.id), getConventions(workspace.id)]);
  const categories = await getCategoryNatures(workspace.id);
  const overrides = await getContractCategories(workspace.id);
  const collab = await loadCollabContext(slug);
  const ref = collab.data?.build.referenceDate ?? null;
  const persons = new Map((collab.data?.persons ?? []).map((p) => [p.personKey, p]));
  const contractRows = (collab.data?.contracts ?? [])
    .filter((c) => c.endDate === null || ref === null || c.endDate >= ref)
    .map((c) => ({
      id: c.externalId,
      label: (c.personKey ? personLabel(persons.get(c.personKey)) : null) ?? c.externalId,
      natureLabel: c.nature ? contractNatureLabel(c.nature) : "nature n.d.",
      proposed: categoryOfNature(c.nature, categories.natures),
      chosen: overrides[c.externalId] ?? null,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // État de chaque règle pour la navigation de la page : valeur par défaut, modifiée, à corriger ou à renseigner.
  const stateOf = (origin: "default" | "setting"): { text: string; tone: Tone } => (origin === "default" ? { text: "Par défaut", tone: "neutral" } : { text: "Modifiée", tone: "preview" });
  const kpiOrigins = Object.values(kpi.origins).map((o) => o.origin);
  const nav: { id: string; label: string; state: { text: string; tone: Tone } }[] = [
    { id: "effectif", label: "Définition de l'effectif", state: stateOf(natures.origin) },
    { id: "payfit-historique", label: "Historique PayFit", state: stateOf(history.origin) },
    { id: "kpi", label: "Définitions des KPI", state: kpi.invalid.length > 0 ? { text: "À corriger", tone: "failed" } : stateOf(kpiOrigins.includes("setting") ? "setting" : "default") },
    { id: "masse-salariale", label: "Masse salariale : grille de comptes", state: stateOf(payroll.origin) },
    { id: "projection", label: "Projection : conventions de calcul", state: projection ? { text: "Renseignée", tone: "applied" } : { text: "À renseigner", tone: "failed" } },
  ];
  const navItem = (id: string) => nav.find((n) => n.id === id)!;

  const aside = (
    <nav aria-label="Sections des paramètres" className="pm-nav-box" data-testid="pm-nav">
      <span className="label">Sur cette page</span>
      <ol className="pm-nav">
        {nav.map((n) => (
          <li key={n.id}>
            <a href={`#${n.id}`}>
              <span>{n.label}</span>
              <Pill tone={n.state.tone}>{n.state.text}</Pill>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );

  return (
    <>
      <PageHead kicker="Espace" title="Paramètres">
        <p className="desc">Règles métier de l'espace. Chaque règle est écrite ici et appliquée telle quelle ; aucune valeur n'est cachée.</p>
      </PageHead>
      {!isAdmin && <p className="notice" data-testid="pm-readonly">Lecture seule : seul un administrateur de l'espace modifie ces règles.</p>}

      <ParamLayout aside={aside} testid="pm-layout">
        <section className="pm-group" aria-labelledby="pm-g-effectifs">
          <div className="dn-section-head">
            <h2 id="pm-g-effectifs" className="group-title">Effectifs et KPI RH</h2>
            <p className="desc">Règles lues par Collaborateurs et par KPI RH.</p>
          </div>

          <section className="panel pm-panel" data-testid="setting-headcount" id="effectif">
            <div className="pm-panel-head">
              <h3>Définition de l'effectif</h3>
              <Pill tone={navItem("effectif").state.tone}>{navItem("effectif").state.text}</Pill>
            </div>
            <p className="pm-lead">
              <strong>Effectif à une date</strong> = nombre de personnes ayant au moins un contrat en cours à cette date (début et fin inclus), parmi les natures
              de contrat ci-dessous. Une personne avec plusieurs contrats compte une fois. Les contrats des autres natures sont affichés à part.
            </p>
            <p className="desc pm-origin" data-testid="setting-headcount-origin">
              {natures.origin === "default"
                ? "Valeur par défaut validée le 21/10/2026 : CDI et CDD. Modifiable par un administrateur."
                : `Modifié le ${row ? dateTimeFmt.format(row) : "n.d."} par un administrateur.`}
            </p>
            <HeadcountForm slug={slug} choices={natureChoices()} selected={natures.codes} disabled={!isAdmin} />
          </section>

          <section className="panel pm-panel" data-testid="setting-payfit-history" id="payfit-historique">
            <div className="pm-panel-head">
              <h3>Historique PayFit</h3>
              <Pill tone={navItem("payfit-historique").state.tone}>{navItem("payfit-historique").state.text}</Pill>
            </div>
            <p className="pm-lead">
              PayFit ne renvoie plus les contrats archivés depuis plus de {PAYFIT_ARCHIVED_RETENTION_MONTHS ?? "n.d."} mois. Pour les mois antérieurs à la date de
              lecture moins {PAYFIT_ARCHIVED_RETENTION_MONTHS ?? "n.d."} mois, les chiffres calculés sur ce que l'API renvoie ne comptent pas ces salariés :
              les effectifs, l'ETP et les sorties peuvent être sous-estimés ; les entrées, le turnover et l'absentéisme peuvent être faussés dans un sens ou dans l'autre (un contrat qui fait suite à un contrat non renvoyé compte comme une entrée, et les dénominateurs sont réduits).
            </p>
            <p className="desc pm-origin" data-testid="setting-payfit-history-origin">
              {history.origin === "default"
                ? "Valeur par défaut validée le 22/10/2026 : brut. Modifiable par un administrateur."
                : `Modifié le ${historyAt ? dateTimeFmt.format(historyAt) : "n.d."} par un administrateur.`}
            </p>
            <PayfitHistoryForm slug={slug} mode={history.mode} disabled={!isAdmin} />
          </section>

          <section className="panel pm-panel" data-testid="setting-kpi" id="kpi">
            <div className="pm-panel-head">
              <h3>Définitions des KPI</h3>
              <Pill tone={navItem("kpi").state.tone}>{navItem("kpi").state.text}</Pill>
            </div>
            <p className="pm-lead">
              Règles appliquées par Studio RH › KPI RH. Elles sont recalculées à chaque affichage, sans reconstruire le référentiel. Les natures comptées
              sont celles de la définition de l'effectif ci-dessus.
            </p>
            <KpiForm
              slug={slug}
              values={kpi.values}
              origins={origins}
              natures={natureChoices().map((n) => ({ code: n.code, label: n.label }))}
              types={typeRows}
              readLabel={active ? `lecture du ${dateTimeFmt.format(active.startedAt)}` : null}
              statuses={[...ABSENCE_STATUSES].map((code) => ({ code, label: ABSENCE_STATUS_LABELS[code] ?? code }))}
              disabled={!isAdmin}
            />
          </section>
        </section>

        <section className="pm-group" aria-labelledby="pm-g-masse">
          <div className="dn-section-head">
            <h2 id="pm-g-masse" className="group-title">Masse salariale</h2>
            <p className="desc">Règle lue par Studio RH › Masse salariale.</p>
          </div>

          <section className="panel pm-panel" data-testid="setting-payroll" id="masse-salariale">
            <div className="pm-panel-head">
              <h3>Masse salariale : grille de comptes</h3>
              <Pill tone={navItem("masse-salariale").state.tone}>{navItem("masse-salariale").state.text}</Pill>
            </div>
            <p className="pm-lead">
              Studio RH › Masse salariale lit le journal comptable de paie renvoyé par PayFit. Chaque compte est classé dans la rubrique dont un préfixe est le
              plus long. Masse salariale chargée = rubriques « brut » + « cotisations patronales ». Les comptes 63 et 64 sans rubrique sont signalés « non classés ».
            </p>
            <p className="desc pm-origin" data-testid="setting-payroll-origin">
              {payroll.origin === "default"
                ? "Valeur par défaut validée le 22/10/2026 : 641 brut (dont primes 6413, gratifications de stage 64137, indemnités et avantages 6414/6417), cotisations 645 et taxes 63, provisions 6412/6485 et autres charges 646-648 hors masse."
                : `Modifié le ${payroll.updatedAt ? dateTimeFmt.format(payroll.updatedAt) : "n.d."} par un administrateur.`}
            </p>
            <PayrollGridForm slug={slug} rows={gridRubrics(payroll.grid)} disabled={!isAdmin} />
            <div className="pm-sub">
              <h4>Ventilation par service</h4>
              <p className="desc pm-origin" data-testid="setting-payroll-axis-origin">
                Service : {serviceAxis.origin === "setting" ? `axe « ${serviceAxis.axis ?? "aucun"} », modifié le ${serviceAxis.updatedAt ? dateTimeFmt.format(serviceAxis.updatedAt) : "n.d."}` : serviceAxis.origin === "single-axis" ? `axe « ${serviceAxis.axis} », seul axe analytique présent dans le journal (défaut)` : axes.length ? "aucun axe choisi" : "aucun code analytique dans le journal PayFit appliqué"}.
              </p>
              <ServiceAxisForm slug={slug} axes={axes} current={serviceAxis.axis} disabled={!isAdmin} />
            </div>
          </section>
        </section>

        <section className="pm-group" aria-labelledby="pm-g-projection">
          <div className="dn-section-head">
            <h2 id="pm-g-projection" className="group-title">Projection budgétaire</h2>
            <p className="desc">Conventions lues par Studio RH › Hypothèses budgétaires.</p>
          </div>

          <section className="panel pm-panel" data-testid="setting-projection" id="projection">
            <div className="pm-panel-head">
              <h3>Projection : conventions de calcul</h3>
              <Pill tone={navItem("projection").state.tone}>{navItem("projection").state.text}</Pill>
            </div>
            <p className="pm-lead">
              Studio RH › Hypothèses budgétaires projette chaque contrat mois par mois. La règle de prorata des entrées et sorties en cours de mois n'a pas de
              valeur par défaut : tant qu'elle n'est pas choisie, aucun scénario ne peut être créé. Elle est copiée dans chaque scénario à sa création ; la
              modifier ne change pas les scénarios existants.
            </p>
            <p className="desc pm-origin" data-testid="setting-projection-origin" data-missing={projection ? undefined : "true"}>
              {projection ? `Règle : ${PRORATA_LABELS[projection.conventions.prorata]} — modifiée le ${dateTimeFmt.format(projection.updatedAt)}.` : "Non renseignée : aucun scénario ne peut être créé."}
            </p>
            <ProrataForm slug={slug} current={projection?.conventions.prorata ?? null} labels={PRORATA_LABELS} disabled={!isAdmin} />
            <div className="pm-sub">
              <h4>Catégories de contrat</h4>
              <p className="desc pm-origin" data-testid="setting-category-origin">
                {categories.origin === "default" ? "Valeur proposée (nomenclature DSN : 01 CDI, 02 CDD, 29 convention de stage), modifiable. Aucun code n'est rattaché à « apprenti » : PayFit code certains apprentis en CDD, corrigez-les salarié par salarié dans le scénario." : "Modifié par un administrateur."} Un contrat dont la nature n'est dans aucune catégorie est « non classé ».
              </p>
              <CategoryNaturesForm slug={slug} natures={categories.natures} disabled={!isAdmin} />
            </div>
            <div className="pm-sub">
              <h4>Correction contrat par contrat</h4>
              <p className="desc">Pour les cas que la nature ne distingue pas (ex. une apprentie codée CDD). Utilisée par les KPI RH et par les scénarios créés ensuite.</p>
              <ContractCategoriesForm slug={slug} rows={contractRows} disabled={!isAdmin} />
            </div>
          </section>
        </section>
      </ParamLayout>
    </>
  );
}
