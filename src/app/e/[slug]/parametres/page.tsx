import "@/styles/donnees.css";
import { and, eq } from "drizzle-orm";
import { workspaceSetting } from "@/db/schema";
import { withWorkspace } from "@/db/workspace-scope";
import { dateTimeFmt } from "@/lib/connectors/labels";
import { ABSENCE_STATUSES } from "@/lib/connectors/payfit/client";
import { getKpiSettings, KPI_DEFAULT_STATUS, KPI_DEFAULTS_VALIDATED_ON, kpiOriginText, type KpiSettingKey } from "@/lib/rh-kpi-settings";
import { getHeadcountNatures, getPayfitHistoryMode, HEADCOUNT_NATURES_KEY, natureChoices, PAYFIT_HISTORY_KEY } from "@/lib/rh-settings";
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
import { getConventions } from "@/lib/budget/settings";
import type { Prorata } from "@/lib/budget/types";
import { ProrataForm } from "./ProrataForm";
import { CategoryNaturesForm } from "./CategoryNaturesForm";
import { categoryOfNature, getCategoryNatures, getContractCategories } from "@/lib/budget/categories";
import { ContractCategoriesForm } from "./ContractCategoriesForm";
import { loadCollabContext } from "@/lib/rh/view";
import { contractNatureLabel } from "@/lib/dsn/labels";
import { personLabel } from "@/lib/rh/view";
import { GlossaryLink } from "@/components/GlossaryLink";
import { DONNEES_TERMS } from "@/lib/glossary/donnees";
import { ParamLayout } from "@/components/ParamLayout";
import { absenceTypeLabel } from "@/lib/viz/kpi";
import { defaultsNote, PageHead, Pill, type OriginKind, type Tone } from "../donnees/ui";
import { NavDisclosure } from "./NavDisclosure";
import { CROISEE_KEYS, croiseeSettingReason, getCroiseeSettings, LIBELLE_MAX, SEUILS_MAX, settingValue, type CroiseeSettingKey } from "@/lib/croisee-settings";
import { CROISEE_TERMS } from "@/lib/glossary/croisee";
import { CroiseeForm, type CroiseeFormKey, type CroiseeOrigin } from "./CroiseeForm";
import { CONFIDENTIALITE_TERM, getConfidentialiteRead } from "@/lib/confidentialite";
import { ConfidentialiteForm, type ConfidentialiteOrigin } from "./ConfidentialiteForm";

export const dynamic = "force-dynamic";

// Libellés des trois règles de prorata : l'essentiel pour choisir ; le détail (jours fériés pris en compte) est au glossaire.
const PRORATA_CHOICES: Record<Prorata, string> = {
  calendaire: "Jours calendaires : jours payés ÷ jours du mois",
  ouvres: "Jours ouvrés : jours ouvrés payés ÷ jours ouvrés du mois",
  aucun: "Aucun prorata : un mois commencé ou terminé compte entier",
};
const PRORATA_NAMES: Record<Prorata, string> = { calendaire: "jours calendaires", ouvres: "jours ouvrés", aucun: "aucun prorata" };

export default async function ParametresPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { workspace } = await requireWorkspace(slug);
  const isAdmin = workspace.role === "admin";
  const [kpi, active] = await Promise.all([getKpiSettings(workspace.id), activePayFitSync(workspace.id)]);
  const readTypes = active ? await loadAbsenceTypes(workspace.id, active.id) : [];
  const typeRows = [...new Set([...readTypes.map((t) => t.type), ...kpi.values.absenceTypes])].sort().map((type) => {
    const t = readTypes.find((x) => x.type === type);
    return { type, label: absenceTypeLabel(type), count: t?.count ?? 0, inRead: Boolean(t) };
  });
  const origins = Object.fromEntries((Object.keys(kpi.origins) as KpiSettingKey[]).map((k) => [k, kpiOriginText(k, kpi.origins[k], (d) => dateTimeFmt.format(d))]));
  // Nature de l'origine de chaque règle : seule une règle qui n'est pas un défaut validé porte sa propre mention ; les défauts
  // validés sont dits une seule fois par carte.
  const kinds = Object.fromEntries(
    (Object.keys(kpi.origins) as KpiSettingKey[]).map((k) => [k, kpi.origins[k].origin === "default" ? KPI_DEFAULT_STATUS[k] : kpi.origins[k].origin === "setting" ? "setting" : "invalid"]),
  ) as Record<KpiSettingKey, OriginKind>;
  const cardNote = (keys: KpiSettingKey[]) => defaultsNote(keys.map((k) => kinds[k]), KPI_DEFAULTS_VALIDATED_ON);
  const notes = {
    etp: cardNote(["fullTimeIsOne", "capAtOne", "forfaitJoursIsOne", "etpDecimals"]),
    turnover: cardNote(["turnoverFormula", "neutralizeContinuity", "excludedExitNatures"]),
    absence: cardNote(["absenceTypes", "absenceStatuses", "dayBasis"]),
  };
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
  // Confidentialité : un seul seuil pour toute l'application, sans valeur par défaut ; défini (avec sa date), illisible, ou non
  // défini ; « legacy » quand il est encore lu par repli sur l'ancien réglage de la croisée.
  const conf = await getConfidentialiteRead(workspace.id);
  const confOrigin: ConfidentialiteOrigin =
    conf.setting.kind === "set"
      ? { kind: "set", at: conf.setting.updatedAt ? dateTimeFmt.format(conf.setting.updatedAt) : null, legacy: conf.source === "croisee" }
      : conf.setting.kind === "invalid"
        ? { kind: "invalid", legacy: conf.source === "croisee" }
        : { kind: "absent" };
  // Masse salariale croisée : trois réglages sans valeur par défaut (le seuil de confidentialité a sa section) ; défini (avec sa
  // date), illisible, ou non défini (rien d'enregistré, ou liste de seuils vide).
  const croisee = await getCroiseeSettings(workspace.id);
  const croiseeFormKeys = (Object.keys(CROISEE_KEYS) as CroiseeSettingKey[]).filter((k): k is CroiseeFormKey => k !== "confidentialite");
  const croiseeOrigins = Object.fromEntries(
    croiseeFormKeys.map((k): [CroiseeFormKey, CroiseeOrigin] => {
      const st = croisee[k];
      if (st.kind === "set" && croiseeSettingReason(k, st) === null) return [k, { kind: "set", at: st.updatedAt ? dateTimeFmt.format(st.updatedAt) : null }];
      return [k, st.kind === "invalid" ? { kind: "invalid" } : { kind: "absent" }];
    }),
  ) as Record<CroiseeFormKey, CroiseeOrigin>;
  const croiseeKinds = Object.values(croiseeOrigins).map((o) => o.kind);
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

  // Exceptions seulement : une règle par défaut ne porte aucune pastille ; une règle modifiée, illisible ou manquante la porte.
  type State = { text: string; tone: Tone } | null;
  const stateOf = (origin: "default" | "setting"): State => (origin === "default" ? null : { text: "Modifiée", tone: "preview" });
  const kpiOrigins = Object.values(kpi.origins).map((o) => o.origin);
  const nav: { id: string; label: string; state: State }[] = [
    { id: "effectif", label: "Définition de l'effectif", state: stateOf(natures.origin) },
    { id: "payfit-historique", label: "Historique PayFit", state: stateOf(history.origin) },
    { id: "kpi", label: "Définitions des KPI", state: kpi.invalid.length > 0 ? { text: "À corriger", tone: "failed" } : stateOf(kpiOrigins.includes("setting") ? "setting" : "default") },
    // Seuil absent ou illisible : toute répartition est n.d. ; repris de l'ancien réglage de la croisée : à confirmer ici.
    { id: "confidentialite", label: "Confidentialité", state: confOrigin.kind === "invalid" ? { text: "À corriger", tone: "failed" } : confOrigin.kind === "absent" ? { text: "À renseigner", tone: "failed" } : confOrigin.legacy ? { text: "À confirmer", tone: "preview" } : null },
    { id: "masse-salariale", label: "Masse salariale : grille de comptes", state: stateOf(payroll.origin) },
    { id: "croisee", label: "Masse salariale croisée", state: croiseeKinds.includes("invalid") ? { text: "À corriger", tone: "failed" } : croiseeKinds.includes("absent") ? { text: "À renseigner", tone: "preview" } : null },
    { id: "projection", label: "Projection : conventions de calcul", state: projection ? null : { text: "À renseigner", tone: "failed" } },
  ];
  const navItem = (id: string) => nav.find((n) => n.id === id)!;
  const stateTag = (id: string) => {
    const st = navItem(id).state;
    return st ? <Pill tone={st.tone}>{st.text}</Pill> : null;
  };

  const aside = (
    <nav aria-label="Sections des paramètres" className="pm-nav-box" data-testid="pm-nav">
      <NavDisclosure title="Sur cette page">
        <ol className="pm-nav">
          {nav.map((n) => (
            <li key={n.id}>
              <a href={`#${n.id}`}>
                <span>{n.label}</span>
                {n.state && <Pill tone={n.state.tone}>{n.state.text}</Pill>}
              </a>
            </li>
          ))}
        </ol>
      </NavDisclosure>
    </nav>
  );

  return (
    <>
      <PageHead kicker="Espace" title="Paramètres">
        <p className="desc">Règles métier de l'espace.<GlossaryLink slug={slug} term={DONNEES_TERMS.origine} /></p>
      </PageHead>
      {!isAdmin && <p className="notice" data-testid="pm-readonly">Lecture seule : réservé aux administrateurs.</p>}

      <ParamLayout aside={aside} testid="pm-layout">
        <section className="pm-group" aria-labelledby="pm-g-effectifs">
          <div className="dn-section-head">
            <h2 id="pm-g-effectifs" className="group-title">Effectifs et KPI RH</h2>
            <p className="desc">Règles lues par Collaborateurs et par KPI RH.</p>
          </div>

          <section className="panel pm-panel" data-testid="setting-headcount" id="effectif">
            <div className="pm-panel-head">
              <h3>Définition de l'effectif<GlossaryLink slug={slug} term={DONNEES_TERMS.effectif} /></h3>
              {stateTag("effectif")}
            </div>
            <p className="desc pm-origin" data-testid="setting-headcount-origin">
              {natures.origin === "default"
                ? "Valeur par défaut validée le 21/10/2026 : CDI et CDD."
                : `Modifié le ${row ? dateTimeFmt.format(row) : "n.d."} par un administrateur.`}
            </p>
            <HeadcountForm slug={slug} choices={natureChoices()} selected={natures.codes} disabled={!isAdmin} />
          </section>

          <section className="panel pm-panel" data-testid="setting-payfit-history" id="payfit-historique">
            <div className="pm-panel-head">
              <h3>Historique PayFit<GlossaryLink slug={slug} term={DONNEES_TERMS.historique} /></h3>
              {stateTag("payfit-historique")}
            </div>
            <p className="desc pm-origin" data-testid="setting-payfit-history-origin">
              {history.origin === "default"
                ? "Valeur par défaut validée le 22/10/2026 : brut."
                : `Modifié le ${historyAt ? dateTimeFmt.format(historyAt) : "n.d."} par un administrateur.`}
            </p>
            <PayfitHistoryForm slug={slug} mode={history.mode} disabled={!isAdmin} />
          </section>

          <section className="panel pm-panel" data-testid="setting-kpi" id="kpi">
            <div className="pm-panel-head">
              <h3>Définitions des KPI<GlossaryLink slug={slug} term={DONNEES_TERMS.kpi} /></h3>
              {stateTag("kpi")}
            </div>
            <KpiForm
              slug={slug}
              values={kpi.values}
              origins={origins}
              kinds={kinds}
              notes={notes}
              natures={natureChoices().map((n) => ({ code: n.code, label: n.label }))}
              types={typeRows}
              readLabel={active ? `lecture du ${dateTimeFmt.format(active.startedAt)}` : null}
              statuses={[...ABSENCE_STATUSES].map((code) => ({ code, label: ABSENCE_STATUS_LABELS[code] ?? code }))}
              disabled={!isAdmin}
              helps={{
                etp: <GlossaryLink slug={slug} term={DONNEES_TERMS.etp} />,
                turnover: <GlossaryLink slug={slug} term={DONNEES_TERMS.turnover} />,
                sortiesNonComptees: <GlossaryLink slug={slug} term={DONNEES_TERMS.sortiesNonComptees} />,
                absenceTypes: <GlossaryLink slug={slug} term={DONNEES_TERMS.absenceTypes} />,
                absenceStatuts: <GlossaryLink slug={slug} term={DONNEES_TERMS.absenceStatuts} />,
                absenceBase: <GlossaryLink slug={slug} term={DONNEES_TERMS.absenceBase} />,
              }}
            />
          </section>
        </section>

        <section className="pm-group" aria-labelledby="pm-g-confidentialite">
          <div className="dn-section-head">
            <h2 id="pm-g-confidentialite" className="group-title">Confidentialité</h2>
            <p className="desc">Règle lue par toutes les répartitions du Studio RH et par leurs exports.</p>
          </div>

          <section className="panel pm-panel" data-testid="setting-confidentialite" id="confidentialite">
            <div className="pm-panel-head">
              <h3>Seuil de confidentialité<GlossaryLink slug={slug} term={CONFIDENTIALITE_TERM} /></h3>
              {stateTag("confidentialite")}
            </div>
            <ConfidentialiteForm slug={slug} value={conf.setting.kind === "set" ? conf.setting.value : null} origin={confOrigin} disabled={!isAdmin} />
          </section>
        </section>

        <section className="pm-group" aria-labelledby="pm-g-masse">
          <div className="dn-section-head">
            <h2 id="pm-g-masse" className="group-title">Masse salariale</h2>
            <p className="desc">Règle lue par Studio RH › Masse salariale.</p>
          </div>

          <section className="panel pm-panel" data-testid="setting-payroll" id="masse-salariale">
            <div className="pm-panel-head">
              <h3>Masse salariale : grille de comptes<GlossaryLink slug={slug} term={DONNEES_TERMS.grille} /></h3>
              {stateTag("masse-salariale")}
            </div>
            <p className="desc pm-origin" data-testid="setting-payroll-origin">
              {payroll.origin === "default"
                ? "Valeur par défaut validée le 22/10/2026."
                : `Modifié le ${payroll.updatedAt ? dateTimeFmt.format(payroll.updatedAt) : "n.d."} par un administrateur.`}
            </p>
            <PayrollGridForm slug={slug} rows={gridRubrics(payroll.grid)} disabled={!isAdmin} />
            <div className="pm-sub">
              <h4>Ventilation par service<GlossaryLink slug={slug} term={DONNEES_TERMS.axeService} /></h4>
              <p className="desc pm-origin" data-testid="setting-payroll-axis-origin">
                Service : {serviceAxis.origin === "setting" ? `axe « ${serviceAxis.axis ?? "aucun"} », modifié le ${serviceAxis.updatedAt ? dateTimeFmt.format(serviceAxis.updatedAt) : "n.d."}` : serviceAxis.origin === "single-axis" ? `axe « ${serviceAxis.axis} », seul axe analytique présent dans le journal (défaut)` : axes.length ? "aucun axe choisi" : "aucun code analytique dans le journal PayFit appliqué"}.
              </p>
              <ServiceAxisForm slug={slug} axes={axes} current={serviceAxis.axis} disabled={!isAdmin} />
            </div>
          </section>

          <section className="panel pm-panel" data-testid="setting-croisee" id="croisee">
            <div className="pm-panel-head">
              <h3>Masse salariale croisée<GlossaryLink slug={slug} term={CROISEE_TERMS.vueEnsemble} /></h3>
              {stateTag("croisee")}
            </div>
            <CroiseeForm
              slug={slug}
              values={{
                seuilsEffectif: settingValue(croisee.seuilsEffectif) ?? [],
                margeAlerte: settingValue(croisee.margeAlerte),
                horizonEcheances: settingValue(croisee.horizonEcheances),
              }}
              origins={croiseeOrigins}
              limits={{ seuilsMax: SEUILS_MAX, libelleMax: LIBELLE_MAX }}
              disabled={!isAdmin}
              helps={{
                confidentialite: <GlossaryLink slug={slug} term={CROISEE_TERMS.confidentialite} />,
                seuilsEffectif: <GlossaryLink slug={slug} term={CROISEE_TERMS.seuilsEffectif} />,
                horizonEcheances: <GlossaryLink slug={slug} term={CROISEE_TERMS.echeancesContrat} />,
              }}
            />
          </section>
        </section>

        <section className="pm-group" aria-labelledby="pm-g-projection">
          <div className="dn-section-head">
            <h2 id="pm-g-projection" className="group-title">Projection budgétaire</h2>
            <p className="desc">Conventions lues par Studio RH › Hypothèses budgétaires.</p>
          </div>

          <section className="panel pm-panel" data-testid="setting-projection" id="projection">
            <div className="pm-panel-head">
              <h3>Projection : conventions de calcul<GlossaryLink slug={slug} term={DONNEES_TERMS.prorata} /></h3>
              {stateTag("projection")}
            </div>
            <p className="desc pm-origin" data-testid="setting-projection-origin" data-missing={projection ? undefined : "true"}>
              {projection ? `Règle : ${PRORATA_NAMES[projection.conventions.prorata]} — modifiée le ${dateTimeFmt.format(projection.updatedAt)}.` : "Non renseignée : aucun scénario ne peut être créé."}
            </p>
            <ProrataForm slug={slug} current={projection?.conventions.prorata ?? null} labels={PRORATA_CHOICES} disabled={!isAdmin} />
            <div className="pm-sub">
              <h4>Catégories de contrat<GlossaryLink slug={slug} term={DONNEES_TERMS.categories} /></h4>
              <p className="desc pm-origin" data-testid="setting-category-origin">
                {categories.origin === "default" ? "Valeur proposée (nomenclature DSN)." : "Modifié par un administrateur."}
              </p>
              {categories.natures.apprenti.length === 0 && <p className="desc">Aucun code n'est rattaché à « apprenti » : à corriger contrat par contrat.</p>}
              <CategoryNaturesForm slug={slug} natures={categories.natures} disabled={!isAdmin} />
            </div>
            <div className="pm-sub">
              <h4>Correction contrat par contrat<GlossaryLink slug={slug} term={DONNEES_TERMS.categories} /></h4>
              <ContractCategoriesForm slug={slug} rows={contractRows} disabled={!isAdmin} />
            </div>
          </section>
        </section>
      </ParamLayout>
    </>
  );
}
