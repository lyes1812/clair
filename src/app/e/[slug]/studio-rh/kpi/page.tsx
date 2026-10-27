import "@/styles/kpi.css";
import { isMonth } from "@/lib/connectors/months";
import { dateTimeFmt } from "@/lib/connectors/labels";
import { formatDate } from "@/lib/dates";
import { contractNatureLabel } from "@/lib/dsn/labels";
import { KPI_TERMS } from "@/lib/glossary/kpi";
import { KPI_KEYS, kpiOriginText, type KpiSettingKey, type KpiSettings } from "@/lib/rh-kpi-settings";
import { monthRanges, natureOfMonth } from "@/lib/rh/headcount";
import { absenceByMotif } from "@/lib/rh/kpi/absence-motifs";
import { KPI_DETAIL_IDS, kpiDetail } from "@/lib/rh/kpi/dashboard";
import { ETP_PRORATED_LABEL, etpProratedQualifier } from "@/lib/rh/kpi/etp-prorata";
import { fmtDelta, fmtEtp4, fmtHalfDays, fmtPercent } from "@/lib/rh/kpi/format";
import { previousWindow } from "@/lib/rh/kpi/period";
import type { Compared, KpiDetailId, Ratio } from "@/lib/rh/kpi/types";
import { ABSENCE_STATUS_LABELS } from "@/lib/rh/labels";
import type { Shown } from "@/lib/rh/view";
import { absenceTypeText, absenteeismSeries, deltaExact, etpProratedNotes, etpSeries, headcountSeries, motifsRetenusLine } from "@/lib/viz/kpi";
import {
  AbsenceMonthDetail,
  AbsenceTypeNotes,
  AbsenceTypes,
  AbsenteeismWindowDetail,
  absenceDaysShown,
  absenteeismShown,
  AverageDetail,
  averageShown,
  Cell,
  EtpEndDetail,
  EtpProratedDetail,
  etpProratedShown,
  etpShown,
  etpTitle,
  HeadcountDetail,
  KpiCategoryChart,
  KpiCharts,
  KpiHeader,
  KpiParams,
  KpiTile,
  type Maps,
  monthLabel,
  MovementsDetail,
  natureList,
  NdReasons,
  PanelTitle,
  PayfitNotice,
  ratioTitle,
  show,
  showCount,
  showHeadcount,
  theoreticalShown,
  TurnoverDetail,
  turnoverShown,
} from "./components";
import { ExportMenu } from "@/components/ExportMenu";
import { FamilyTabs } from "@/components/FamilyTabs";
import { GlossaryLink } from "@/components/GlossaryLink";
import { Prevu, type PrevuLink } from "@/components/Prevu";
import { EffectifsMensuels } from "./EffectifsMensuels";
import { PeriodModeFields } from "./PeriodModeFields";
import { CATEGORY_TABLE_LABELS, categoryScopeNote, coverageShown, loadCategoryMonths, loadKpiSuivi, suiviColumnOn } from "./suivi-data";
import { KPI_VUES } from "./tabs";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const DETAIL_TITLES: Record<KpiDetailId, string> = {
  "etp-end": "ETP contractuel fin de mois",
  "etp-prorated": ETP_PRORATED_LABEL,
  headcount: "Effectif fin de mois (personnes)",
  entries: "Entrées du mois",
  exits: "Sorties du mois",
  theoretical: "Jours théoriques du mois",
  absenteeism: "Absentéisme",
  "etp-avg": "ETP moyen",
  "headcount-avg": "Effectif moyen (personnes)",
  turnover: "Turnover",
};

// Paramètres en vigueur, en clair, avec leur origine (défaut validé, défaut proposé, modification datée).
function paramList(settings: KpiSettings, natures: { codes: string[]; origin: string }) {
  const v = settings.values;
  const yes = (b: boolean) => (b ? "oui" : "non");
  const items: [KpiSettingKey, string, string][] = [
    ["fullTimeIsOne", "Un temps plein vaut 1 ETP", yes(v.fullTimeIsOne)],
    ["capAtOne", "Quotité plafonnée à 1", yes(v.capAtOne)],
    ["forfaitJoursIsOne", "Forfait jours sans quotité PayFit = 1 ETP", yes(v.forfaitJoursIsOne)],
    ["etpDecimals", "Décimales de la quotité avant la somme", String(v.etpDecimals)],
    ["turnoverFormula", "Formule du turnover", v.turnoverFormula === "half_sum" ? "moyenne des entrées et des sorties ÷ effectif moyen" : "sorties ÷ effectif du premier jour"],
    ["neutralizeContinuity", "Contrats continus neutralisés", yes(v.neutralizeContinuity)],
    ["excludedExitNatures", "Sorties non comptées (natures)", v.excludedExitNatures.length ? natureList(v.excludedExitNatures) : "aucune"],
    ["absenceTypes", "Motifs retenus pour l'absentéisme", v.absenceTypes.length ? v.absenceTypes.map(absenceTypeText).join(", ") : "aucun (absentéisme n.d.)"],
    ["absenceStatuses", "Statuts d'absence retenus", v.absenceStatuses.map((s) => ABSENCE_STATUS_LABELS[s] ?? s).join(", ")],
    ["dayBasis", "Base des jours (absentéisme et ETP proratisé)", v.dayBasis === "calendar" ? "jours calendaires" : "du lundi au vendredi"],
  ];
  return [
    { label: "Natures comptées dans l'effectif", value: natureList(natures.codes), origin: natures.origin === "default" ? "valeur par défaut validée" : "modifié par un administrateur", testId: "natures" },
    ...items.map(([k, label, value]) => ({ label, value, origin: kpiOriginText(k, settings.origins[k], (d) => dateTimeFmt.format(d)).replace(/\.$/, ""), testId: k })),
  ];
}

// Entrées de KPI RH pas encore construites : l'état en une phrase, ce qui existe déjà (avec un lien) et ce qui reste à préciser.
type PrevuVue = "pyramide" | "salaires" | "livre" | "publisher";
const PREVU_VUES: PrevuVue[] = ["pyramide", "salaires", "livre", "publisher"];
const PREVU: Record<PrevuVue, (studio: string) => { lead: string; existing: PrevuLink[]; open: string[] }> = {
  pyramide: (studio) => ({
    lead: "Non disponible avec les données lues : la date de naissance n'est pas lue dans le référentiel Collaborateurs (PayFit et DSN lus), la pyramide des âges ne peut donc pas être construite. L'ancienneté se déduit de la date d'entrée du contrat.",
    existing: [
      { href: `${studio}/collaborateurs/fiche`, title: "Collaborateurs › Fiche collaborateur", text: "Contrats, dates d'entrée et de sortie de chaque collaborateur." },
      { href: `${studio}/kpi?vue=effectifs`, title: "KPI RH › Effectifs mensuels", text: "Effectif et ETP par mois, répartis par catégorie, contrat, établissement ou statut." },
    ],
    open: ["Le découpage des tranches d'âge et d'ancienneté.", "La règle d'ancienneté : par contrat ou par personne.", "La source de la date de naissance, absente des lectures PayFit et DSN."],
  }),
  salaires: (studio) => ({
    lead: "Non réalisé : l'analyse des salaires par collaborateur (médianes, écarts, rapports) n'existe pas encore.",
    existing: [
      { href: `${studio}/masse-salariale?vue=fixe-variable`, title: "Masse salariale › Fixe & variable", text: "Rémunération lue par rubrique : salaires, primes, indemnités, gratifications." },
      { href: `${studio}/masse-salariale`, title: "Masse salariale › Synthèse", text: "Brut, charges et coût chargé par mois, par service et par rubrique." },
    ],
    open: ["Les règles d'anonymat et de droits d'accès pour des indicateurs individuels.", "Les statistiques à produire (médiane, écarts, rapports) et leur périmètre."],
  }),
  livre: (studio) => ({
    lead: "Non disponible avec les données lues : l'API PayFit ne renvoie les bulletins qu'en PDF, sans rubrique, le livre de paie par collaborateur et par rubrique de bulletin ne peut donc pas être construit.",
    existing: [
      { href: `${studio}/masse-salariale?vue=paie-compta`, title: "Masse salariale › Paie & comptabilité", text: "Journal comptable de paie par compte, congés payés dus, rapprochement avec la comptabilité." },
      { href: `${studio}/masse-salariale?vue=fixe-variable`, title: "Masse salariale › Fixe & variable", text: "Brut par libellé de paie, primes par famille et par mois." },
    ],
    open: ["Une source qui fournit les rubriques de bulletin reste à identifier."],
  }),
  publisher: (studio) => ({
    lead: "Non réalisé : le contenu de cette entrée n'est pas encore défini.",
    existing: [
      { href: `${studio}/kpi`, title: "KPI RH › Suivi des effectifs", text: "Indicateurs, tableaux mensuels et détail de chaque chiffre, consultables à l'écran." },
      { href: `${studio}/kpi?vue=effectifs`, title: "KPI RH › Effectifs mensuels", text: "Une rubrique, un axe de répartition, une version et une année." },
    ],
    open: ["Ce que cette entrée doit produire, son format, ses destinataires et sa périodicité."],
  }),
};

export default async function KpiPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Search> }) {
  const { slug } = await params;
  const sp = await searchParams;
  // Chargement commun avec l'export (mêmes paramètres d'adresse, mêmes règles de remplacement d'une valeur invalide).
  const suivi = await loadKpiSuivi(slug, sp);
  const ctx = suivi.ctx;
  if (suivi.kind === "no-input") return <KpiHeader ctx={ctx} closedMonth={null} />;

  if (suivi.kind === "settings-invalid") {
    return (
      <KpiHeader ctx={ctx} closedMonth={suivi.last}>
        <section className="placeholder" data-testid="kpi-settings-invalid">
          <h3>n.d. — paramètres des KPI illisibles</h3>
          <p className="muted">
            Valeur enregistrée illisible pour : {ctx.settings.invalid.map((k) => KPI_KEYS[k]).join(", ")}. Aucun KPI n'est calculé avec une valeur remplacée en silence. Un administrateur doit
            ré-enregistrer <a href={`/e/${slug}/parametres#kpi`}>Paramètres › Définitions des KPI</a>.
          </p>
        </section>
      </KpiHeader>
    );
  }
  if (suivi.kind === "no-closed-month") {
    return (
      <KpiHeader ctx={ctx} closedMonth={null}>
        <section className="placeholder" data-testid="kpi-no-closed-month">
          <h3>n.d. — aucun mois clos à la date de référence</h3>
          <p className="muted">
            Date de référence : {formatDate(suivi.data.build.referenceDate)}.
            <GlossaryLink slug={slug} term={KPI_TERMS.closedPeriod} />
          </p>
        </section>
      </KpiHeader>
    );
  }

  // Paramètres GET : une valeur invalide est remplacée par le défaut, et l'écran le dit.
  const { data, rawLimit, closed, last, years, vue, mode, fin, year, etab, nature, w, input, dash, notices } = suivi;
  const ignore = (k: string, v: string, why: string) => notices.push(`paramètre ignoré : ${k}=${v} (${why})`);

  // detail et mois : un détail de mois exige un mois valide de la fenêtre ou de son N-1 ; un détail de période n'en prend pas ;
  // l'absentéisme accepte les deux. Tout paramètre écarté est signalé avec sa raison.
  const rawDetail = one(sp.detail);
  const rawMois = one(sp.mois);
  const detailId = (KPI_DETAIL_IDS as string[]).includes(rawDetail) ? (rawDetail as KpiDetailId) : null;
  if (rawDetail && !detailId) ignore("detail", rawDetail, "détail inconnu");
  const moisOk = isMonth(rawMois);
  if (rawMois && !moisOk) ignore("mois", rawMois, "format AAAA-MM attendu");
  // periode=n1 : le détail porte sur la période N-1 (retrace les valeurs N-1 des tuiles et de la ligne « Période »).
  const rawPeriode = one(sp.periode);
  const onPrevious = rawPeriode === "n1";
  if (rawPeriode && !onPrevious) ignore("periode", rawPeriode, "valeur possible : n1");
  const detailWindow = onPrevious ? previousWindow(w) : w;
  const windowDetail = detailId === "etp-avg" || detailId === "headcount-avg" || detailId === "turnover";
  const monthDetail = detailId !== null && !windowDetail && detailId !== "absenteeism";
  let detail: ReturnType<typeof kpiDetail> = null;
  if (detailId && monthDetail && !moisOk) {
    ignore("detail", rawDetail, rawMois ? "mois invalide : détail non affiché" : "mois requis pour ce détail");
  } else if (detailId) {
    if (windowDetail && moisOk) ignore("mois", rawMois, "sans objet pour un détail de période");
    detail = kpiDetail(input, detailWindow, detailId, moisOk && !windowDetail ? rawMois : null);
    if (!detail) {
      ignore("mois", rawMois, "hors de la période affichée et de son N-1");
      // L'absentéisme a un défaut sans mois (la période) ; un détail de mois n'en a pas et n'est pas affiché.
      if (detailId === "absenteeism") detail = kpiDetail(input, detailWindow, detailId, null);
      else ignore("detail", rawDetail, "mois hors période : détail non affiché");
    }
  } else if (moisOk) ignore("mois", rawMois, "aucun détail demandé");

  const query = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    if (vue !== "suivi") p.set("vue", vue);
    if (mode === "civil") {
      p.set("mode", "civil");
      p.set("annee", String(year));
    } else p.set("fin", fin);
    if (etab) p.set("etab", etab);
    if (nature) p.set("nature", nature);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `?${p.toString()}`;
  };
  const detailHref = (id: string, month: string | null, previous = false) => `${query({ detail: id, ...(month ? { mois: month } : {}), ...(previous ? { periode: "n1" } : {}) })}#kpi-detail`;

  // Nature retenue pour un contrat un mois donné (DSN : déclarée ce mois-là ; PayFit : celle du contrat).
  const natureAt = (key: string, month: string): string | null => {
    const c = data.contracts.find((x) => x.contractKey === key);
    if (!c) return null;
    const m = data.months.find((x) => x.contractKey === key && x.month === month && x.presenceBasis === "declared" && (!etab || x.establishmentId === etab));
    return m ? natureOfMonth(c, m) : c.nature;
  };
  // Liens internes d'un détail : un détail de période N-1 renvoie aux détails de période N-1 ; les mois gardent leur date.
  const inDetail = (id: string, month: string | null) => detailHref(id, month, onPrevious && month === null);
  const maps: Maps = { persons: new Map(data.persons.map((p) => [p.personKey, p])), contracts: new Map(data.contracts.map((c) => [c.contractKey, c])) };
  const s = ctx.settings.values;

  const t = dash.tiles;
  const sparkEtp = etpSeries(dash.rows);
  const sparkHeadcount = headcountSeries(dash.rows)[0].values;
  const sparkAbsenteeism = absenteeismSeries(dash.rows)[0].values;
  // N-1 d'une tuile : la valeur seule ; la période N-1 est dans la ligne de contexte et au survol.
  const n1 = (shown: Shown) => shown.text;
  // Écart exact en fractions (valeur − N-1 ; × 100 pour les taux), au survol de la ligne « Écart » : rien de visible sur la tuile,
  // mais l'écart affiché se retrace sans arrondi.
  const deltaTitle = <T,>(c: Compared<T>, value: (x: T) => Ratio | null, points = false): string | undefined => {
    if (c.delta.kind !== "exact") return undefined;
    const a = value(c.current);
    const b = value(c.previous);
    return a && b ? deltaExact(a, b, c.delta.value, points) : undefined;
  };
  const pw = dash.previousWindow;
  const lowerMonths = new Set(data.coverage.filter((c) => c.presenceStatus === "lower_bound").map((c) => c.month));

  // Avis de couverture des mois non complets de la période, regroupés par raison.
  const covNotices = new Map<string, string[]>();
  for (const m of w.months) {
    const c = coverageShown(data, m, input.scope.establishments, rawLimit);
    if (c.kind === "value") continue;
    const key = c.kind === "lower" ? `borne basse — ${c.foot ?? "contrats archivés inconnus"}` : c.text;
    covNotices.set(key, [...(covNotices.get(key) ?? []), m]);
  }

  const chosenTypes = dash.absenceTypes.filter((x) => x.chosen);
  const otherTypes = dash.absenceTypes.filter((x) => !x.chosen);
  const missingTypes = chosenTypes.filter((x) => !x.inRead);

  // Cellules du tableau, gardées pour la liste des raisons « n.d. ».
  const rows = dash.rows.map((r) => ({
    r,
    cells: {
      coverage: coverageShown(data, r.month, input.scope.establishments, rawLimit),
      headcount: showHeadcount(r.headcount, "persons"),
      etp: etpShown(r.etp),
      etpProrated: etpProratedShown(r.etpProrated),
      entries: showCount(r.movements.entries),
      exits: showCount(r.movements.exits),
      theoretical: theoreticalShown(r.theoretical),
      absenceDays: absenceDaysShown(r.absenteeism),
      absenteeism: absenteeismShown(r.absenteeism),
      etpN1: etpShown(r.previous.etp),
      absenteeismN1: absenteeismShown(r.previous.absenteeism),
    },
  }));
  // Les colonnes N-1 portent sur le même mois un an plus tôt : leurs raisons sont datées de ce mois-là.
  const ndItems = rows.flatMap(({ r, cells }) =>
    Object.entries(cells).map(([col, shown]) => ({ month: col === "etpN1" || col === "absenteeismN1" ? r.previous.month : r.month, shown })),
  );
  const toCur = t.turnover.current;
  const absCur = t.absenteeism.current;
  const prCur = t.etpProrated.current;

  // Tableau par catégorie (Suivi) : même entrée filtrée que les tuiles (établissement, nature) ; la mention sous le tableau nomme
  // le périmètre et les catégories hors de ce périmètre (sans colonne, jamais un zéro).
  const cat = vue === "suivi" ? await loadCategoryMonths(input, w, ctx.collab.workspace.id) : null;
  const catScope = cat ? categoryScopeNote(suivi, cat.hidden) : null;
  const tileOn = (id: string) => vue === "suivi" || (vue === "turnover" ? id === "turnover" || id === "headcount-avg" : id === "absenteeism");
  const colOn = (c: string) => suiviColumnOn(vue, c);
  // Page « Prévu » : aucun chiffre, donc ni limites de la lecture ni paramètres en vigueur à rappeler.
  const prevu = (PREVU_VUES as string[]).includes(vue);
  return (
    <KpiHeader ctx={ctx} closedMonth={last} bare={prevu}>
      {!prevu && <PayfitNotice ctx={ctx} />}
      <FamilyTabs label="Entrées KPI RH" testid="kpi-tabs" current={vue} tabs={KPI_VUES.map((v) => ({ key: v.key, label: v.label, href: v.key === "suivi" ? "?" : `?vue=${v.key}`, soon: "soon" in v ? v.soon : false }))} />
      {prevu ? (
        <Prevu title={KPI_VUES.find((x) => x.key === vue)!.label} {...PREVU[vue as PrevuVue](`/e/${slug}/studio-rh`)} />
      ) : vue === "effectifs" ? (
        <EffectifsMensuels slug={slug} workspaceId={ctx.collab.workspace.id} kpi={ctx.input} search={{ mesure: one(sp.mesure), axe: one(sp.axe), version: one(sp.version), annee: one(sp.annee) }} />
      ) : (
      <>
      {notices.map((n) => (
        <p key={n} className="notice" data-testid="kpi-param-notice">{n}</p>
      ))}

      <form method="get" className="filters bar kpi-bar" data-testid="kpi-filters" aria-label="Période et périmètre des indicateurs">
        {vue !== "suivi" && <input type="hidden" name="vue" value={vue} />}
        <PeriodModeFields
          key={`${mode}:${fin}:${year}`}
          initialMode={mode}
          initialEnd={fin}
          initialYear={String(year)}
          ends={[...closed].reverse().map((month) => ({ value: month, label: `${month}${lowerMonths.has(month) ? " — borne basse" : ""}` }))}
          years={[...years].reverse().map((entry) => ({ value: String(entry.year), label: `${entry.year}${entry.closed ? "" : " — non close"}` }))}
        />
        {ctx.collab.establishments.length > 1 && (
          <div className="field-row">
            <label htmlFor="etab">Établissement</label>
            <select className="select" id="etab" name="etab" defaultValue={etab}>
              <option value="">Tous</option>
              {ctx.collab.establishments.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
            </select>
          </div>
        )}
        <div className="field-row">
          <label htmlFor="nature">Nature</label>
          <select className="select" id="nature" name="nature" defaultValue={nature}>
            <option value="">Natures comptées</option>
            {ctx.collab.natures.codes.map((n) => <option key={n} value={n}>{contractNatureLabel(n)}</option>)}
          </select>
        </div>
        <button className="btn primary" type="submit">Afficher</button>
      </form>

      <p className="desc kpi-period" data-testid="kpi-period">
        <strong>{w.label}</strong> · N-1 : {pw.label} · date de référence {formatDate(data.build.referenceDate)}
        {etab ? ` · établissement ${etab}` : ""}
        {nature ? ` · nature ${contractNatureLabel(nature)}` : ""}
        <GlossaryLink slug={slug} term={KPI_TERMS.closedPeriod} />
      </p>
      {[...covNotices].map(([reason, months]) => (
        <p key={reason} className="notice" data-testid="coverage-notice">{monthRanges(months)} : {reason}</p>
      ))}

      <section className="panel">
        <PanelTitle slug={slug} term={KPI_TERMS.previousPeriod} label="Comparaison N-1 et écart">Indicateurs</PanelTitle>
        <dl className="facts kpi-tiles" data-testid="kpi-tiles">
          <KpiTile
            id="etp-end"
            sparkline={sparkEtp.find((s) => s.key === "etp")?.values}
            slug={slug}
            visible={tileOn("etp-end")}
            label={`ETP contractuel fin ${monthLabel(w.to)}`}
            shown={etpShown(t.etpEnd.current)}
            title={etpTitle(t.etpEnd.current)}
            n1={n1(etpShown(t.etpEnd.previous))}
            n1Title={t.etpEnd.previousWindow.label}
            delta={fmtDelta(t.etpEnd.delta)}
            deltaTitle={deltaTitle(t.etpEnd, (e) => (e.kind === "nd" ? null : { num: e.etp4, den: 10000 }))}
            qualifiers={t.etpEnd.current.kind === "nd" ? [] : t.etpEnd.current.qualifiers}
            term={KPI_TERMS.etpMonthEnd}
            detail={detailHref("etp-end", w.to)}
            detailN1={detailHref("etp-end", dash.previousWindow.to)}
          />
          <KpiTile
            id="etp-prorated"
            sparkline={sparkEtp.find((s) => s.key === "etp-prorated")?.values}
            slug={slug}
            visible={tileOn("etp-prorated")}
            label={ETP_PRORATED_LABEL}
            shown={etpProratedShown(prCur)}
            title={ratioTitle(prCur)}
            n1={n1(etpProratedShown(t.etpProrated.previous))}
            n1Title={t.etpProrated.previousWindow.label}
            delta={fmtDelta(t.etpProrated.delta)}
            deltaTitle={deltaTitle(t.etpProrated, (e) => (e.kind === "nd" ? null : e.ratio))}
            qualifiers={[`Mois : ${monthLabel(w.to)}`, ...etpProratedNotes(prCur.kind === "nd" ? [etpProratedQualifier(input)] : prCur.qualifiers)]}
            term={KPI_TERMS.etpProrated}
            detail={detailHref("etp-prorated", w.to)}
            detailN1={detailHref("etp-prorated", dash.previousWindow.to)}
          />
          <KpiTile
            id="etp-avg"
            sparkline={sparkEtp.find((s) => s.key === "etp")?.values}
            slug={slug}
            visible={tileOn("etp-avg")}
            label="ETP moyen"
            shown={averageShown(t.etpAverage.current)}
            title={ratioTitle(t.etpAverage.current)}
            n1={n1(averageShown(t.etpAverage.previous))}
            n1Title={t.etpAverage.previousWindow.label}
            delta={fmtDelta(t.etpAverage.delta)}
            deltaTitle={deltaTitle(t.etpAverage, (a) => (a.kind === "exact" ? a.ratio : null))}
            qualifiers={t.etpAverage.current.kind === "nd" ? [] : t.etpAverage.current.qualifiers}
            term={KPI_TERMS.etpAverage}
            detail={detailHref("etp-avg", null)}
            detailN1={detailHref("etp-avg", null, true)}
          />
          <KpiTile
            id="headcount-avg"
            sparkline={sparkHeadcount}
            slug={slug}
            visible={tileOn("headcount-avg")}
            label="Effectif moyen (personnes)"
            shown={averageShown(t.headcountAverage.current)}
            title={ratioTitle(t.headcountAverage.current)}
            n1={n1(averageShown(t.headcountAverage.previous))}
            n1Title={t.headcountAverage.previousWindow.label}
            delta={fmtDelta(t.headcountAverage.delta)}
            deltaTitle={deltaTitle(t.headcountAverage, (a) => (a.kind === "exact" ? a.ratio : null))}
            term={KPI_TERMS.headcountAverage}
            detail={detailHref("headcount-avg", null)}
            detailN1={detailHref("headcount-avg", null, true)}
          />
          <KpiTile
            id="turnover"
            slug={slug}
            visible={tileOn("turnover")}
            label="Turnover"
            shown={turnoverShown(toCur)}
            title={ratioTitle(toCur)}
            n1={n1(turnoverShown(t.turnover.previous))}
            n1Title={t.turnover.previousWindow.label}
            delta={fmtDelta(t.turnover.delta)}
            deltaTitle={deltaTitle(t.turnover, (x) => (x.kind === "exact" ? x.ratio : null), true)}
            qualifiers={toCur.kind === "exact" ? toCur.qualifiers : []}
            term={KPI_TERMS.turnover}
            detail={detailHref("turnover", null)}
            detailN1={detailHref("turnover", null, true)}
          />
          <KpiTile
            id="absenteeism"
            sparkline={sparkAbsenteeism}
            slug={slug}
            visible={tileOn("absenteeism")}
            label="Absentéisme"
            shown={absenteeismShown(absCur)}
            title={ratioTitle(absCur)}
            n1={n1(absenteeismShown(t.absenteeism.previous))}
            n1Title={t.absenteeism.previousWindow.label}
            delta={fmtDelta(t.absenteeism.delta)}
            deltaTitle={deltaTitle(t.absenteeism, (x) => (x.kind === "nd" ? null : x.ratio), true)}
            qualifiers={[motifsRetenusLine(dash.params.absenceTypes), ...(absCur.kind === "nd" ? [] : absCur.qualifiers)]}
            warning={
              input.absences.status === "read" && missingTypes.length > 0 ? (
                <span className="tile-foot" data-testid="kpi-absence-missing">
                  {missingTypes.length > 1 ? "Aucune absence des motifs " : "Aucune absence du motif "}
                  <AbsenceTypes codes={missingTypes.map((x) => x.type)} />
                  {" dans la lecture PayFit."}
                </span>
              ) : undefined
            }
            term={KPI_TERMS.absenteeism}
            detail={detailHref("absenteeism", null)}
            detailN1={detailHref("absenteeism", null, true)}
          >
            {input.absences.status === "read" && <AbsenceTypeNotes chosen={chosenTypes} other={otherTypes} missing={missingTypes} slug={slug} />}
          </KpiTile>
        </dl>
      </section>

      <KpiCharts slug={slug} vue={vue === "turnover" ? "turnover" : vue === "absenteisme" ? "absenteisme" : "suivi"} rows={dash.rows} turnover={t.turnover} absenteeism={t.absenteeism} />

      <section className="panel">
        <div className="panel-head">
          <PanelTitle slug={slug} term={KPI_TERMS.monthly} label="Tableau mois par mois et ligne Période">Mois par mois</PanelTitle>
          <ExportMenu testid="kpi-export" options={[{ label: "Excel (.xlsx)", href: `/e/${slug}/studio-rh/kpi/export${query({ format: "xlsx" })}`, testid: "kpi-export-xlsx" }]} />
        </div>
        <p className="kpi-scroll-hint" data-testid="kpi-scroll-hint">Tableau défilant : faire glisser vers la droite.</p>
        <div className="table-wrap scroll">
          <table className="data-table kpi-table sticky sticky-first" data-testid="kpi-monthly-table">
            <thead>
              <tr>
                <th>Mois</th>
                {colOn("coverage") && <th>Couverture</th>}
                {colOn("headcount") && <th className="num wrap">Effectif fin de mois</th>}
                {colOn("etp") && <th className="num wrap">ETP fin de mois</th>}
                {colOn("etp-prorated") && <th className="num wrap">ETP proratisé — quotité actuelle</th>}
                {colOn("entries") && <th className="num">Entrées</th>}
                {colOn("exits") && <th className="num">Sorties</th>}
                {colOn("theoretical") && <th className="num wrap">Jours théoriques</th>}
                {colOn("absence-days") && <th className="num wrap">Jours d'absence</th>}
                {colOn("absenteeism") && <th className="num">Absentéisme</th>}
                {colOn("etp-n1") && <th className="num">ETP N-1</th>}
                {colOn("absenteeism-n1") && <th className="num wrap">Absentéisme N-1</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ r, cells: c }) => (
                <tr key={r.month} data-month={r.month}>
                  <td>{r.month}</td>
                  {colOn("coverage") && <Cell col="coverage" shown={c.coverage} href={null} />}
                  {colOn("headcount") && <Cell col="headcount" shown={c.headcount} href={detailHref("headcount", r.month)} />}
                  {colOn("etp") && <Cell col="etp" shown={c.etp} href={detailHref("etp-end", r.month)} />}
                  {colOn("etp-prorated") && <Cell col="etp-prorated" shown={c.etpProrated} href={detailHref("etp-prorated", r.month)} />}
                  {colOn("entries") && <Cell col="entries" shown={c.entries} href={detailHref("entries", r.month)} />}
                  {colOn("exits") && <Cell col="exits" shown={c.exits} href={detailHref("exits", r.month)} />}
                  {colOn("theoretical") && <Cell col="theoretical" shown={c.theoretical} href={detailHref("theoretical", r.month)} />}
                  {colOn("absence-days") && <Cell col="absence-days" shown={c.absenceDays} href={detailHref("absenteeism", r.month)} />}
                  {colOn("absenteeism") && <Cell col="absenteeism" shown={c.absenteeism} href={detailHref("absenteeism", r.month)} />}
                  {colOn("etp-n1") && <Cell col="etp-n1" shown={c.etpN1} href={detailHref("etp-end", r.previous.month)} />}
                  {colOn("absenteeism-n1") && <Cell col="absenteeism-n1" shown={c.absenteeismN1} href={detailHref("absenteeism", r.previous.month)} />}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr data-testid="kpi-monthly-foot">
                <td>Période</td>
                {colOn("coverage") && <td />}
                {colOn("headcount") && <Cell col="headcount" shown={averageShown(t.headcountAverage.current)} href={detailHref("headcount-avg", null)} />}
                {colOn("etp") && <Cell col="etp" shown={averageShown(t.etpAverage.current)} href={detailHref("etp-avg", null)} />}
                {colOn("etp-prorated") && <td data-col="etp-prorated" />}
                {colOn("entries") && <Cell col="entries" shown={show(dash.movements.entries, (x) => String(x.value))} href={detailHref("turnover", null)} />}
                {colOn("exits") && <Cell col="exits" shown={show(dash.movements.exits, (x) => String(x.value))} href={detailHref("turnover", null)} />}
                {colOn("theoretical") && <Cell col="theoretical" shown={show(dash.theoretical, (x) => fmtHalfDays(x.half))} href={detailHref("absenteeism", null)} />}
                {colOn("absence-days") && <Cell col="absence-days" shown={show(absCur, (x) => fmtHalfDays(x.ratio.num))} href={detailHref("absenteeism", null)} />}
                {colOn("absenteeism") && <Cell col="absenteeism" shown={show(absCur, (x) => fmtPercent(x.ratio))} href={detailHref("absenteeism", null)} />}
                {colOn("etp-n1") && <Cell col="etp-n1" shown={averageShown(t.etpAverage.previous)} href={detailHref("etp-avg", null, true)} />}
                {colOn("absenteeism-n1") && <Cell col="absenteeism-n1" shown={absenteeismShown(t.absenteeism.previous)} href={detailHref("absenteeism", null, true)} />}
              </tr>
            </tfoot>
          </table>
        </div>
        <NdReasons items={ndItems} slug={slug} />
      </section>

      {cat && (
      <section className="panel" data-testid="kpi-categories">
        <div className="kpi-title-stack">
          <PanelTitle slug={slug} term={KPI_TERMS.categories} label="Effectif et ETP par catégorie">Effectif et ETP par catégorie</PanelTitle>
          <p className="desc">Fin de mois · personnes puis ETP{catScope ? " · périmètre des filtres" : ""}</p>
        </div>
        <KpiCategoryChart months={cat.months} keys={cat.keys} labels={CATEGORY_TABLE_LABELS} />
        <p className="kpi-scroll-hint">Tableau défilant : faire glisser vers la droite.</p>
        <div className="table-wrap scroll kpi-fit" tabIndex={0} role="region" aria-label="Effectif et ETP par catégorie, tableau défilant">
          <table className="data-table kpi-table sticky sticky-first" data-testid="kpi-categories-table">
            <thead>
              <tr><th>Mois</th>{cat.keys.map((k) => <th key={k} className="num">{CATEGORY_TABLE_LABELS[k] ?? k}</th>)}<th className="num">Total</th></tr>
            </thead>
            <tbody>
              {cat.months.map((c) => (
                <tr key={c.month} data-month={c.month}>
                  <td>{c.month}</td>
                  {c.kind === "nd" ? (
                    <td colSpan={cat.keys.length + 1} className="nd wrap">n.d. — {c.reason}</td>
                  ) : (
                    <>
                      {cat.keys.map((k) => {
                        const x = c.byCategory[k];
                        return <td key={k} className="num" data-col={k}>{x ? `${c.lowerBound ? "≥ " : ""}${x.headcount} · ${x.etp4 === null ? "ETP n.d." : `${fmtEtp4(x.etp4)} ETP`}` : "—"}</td>;
                      })}
                      <td className="num" data-col="total">{c.lowerBound ? "≥ " : ""}{Object.values(c.byCategory).reduce((n, x) => n + x.headcount, 0)} · {Object.values(c.byCategory).some((x) => x.etp4 === null) ? "ETP n.d." : `${fmtEtp4(Object.values(c.byCategory).reduce((n, x) => n + (x.etp4 ?? 0), 0))} ETP`}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {catScope && <p className="desc" data-testid="kpi-categories-scope">{catScope}</p>}
        <p className="desc"><a href={`/e/${slug}/parametres#projection`}>Paramètres › Catégories de contrat</a></p>
      </section>
      )}

      {detail && detailId && (
        <section className="panel" id="kpi-detail" data-testid="kpi-detail">
          <PanelTitle slug={slug} term={KPI_TERMS.detail} label="Détail d'un chiffre">
            Détail — {DETAIL_TITLES[detailId]}
            {onPrevious ? " (N-1)" : ""}
            {"month" in detail && detail.month ? ` · ${detail.month}` : ` · ${"window" in detail ? detail.window.label : w.label}`}
          </PanelTitle>
          <p className="desc"><a href={query({})}>Fermer le détail</a></p>
          {detail.id === "etp-end" && <EtpEndDetail v={detail.value} maps={maps} slug={slug} decimals={s.etpDecimals} refDate={data.build.referenceDate} />}
          {detail.id === "etp-prorated" && <EtpProratedDetail v={detail.value} maps={maps} slug={slug} decimals={s.etpDecimals} refDate={data.build.referenceDate} />}
          {detail.id === "headcount" && <HeadcountDetail v={detail.value} maps={maps} slug={slug} month={detail.month} natureAt={natureAt} />}
          {(detail.id === "entries" || detail.id === "exits") && <MovementsDetail v={detail.value} kind={detail.id === "entries" ? "entry" : "exit"} maps={maps} slug={slug} />}
          {(detail.id === "theoretical" || detail.id === "absenteeism") && <AbsenceMonthDetail id={detail.id} v={detail.value} theoretical={detail.theoretical} maps={maps} slug={slug} />}
          {detail.id === "absenteeism-window" && <AbsenteeismWindowDetail v={detail.value} theoretical={detail.theoretical} detailHref={inDetail} motifs={absenceByMotif(input, detail.window)} slug={slug} />}
          {(detail.id === "etp-avg" || detail.id === "headcount-avg") && <AverageDetail v={detail.value} detailHref={inDetail} />}
          {detail.id === "turnover" && <TurnoverDetail v={detail.value} maps={maps} slug={slug} detailHref={inDetail} natureAt={natureAt} />}
        </section>
      )}
      </>
      )}

      {!prevu && <KpiParams slug={slug} params={paramList(ctx.settings, ctx.collab.natures)} />}
    </KpiHeader>
  );
}
