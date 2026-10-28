import { MoneyText, MoneyUnitLabel } from "@/components/Money";
import "@/styles/masse-salariale.css";
import { BarChart, DonutChart, LineChart } from "@/components/charts";
import { ExportMenu } from "@/components/ExportMenu";
import { FamilyTabs } from "@/components/FamilyTabs";
import { GlossaryLink } from "@/components/GlossaryLink";
import { ViewSwitch } from "@/components/ViewSwitch";
import { confidentialiteHref, getConfidentialite } from "@/lib/confidentialite";
import { isMonth } from "@/lib/connectors/months";
import { dateTimeFmt } from "@/lib/connectors/labels";
import { formatMonth } from "@/lib/dates";
import { MASSE_TERMS } from "@/lib/glossary/masse";
import { dsnBrutWindow } from "@/lib/payroll/dsn";
import { monthPayroll, type CostPerEtp, type EtpMonth, type MonthPayroll, type PayrollWindow } from "@/lib/payroll/engine";
import type { MaskedEvolution, MaskedMonth, MaskedWindow } from "@/lib/payroll/service-rows";
import { gridRubrics } from "@/lib/payroll/grid";
import { loadPayrollContext } from "@/lib/payroll/context";
import { fmtEtp4, fmtPercent } from "@/lib/rh/kpi/format";
import { STUDIO_RH_ITEMS } from "@/lib/nav";
import { brutCotisationsSeries, capital, costSeries, euros, eurosSigned, evoDelta, evoPctDelta, hasNd, masseSeries, monthShortYear, monthsAxis, ndGroups, ndLines, numTrend, reasonLines, serviceMonthSeries, servicesParts, sourceReason, trendOf } from "@/lib/viz/masse";
import { ChartGuard, Composition, ConfidentialiteLine, eurosOf, GraphFoot, monthShort, MsHead, MsRead, NdKey, NdLines, NdState, PanelHead, PeriodBar, ScrollTable, Tile, TrendChart, TrendLegend, type Affichage } from "./components";
import { DsnView } from "./DsnView";
import { FixeVariableView, PaieComptaView } from "./Lot2Views";
import { NV, periodLabel, serviceLabel, syntheseOf, VUES } from "./synthese-data";
import { MS_PREVU } from "./tabs";
import { ActualNonRecurring } from "./ActualNonRecurring";
import { actualEventVersion, listActualEvents } from "@/lib/payroll/non-recurring-store";
import { saveActualEventAction } from "./actual-actions";
import { personLabel } from "@/lib/rh/view";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const ITEM = STUDIO_RH_ITEMS.find((i) => i.path === "studio-rh/masse-salariale")!;

// Fenêtres, mois et évolutions : la forme du moteur ou sa forme après seuil de confidentialité (n.d. avec sa seule raison).
const money = (w: MaskedWindow | PayrollWindow, pick: (x: Omit<Extract<PayrollWindow, { kind: "value" }>, "months">) => number) => (w.kind === "nd" ? "n.d." : euros(pick(w)));
// Valeur d'une tuile : « n.d. » seul quand une période est n.d. (la raison est écrite une fois sous les tuiles) ; un N-1 nul garde sa raison courte.
const evoText = (e: MaskedEvolution) => (e.kind === "nd" ? "n.d." : e.ratio === null ? "n.d. — N-1 nul : % non défini" : `${e.ratio.num > 0 ? "+" : ""}${fmtPercent(e.ratio)}`);
const evoEuros = (e: MaskedEvolution) => (e.kind === "nd" ? "" : eurosSigned(e.deltaCents));
// Écart de montant d'une tuile : la couleur de tendance (coût en hausse : rouge, en baisse : vert) et le signe écrit.
const delta = (cents: number, text: string) => <span className={`ms-delta ${trendOf(cents)}`.trim()}>{text}</span>;
const costText = (c: CostPerEtp) => (c.kind === "nd" ? "n.d." : eurosOf(c.costCents));
const cell = (r: MaskedMonth | MonthPayroll, pick: (x: Extract<MonthPayroll, { kind: "value" }>) => number) => (r.kind === "nd" ? "n.d." : euros(pick(r)));
// Cellule n.d. d'une répartition (seuil de confidentialité, mois hors journal) : la raison au survol, et listée sous le tableau.
const ndCell = (reason: string) => <abbr className="nd" title={reason}>n.d.</abbr>;

export default async function MasseSalarialePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Search> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await loadPayrollContext(slug);
  const base = `/e/${slug}/studio-rh/masse-salariale`;
  if (ctx.source === "dsn") return <MoneyText><DsnView slug={slug} dsn={ctx.dsn} sp={{ annee: one(sp.annee), de: one(sp.de), a: one(sp.a), affichage: one(sp.affichage) }} /></MoneyText>;
  const head = () => <MsHead title={ITEM.label} />;
  const gridOrigin = ctx.grid.origin === "default" ? "valeur par défaut validée le 22/10/2026" : `modifiée le ${ctx.grid.updatedAt ? dateTimeFmt.format(ctx.grid.updatedAt) : "n.d."}`;
  const sourceLine = ctx.read ? (
    <p className="desc ms-source" data-testid="ms-source">
      Source : <strong>journal comptable de paie PayFit</strong> — lecture du {dateTimeFmt.format(ctx.read.startedAt)} · mois lus <span className="ms-nowrap">{ctx.read.months[0] ?? "n.d."}</span> → <span className="ms-nowrap">{ctx.read.months.at(-1) ?? "n.d."}</span>
      <GlossaryLink slug={slug} term={MASSE_TERMS.montants} />
    </p>
  ) : null;
  // Grille de comptes en vigueur : donnée de l'espace (origine, rubriques, rôle et comptes) ; sa définition est au glossaire.
  const gridLine = (
    <div className="ms-read-block">
      <p className="ms-read-line" data-testid="ms-grid-origin">
        Grille de comptes : {gridOrigin} (<a href={`/e/${slug}/parametres#masse-salariale`}>Paramètres</a>)
        <GlossaryLink slug={slug} term={MASSE_TERMS.grille} />
      </p>
      <ul className="ms-facts-list" data-testid="ms-grid">
        {gridRubrics(ctx.grid.grid).map((r) => (
          <li key={r.id}>{`${r.label} (${r.role === "brut" ? "brut" : r.role === "cotisations" ? "cotisations" : "hors masse"}) : ${r.prefixes.join(", ") || "aucun compte"}`}</li>
        ))}
      </ul>
    </div>
  );
  // Chargement commun avec l'export Excel (mêmes paramètres d'adresse, mêmes règles de remplacement d'une valeur invalide) ; le seuil
  // de confidentialité de l'espace (sans valeur par défaut) s'applique aux lignes par service et au service retenu par le filtre.
  const confidentialite = await getConfidentialite(ctx.kpi.collab.workspace.id);
  const synthese = syntheseOf(ctx, sp, confidentialite);
  if (synthese.kind === "no-input") {
    return (
      <MoneyText><>
        {head()}
        <MsRead source={sourceLine}>{ctx.read ? gridLine : null}</MsRead>
        <NdState testid="ms-nd" reason={ctx.unavailable ? sourceReason(ctx.unavailable) : undefined} action={{ href: `/e/${slug}/donnees`, label: "Choisir ou lire une source dans Données" }}>
          <p className="ms-nd-reason">La masse salariale réelle suit la source RH retenue : journal comptable de paie PayFit (API) ou DSN déposées.</p>
        </NdState>
      </></MoneyText>
    );
  }

  if (synthese.kind === "no-month") {
    return (
      <MoneyText><>
        {head()}
        <MsRead source={sourceLine}>{gridLine}</MsRead>
        <NdState testid="ms-nd" reason="Aucun mois de journal de paie dans la lecture appliquée." action={{ href: `/e/${slug}/donnees`, label: "Lire le journal de paie dans Données" }} />
      </></MoneyText>
    );
  }

  // Période : année, premier et dernier mois, service, onglet et affichage (paramètres GET ; une valeur invalide est remplacée et signalée).
  const { fullInput, notices, vue, aff, knownServices, serviceValue, input, years, year, lastOfYear, from, to, months, prevMonths, cur, prev, evo, etpCur, etpPrev, cost, costPrev, services, link, guard, totalCur, totalPrev, totalEvo, serviceNd, showDsn } = synthese;
  const editable = ctx.kpi.collab.workspace.role !== "reader";
  const actualEvents = vue !== "paie-compta" ? await listActualEvents(ctx.kpi.collab.workspace.id) : [];
  const actualVersions = Object.fromEntries(actualEvents.map((event) => [event.id, actualEventVersion(event)]));
  const people = new Map(ctx.kpi.collab.data?.persons.map((person) => [person.personKey, person]));
  const actualContracts = editable ? (ctx.kpi.collab.data?.contracts ?? []).map((contract) => ({ key: contract.contractKey, label: `${personLabel(contract.personKey ? people.get(contract.personKey) : null) ?? "Contrat sans nom"} · ${contract.startDate ?? "début n.d."}` })) : [];
  const ignore = (k: string, v: string, why: string) => notices.push(`paramètre ignoré : ${k}=${v} (${why})`);
  const showGraph = aff !== "tableau";
  const showTable = aff !== "graphique";
  const label = periodLabel;
  const rate = (w: PayrollWindow) => (w.kind === "nd" || w.brut === 0 ? "n.d." : fmtPercent({ num: w.cotisations, den: w.brut }));
  const rawDetail = one(sp.mois);
  const detailMonth = isMonth(rawDetail) && (months.includes(rawDetail) || prevMonths.includes(rawDetail)) ? rawDetail : null;
  if (rawDetail && !detailMonth) ignore("mois", rawDetail, "hors de la période affichée et de son N-1");
  // Service retenu masqué par le seuil : le détail par compte d'un mois est n.d. aussi (même raison).
  const detail: MaskedMonth | null = detailMonth ? (guard ? { month: detailMonth, kind: "nd", open: false, nd: { reason: guard.reason } } : monthPayroll(input, detailMonth)) : null;
  const unclassified = new Map<string, { name: string | null; cents: number }>();
  for (const r of cur.months) if (r.kind === "value") for (const a of r.unclassified) unclassified.set(a.accountId, { name: a.accountName, cents: (unclassified.get(a.accountId)?.cents ?? 0) + a.balanceCents });
  const svcParam = serviceValue === undefined ? "" : `&service=${encodeURIComponent(serviceValue ?? NV)}`;
  const vueParam = vue === "synthese" ? "" : `&vue=${vue}`;
  const affQ = (a: Affichage) => (a === "tout" ? "" : `&affichage=${a}`);
  // Adresse de l'écran : année, mois, service, onglet et affichage courants, sauf ce que l'appel remplace.
  const href = (o: { y?: number; de?: string; a?: string; svc?: string; v?: string; aff?: Affichage; extra?: string } = {}) =>
    `${base}?annee=${o.y ?? year}&de=${o.de ?? from}&a=${o.a ?? to}${o.svc ?? svcParam}${o.v ?? vueParam}${affQ(o.aff ?? aff)}${o.extra ?? ""}`;
  const resetQuery = new URLSearchParams();
  if (vue !== "synthese") resetQuery.set("vue", vue);
  if (aff !== "tout") resetQuery.set("affichage", aff);
  const resetHref = `${base}${resetQuery.toString() ? `?${resetQuery.toString()}` : ""}`;
  const presets = [
    { label: "Janv.–mars", de: "01", a: "03" },
    { label: "Janv.–juin", de: "01", a: "06" },
    { label: `Janv.–${monthShort(`${year}-${lastOfYear}`)}`, de: "01", a: lastOfYear },
    { label: `${monthShort(`${year}-${lastOfYear}`)} seul`, de: lastOfYear, a: lastOfYear },
  ]
    .filter((p, i, all) => p.a <= lastOfYear && all.findIndex((x) => x.de === p.de && x.a === p.a) === i)
    .map((p) => ({ label: p.label, href: href({ de: p.de, a: p.a }), current: p.de === from && p.a === to }));
  const etpSum = (c: CostPerEtp) => (c.kind === "value" ? `${fmtEtp4(c.etpMonths4)} ETP-mois` : "");
  // Coût par ETP n.d. à cause des ETP : mois regroupés par raison identique (au lieu d'une phrase par mois).
  const costReason = (c: CostPerEtp, etp: EtpMonth[]) =>
    c.kind !== "nd" ? null : c.nd.code === "etp-nd" ? `ETP fin de mois — ${ndLines(ndGroups(etp.map((e) => ({ month: e.month, reason: e.etp4 === null ? (e.reason ?? "n.d.") : null })))).join(" ; ")}` : c.nd.reason;
  // Raisons des n.d. des tuiles : écrites une fois sous les tuiles (une raison commune à plusieurs indicateurs n'est pas répétée).
  const tileNd = reasonLines([
    { label: `Période (${label(months)})`, reason: cur.kind === "nd" ? cur.nd.reason : null },
    { label: `N-1 (${label(prevMonths)})`, reason: prev.kind === "nd" ? prev.nd.reason : null },
    { label: "Coût par ETP-mois", reason: costReason(cost, etpCur) },
    { label: "Coût par ETP-mois N-1", reason: costReason(costPrev, etpPrev) },
  ]);
  const openMonths = [...cur.months, ...prev.months].filter((r) => r.open).map((r) => r.month);
  const scope = serviceValue === undefined ? "tous les services" : `service ${serviceLabel(serviceValue)}`;
  const tableHref = href({ aff: "tableau" });
  const detailList = detailMonth ? (months.includes(detailMonth) ? months : prevMonths) : [];
  const detailAt = detailMonth ? detailList.indexOf(detailMonth) : -1;
  const detailPrev = detailAt > 0 ? detailList[detailAt - 1] : null;
  const detailNext = detailAt >= 0 && detailAt < detailList.length - 1 ? detailList[detailAt + 1] : null;
  const detailHref = (m: string | null) => href({ extra: m ? `&mois=${m}#ms-detail` : "" });
  // Raisons des « n.d. » du tableau mensuel (journal de paie et ETP, N et N-1), listées sous le tableau.
  const ndList = ndLines(
    ndGroups([
      ...[...cur.months, ...prev.months].map((r) => ({ month: r.month, reason: r.kind === "nd" ? r.nd.reason : null })),
      ...[...etpCur, ...etpPrev].map((e) => ({ month: e.month, reason: e.etp4 === null ? `ETP fin de mois : ${e.reason ?? "n.d."}` : null })),
    ]),
  );
  // Raisons des « n.d. » du tableau service × mois : celles qui ne sont pas déjà sous le tableau mensuel (le mois d'un seul service,
  // seuil de confidentialité d'un mois).
  const svcNdList = ndLines(ndGroups(services.flatMap((r) => r.cur.months.map((m) => ({ month: m.month, reason: m.kind === "nd" ? m.nd.reason : null }))))).filter((l) => !ndList.includes(l));
  // Raisons des « n.d. » du tableau Services (période et N-1 d'un service : seuil de confidentialité, mois hors journal).
  const svcRowNd = reasonLines(services.flatMap((r) => [
    { label: serviceLabel(r.value), reason: r.cur.kind === "nd" ? r.cur.nd.reason : null },
    { label: `${serviceLabel(r.value)} (N-1)`, reason: r.prev.kind === "nd" ? r.prev.nd.reason : null },
  ]));
  // Sous le filtre Service, service n.d. : l'action pour y remédier (retirer le filtre ; définir le seuil quand il manque).
  const guardHref = guard?.cause === "parametre" ? confidentialiteHref(slug) : null;
  const axis = monthsAxis(months, prevMonths, openMonths);
  const curOpen = cur.months.filter((r) => r.open).map((r) => r.month);
  const axisN = monthsAxis(months, [], curOpen);
  // Au-delà de neuf mois, un graphique empilé en demi-largeur n'a plus la place d'écrire les montants dans ses colonnes : pleine largeur.
  const wide = months.length > 9 ? "ms-chart wide" : "ms-chart";
  const svcParts = servicesParts(services.map((r) => ({ value: r.value, cur: r.cur })));
  // Un mois n.d. d'un seul service (ligne sans montant, seuil de confidentialité) : la somme empilée de ce mois ne couvre pas tous les services.
  const svcMonthNd = services.some((r) => r.cur.months.some((m) => m.kind === "nd"));
  const svcMonthSeries = serviceMonthSeries(services.map((r) => ({ value: r.value, months: r.cur.months })));
  const brutCotisSeries = brutCotisationsSeries(cur.months);
  const sparkMasse = masseSeries(cur.months, prev.months, { cur: "N", prev: "N-1" })[0].values;
  const costEtpSeries = costSeries(cur.months, etpCur, prev.months, etpPrev, { cur: `Coût par ETP ${year}`, prev: `Coût par ETP ${year - 1} (N-1)` });
  // Clé de lecture des n.d. : écrite une fois sous les graphiques, seulement si l'un d'eux en contient un.
  const anyNd = [masseSeries(cur.months, prev.months, { cur: "N", prev: "N-1" }), brutCotisSeries, costEtpSeries, ...(ctx.service.axis && services.length > 0 && services.length <= 8 ? [svcMonthSeries] : [])].some(hasNd);

  return (
    <MoneyText><>
      {head()}
      <FamilyTabs
        label="Vues"
        testid="ms-tabs"
        current={vue}
        tabs={[
          ...(Object.keys(VUES) as (keyof typeof VUES)[]).map((v) => ({ key: v, label: VUES[v], href: href({ v: v === "synthese" ? "" : `&vue=${v}` }) })),
          ...MS_PREVU.map((t) => ({ key: t.key, label: t.label, href: `${base}${t.path}`, soon: t.soon })),
          { key: "ecart", label: "Écart budgétaire", href: `${base}/ecart` },
          { key: "analyse", label: "Analyse des écarts", href: `${base}/analyse` },
        ]}
      />

      <div className="ms-controls">
        <MsRead source={sourceLine}>
          {gridLine}
          {cur.kind === "value" && (
            <div className="ms-read-block" data-testid="ms-hors-masse">
              <p className="ms-read-line">
                Postes comptés à part ou hors masse chargée, sur la période
                <GlossaryLink slug={slug} term={MASSE_TERMS.horsMasse} />
              </p>
              <ul className="ms-facts-list">
                <li>Taxes et contributions sur les salaires (dans les cotisations) : <b>{euros(cur.byRubric.taxes)}</b></li>
                <li>Gratifications de stage (dans le brut) : <b>{euros(cur.byRubric.stages)}</b></li>
                <li>Provisions de congés payés (hors masse chargée) : <b>{euros(cur.byRubric["provisions-cp"])}</b></li>
                <li>Autres charges de personnel (hors masse chargée) : <b>{euros(cur.byRubric["autres-charges"])}</b></li>
              </ul>
            </div>
          )}
        </MsRead>
        <PeriodBar
          years={years}
          year={year}
          from={from}
          to={to}
          hidden={{ ...(vue !== "synthese" ? { vue } : {}), ...(aff !== "tout" ? { affichage: aff } : {}) }}
          presets={presets}
          resetHref={resetHref}
          service={ctx.service.axis ? { value: serviceValue === undefined ? "" : (serviceValue ?? NV), options: knownServices.map((v) => ({ value: v ?? NV, label: serviceLabel(v) })) } : undefined}
        />
        {notices.map((n) => (
          <p key={n} className="notice" data-testid="ms-param-notice">{n}</p>
        ))}
        <div className="ms-toolbar">
          <p className="desc ms-period" data-testid="ms-period">
            <strong>{label(months)}</strong> · N-1 : {label(prevMonths)} · {scope} · <MoneyUnitLabel />
            {cur.kind === "value" && cur.openMonths.length > 0 && <> · mois provisoires (paie non clôturée) : {cur.openMonths.map(monthShortYear).join(", ")}</>}
          </p>
          <TrendLegend slug={slug} />
          <div className="panel-tools">
            <ViewSwitch
              testid="ms-affichage"
              label="Affichage des résultats"
              current={aff}
              options={[
                { key: "tout", label: "Afficher tout", href: href({ aff: "tout" }) },
                { key: "graphique", label: "Graphique", href: href({ aff: "graphique" }) },
                { key: "tableau", label: "Tableau", href: tableHref },
              ]}
            />
            {vue === "synthese" && (
              <ExportMenu testid="ms-export" options={[{ label: "Excel (.xlsx)", href: `${base}/export?annee=${year}&de=${from}&a=${to}${svcParam}&format=xlsx`, testid: "ms-export-xlsx" }]} />
            )}
          </div>
        </div>
      </div>

      {vue !== "paie-compta" && <ActualNonRecurring slug={slug} input={input} events={actualEvents} months={months} syncId={ctx.read?.syncId ?? null} contracts={actualContracts} editable={editable} save={editable && ctx.read ? saveActualEventAction.bind(null, slug, ctx.read.syncId, actualVersions) : undefined} />}

      {vue === "fixe-variable" && <FixeVariableView slug={slug} input={input} months={months} prevMonths={prevMonths} aff={aff} tableHref={tableHref} link={link} confidentialite={confidentialite} guard={guard} unfilterHref={href({ svc: "" })} />}
      {vue === "paie-compta" && <PaieComptaView slug={slug} input={input} fullInput={fullInput} months={months} serviceFiltered={serviceValue !== undefined} serviceValue={serviceValue} compta={await ctx.compta()} aff={aff} tableHref={tableHref} unfilterHref={href({ svc: "" })} link={link} confidentialite={confidentialite} guard={guard} />}
      {vue === "synthese" && (
        <>
          <section className="panel">
            <PanelHead title="Vue d'ensemble" />
            <dl className="facts ms-tiles five">
              <Tile
                testid="ms-tile-masse"
                sparkline={sparkMasse}
                main
                label="Masse salariale chargée"
                value={money(cur, (w) => w.masse)}
                nd={cur.kind === "nd"}
                compare={<span className="tile-foot" data-testid="ms-tile-masse-n1">N-1 : {money(prev, (w) => w.masse)}</span>}
                def={MASSE_TERMS.masse}
                slug={slug}
              />
              <Tile
                testid="ms-tile-evolution"
                label="Évolution vs N-1"
                value={evoText(evo)}
                nd={evo.kind === "nd" || evo.ratio === null}
                ndLong={evo.kind === "value" && evo.ratio === null}
                trend={trendOf(evoPctDelta(evo))}
                lead={evo.kind === "value" ? delta(evo.deltaCents, evoEuros(evo)) : undefined}
                def={MASSE_TERMS.evolution}
                slug={slug}
              />
              <Tile
                testid="ms-tile-cost-etp"
                sparkline={costEtpSeries[0].values}
                label="Coût par ETP-mois"
                value={costText(cost)}
                nd={cost.kind === "nd"}
                lead={etpSum(cost) || undefined}
                compare={<span className="tile-foot">N-1 : {costText(costPrev)}</span>}
                def={MASSE_TERMS.coutEtp}
                slug={slug}
              />
              <Tile
                testid="ms-tile-brut"
                sparkline={brutCotisSeries.find((s) => s.key === "brut")?.values}
                label="Brut"
                value={money(cur, (w) => w.brut)}
                nd={cur.kind === "nd"}
                lead={`dont primes : ${money(cur, (w) => w.byRubric.primes)}`}
                compare={<span className="tile-foot">N-1 : {money(prev, (w) => w.brut)}</span>}
                def={MASSE_TERMS.brut}
                slug={slug}
              />
              <Tile
                testid="ms-tile-cotisations"
                sparkline={brutCotisSeries.find((s) => s.key === "cotisations")?.values}
                label="Cotisations patronales"
                value={money(cur, (w) => w.cotisations)}
                nd={cur.kind === "nd"}
                lead={`taux : ${rate(cur)} du brut`}
                compare={<span className="tile-foot">N-1 : {money(prev, (w) => w.cotisations)}{prev.kind === "value" ? ` (${rate(prev)})` : ""}</span>}
                def={MASSE_TERMS.cotisations}
                slug={slug}
              />
            </dl>
            <NdLines lines={tileNd} testid="ms-tiles-nd" />
            {guard && (
              <NdState testid="ms-service-guard" title={`n.d. — service ${serviceLabel(serviceValue ?? null)} retenu par le filtre`} reason={capital(guard.reason)} action={{ href: href({ svc: "" }), label: "Retirer le filtre Service" }}>
                {guardHref && <p className="ms-nd-reason"><a href={guardHref}>Définir le seuil de confidentialité dans Paramètres</a></p>}
              </NdState>
            )}
            {ctx.etpQualifiers.length > 0 && (
              <p className="tile-foot ms-note" data-testid="ms-etp-qualifiers">
                Coût par ETP-mois — ETP : {ctx.etpQualifiers.join(" ; ")}.
              </p>
            )}
            {cur.kind === "value" && <Composition brut={cur.brut} cotisations={cur.cotisations} />}
          </section>

          {showGraph && (
            <section className="panel" data-testid="ms-graphs">
              <PanelHead title="Graphiques" slug={slug} term={MASSE_TERMS.graphiques} />
              <div className="ms-charts">
                <div className="ms-chart wide">
                  <TrendChart rows={cur.months} previous={prev.months} lines={ndList} />
                </div>
                <div className="ms-chart wide">
                  {ctx.service.axis && services.length > 0 ? (
                    <div className="ms-charts-split" data-testid="ms-by-service">
                      <div className="ms-chart">
                        <DonutChart
                          testid="ms-chart-services"
                          label={`Répartition de la masse chargée par service, ${label(months)}, montants monétaires`}
                          title={`Par service, ${label(months)}`}
                          parts={svcParts.parts}
                          unit="eur"
                          centerLabel="masse chargée"
                          note={[
                            serviceValue !== undefined ? "Le filtre Service ne s'applique pas ici : tous les services sont montrés." : null,
                            svcParts.omitted.length ? `Hors anneau (coût nul ou négatif) : ${svcParts.omitted.join(" ; ")}.` : null,
                            svcParts.omitted.length || svcParts.parts.some((p) => p.value === null) ? "Parts calculées sur les services tracés." : null,
                          ].filter(Boolean).join(" ") || undefined}
                        />
                      </div>
                      <div className="ms-chart">
                        {services.length <= 8 ? (
                          <ChartGuard testid="ms-chart-services-months" title={`Répartition mensuelle par service, ${year}`} series={svcMonthSeries} lines={ndList}>
                          <BarChart
                            testid="ms-chart-services-months"
                            label={`Masse chargée par mois et par service, ${year}, montants monétaires`}
                            title={`Répartition mensuelle par service, ${year}`}
                            categories={axisN.categories}
                            categoryTitles={axisN.titles}
                            series={svcMonthSeries}
                            unit="eur"
                            mode="stacked"
                            toggle
                            note={svcMonthNd ? "Total de l'infobulle : hors service n.d." : undefined}
                          />
                          </ChartGuard>
                        ) : (
                          <NdState
                            testid="ms-chart-services-months-nd"
                            heading={`Répartition mensuelle par service, ${year}`}
                            title="Graphique non tracé"
                            reason={<>Plus de huit services : graphique non tracé. Montants dans l'affichage <a href={tableHref}>Tableau</a> ; le filtre Service isole un service.</>}
                          />
                        )}
                      </div>
                    </div>
                  ) : (
                    <NdState
                      testid="ms-chart-services-nd"
                      heading="Masse chargée par service"
                      reason={ctx.service.axis ? "Aucune ligne de charges de personnel dans le journal sur la période." : `${capital(serviceNd)}.`}
                      action={ctx.service.axis ? undefined : { href: `/e/${slug}/parametres#masse-salariale`, label: "Choisir l'axe du service dans Paramètres" }}
                    />
                  )}
                </div>
                <div className={wide}>
                  <ChartGuard testid="ms-chart-brut-cotisations" title={`Brut et cotisations patronales par mois, ${year}`} series={brutCotisSeries} lines={ndList}>
                    <BarChart
                      testid="ms-chart-brut-cotisations"
                      label={`Brut et cotisations patronales par mois, ${year}, montants monétaires`}
                      title={`Brut et cotisations patronales par mois, ${year}`}
                      categories={axisN.categories}
                      categoryTitles={axisN.titles}
                      series={brutCotisSeries}
                      unit="eur"
                      mode="stacked"
                      toggle
                    />
                  </ChartGuard>
                </div>
                <div className={wide}>
                  <ChartGuard testid="ms-chart-cout-etp" title={`Coût par ETP et par mois, ${year} face à ${year - 1} (N-1)`} series={costEtpSeries} lines={ndList}>
                    <LineChart
                      testid="ms-chart-cout-etp"
                      label={`Coût par ETP et par mois, ${year} et ${year - 1}, montants monétaires`}
                      title={`Coût par ETP et par mois, ${year} face à ${year - 1} (N-1)`}
                      categories={axis.categories}
                      categoryTitles={axis.titles}
                      series={costEtpSeries}
                      unit="eur"
                    />
                  </ChartGuard>
                </div>
              </div>
              {anyNd && <NdKey />}
              {!showTable && <NdLines lines={[...ndList, ...svcNdList]} testid="ms-graph-nd-reasons" />}
              <GraphFoot aff={aff} tableHref={tableHref} />
            </section>
          )}

          {unclassified.size > 0 && (
            <p className="notice" data-testid="ms-unclassified">
              Comptes de charges de personnel sans rubrique (hors masse chargée) :{" "}
              {[...unclassified.entries()].map(([id, a]) => `${id} ${a.name ?? ""} (${euros(a.cents)})`).join(" · ")} — <a href={`/e/${slug}/parametres#masse-salariale`}>classer dans Paramètres</a>
            </p>
          )}

          {showTable && (
            <>
              <section className="panel" data-testid="ms-services">
                <PanelHead
                  title="Services"
                  slug={slug}
                  term={MASSE_TERMS.service}
                  desc={ctx.service.axis ? `Code analytique « ${ctx.service.axis} » du journal PayFit${ctx.service.origin === "single-axis" ? " (seul axe présent)" : ""}` : "Aucun axe analytique"}
                  tools={serviceValue !== undefined ? <a className="btn small" href={href({ svc: "" })}>Retirer le filtre Service</a> : undefined}
                />
                {!ctx.service.axis ? (
                  <NdState testid="ms-services-nd" reason={`${capital(serviceNd)}.`} action={{ href: `/e/${slug}/parametres#masse-salariale`, label: "Choisir l'axe du service dans Paramètres" }} />
                ) : (
                  <>
                    {ctx.axisMissing && <p className="notice" data-testid="ms-axis-missing">L'axe « {ctx.service.axis} » choisi dans Paramètres n'existe plus dans le journal appliqué : toutes les lignes sont « Non ventilé ».</p>}
                    <ConfidentialiteLine slug={slug} setting={confidentialite} testid="ms-services-confidentialite" />
                    <ScrollTable label="Tableau des services">
                      <table className="data-table sticky sticky-first ms-table" data-testid="ms-services-table">
                        <caption className="ms-sr">Masse salariale chargée par service, {label(months)}, comparée à {label(prevMonths)} ; les colonnes sans N-1 portent sur la période {year}</caption>
                        <thead>
                          <tr>
                            <th scope="col">Service</th>
                            <th scope="col" className="num">Coût {year}</th>
                            <th scope="col" className="num n1">Coût N-1</th>
                            <th scope="col" className="num">Écart</th>
                            <th scope="col" className="num">Écart (%)</th>
                            <th scope="col" className="num">Part du coût</th>
                            <th scope="col" className="num">Hors primes</th>
                            <th scope="col" className="num">Primes</th>
                            <th scope="col" className="num">Cotisations</th>
                            <th scope="col" className="num">Coût / personne-mois</th>
                          </tr>
                        </thead>
                        <tbody>
                          {services.map((r) => {
                            const c = r.cur;
                            const isCurrent = serviceValue !== undefined && serviceValue === r.value;
                            return (
                              <tr key={r.value ?? NV} data-service={r.value ?? NV} className={isCurrent ? "selected" : undefined} aria-current={isCurrent ? "true" : undefined}>
                                <th scope="row"><a className="ms-detail-link" href={href({ svc: `&service=${encodeURIComponent(r.value ?? NV)}` })}>{serviceLabel(r.value)}</a></th>
                                <td className="num" data-col="n">{c.kind === "nd" ? ndCell(c.nd.reason) : euros(c.masse)}</td>
                                <td className="num n1" data-col="n1">{r.prev.kind === "nd" ? ndCell(r.prev.nd.reason) : euros(r.prev.masse)}</td>
                                <td className={numTrend(evoDelta(r.evo))} data-col="ecart">{r.evo.kind === "value" ? evoEuros(r.evo) : ndCell(r.evo.nd.reason)}</td>
                                <td className={numTrend(evoPctDelta(r.evo))} data-col="ecart-pct">{r.evo.kind === "value" ? evoText(r.evo) : ndCell(r.evo.nd.reason)}</td>
                                <td className="num" data-col="part">{c.kind === "nd" ? ndCell(c.nd.reason) : totalCur.kind === "value" && totalCur.masse > 0 ? fmtPercent({ num: c.masse, den: totalCur.masse }) : "n.d."}</td>
                                <td className="num" data-col="hors-primes">{c.kind === "nd" ? ndCell(c.nd.reason) : euros(c.brut - c.byRubric.primes)}</td>
                                <td className="num" data-col="primes">{c.kind === "nd" ? ndCell(c.nd.reason) : euros(c.byRubric.primes)}</td>
                                <td className="num" data-col="cotisations">{c.kind === "nd" ? ndCell(c.nd.reason) : euros(c.cotisations)}</td>
                                <td className="num" data-col="cout-pm">{c.kind === "nd" ? ndCell(c.nd.reason) : c.paidContractMonths > 0 ? eurosOf({ num: c.masse, den: c.paidContractMonths }) : "n.d."}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="total" data-testid="ms-services-total">
                            <th scope="row">Total</th>
                            <td className="num" data-col="n">{money(totalCur, (w) => w.masse)}</td>
                            <td className="num n1" data-col="n1">{money(totalPrev, (w) => w.masse)}</td>
                            <td className={numTrend(evoDelta(totalEvo))} data-col="ecart">{totalEvo.kind === "value" ? evoEuros(totalEvo) : "n.d."}</td>
                            <td className={numTrend(evoPctDelta(totalEvo))} data-col="ecart-pct">{totalEvo.kind === "value" ? evoText(totalEvo) : "n.d."}</td>
                            <td className="num" data-col="part">—</td>
                            <td className="num" data-col="hors-primes">{totalCur.kind === "value" ? euros(totalCur.brut - totalCur.byRubric.primes) : "n.d."}</td>
                            <td className="num" data-col="primes">{totalCur.kind === "value" ? euros(totalCur.byRubric.primes) : "n.d."}</td>
                            <td className="num" data-col="cotisations">{totalCur.kind === "value" ? euros(totalCur.cotisations) : "n.d."}</td>
                            <td className="num" data-col="cout-pm">{totalCur.kind === "value" && totalCur.paidContractMonths > 0 ? eurosOf({ num: totalCur.masse, den: totalCur.paidContractMonths }) : "n.d."}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </ScrollTable>
                    <NdLines lines={svcRowNd} testid="ms-services-nd-reasons" />
                    <div className="ms-table-gap">
                      <h3 className="ms-sub">Masse chargée par service et par mois</h3>
                      <ConfidentialiteLine slug={slug} setting={confidentialite} testid="ms-services-months-confidentialite" />
                      <ScrollTable label="Tableau de la masse chargée par service et par mois">
                        <table className="data-table sticky sticky-first ms-table" data-testid="ms-services-months">
                          <caption className="ms-sr">Masse salariale chargée par service et par mois, {label(months)}</caption>
                          <thead>
                            <tr>
                              <th scope="col">Service</th>
                              {months.map((m) => <th key={m} scope="col" className="num">{monthShort(m)}</th>)}
                              <th scope="col" className="num">Période</th>
                            </tr>
                          </thead>
                          <tbody>
                            {services.map((r) => (
                              <tr key={r.value ?? NV} data-service={r.value ?? NV}>
                                <th scope="row">{serviceLabel(r.value)}</th>
                                {r.cur.months.map((m) => (
                                  <td key={m.month} className="num" data-col={m.month}>{m.kind === "nd" ? ndCell(m.nd.reason) : euros(m.masse)}</td>
                                ))}
                                <td className="num" data-col="periode">{r.cur.kind === "value" ? euros(r.cur.masse) : ndCell(r.cur.nd.reason)}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="total" data-testid="ms-services-months-total">
                              <th scope="row">Total</th>
                              {totalCur.months.map((m) => (
                                <td key={m.month} className="num" data-col={m.month}>{m.kind === "nd" ? ndCell(m.nd.reason) : euros(m.masse)}</td>
                              ))}
                              <td className="num" data-col="periode">{totalCur.kind === "value" ? euros(totalCur.masse) : ndCell(totalCur.nd.reason)}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </ScrollTable>
                      <NdLines lines={svcNdList} testid="ms-services-months-nd" />
                    </div>
                  </>
                )}
              </section>

              <section className="panel">
                <PanelHead title="Mois par mois" slug={slug} term={MASSE_TERMS.mois} />
                <ScrollTable label="Tableau mois par mois">
                  <table className="data-table sticky sticky-first ms-table" data-testid="ms-monthly-table">
                    <caption className="ms-sr">Masse salariale chargée mois par mois, {label(months)}, comparée à {label(prevMonths)}</caption>
                    <thead>
                      <tr>
                        <th scope="col">Mois</th>
                        <th scope="col" className="num">Masse chargée</th>
                        <th scope="col" className="num n1">Masse N-1</th>
                        <th scope="col" className="num">Écart</th>
                        <th scope="col" className="num">Brut</th>
                        <th scope="col" className="num">dont primes</th>
                        <th scope="col" className="num">Cotisations</th>
                        <th scope="col" className="num">ETP fin de mois</th>
                        <th scope="col" className="num n1">ETP N-1</th>
                        <th scope="col" className="num">Coût / ETP</th>
                        <th scope="col" className="num n1">Coût / ETP N-1</th>
                        {showDsn && (
                          <>
                            <th scope="col" className="num">Brut DSN (001)</th>
                            <th scope="col" className="num">Écart journal − DSN</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {cur.months.map((r, i) => {
                        const p = prev.months[i];
                        const e = etpCur[i];
                        const ep = etpPrev[i];
                        const diff = r.kind === "value" && p.kind === "value" ? r.masse - p.masse : null;
                        const selected = detailMonth === r.month || detailMonth === p.month;
                        return (
                          <tr key={r.month} data-month={r.month} className={selected ? "selected" : undefined} aria-current={selected ? "true" : undefined}>
                            <th scope="row">
                              <a className="ms-detail-link" href={detailHref(r.month)} aria-label={`${formatMonth(r.month)} : détail par compte`}>{formatMonth(r.month)}</a>
                              {r.open && <span className="ms-prov">provisoire</span>}
                            </th>
                            <td className="num" data-col="masse">{cell(r, (x) => x.masse)}</td>
                            <td className="num n1" data-col="masse-n1"><a className="ms-detail-link" href={detailHref(p.month)} aria-label={`${cell(p, (x) => x.masse)} : détail par compte de ${formatMonth(p.month).toLowerCase()}`}>{cell(p, (x) => x.masse)}</a></td>
                            <td className={numTrend(diff)} data-col="ecart">{diff === null ? "n.d." : eurosSigned(diff)}</td>
                            <td className="num" data-col="brut">{r.kind === "nd" ? <span className="nd" title={r.nd.reason}>n.d.</span> : euros(r.brut)}</td>
                            <td className="num" data-col="primes">{cell(r, (x) => x.byRubric.primes)}</td>
                            <td className="num" data-col="cotisations">{cell(r, (x) => x.cotisations)}</td>
                            <td className="num" data-col="etp">{e.etp4 === null ? <span className="nd" title={e.reason ?? ""}>n.d.</span> : fmtEtp4(e.etp4)}</td>
                            <td className="num n1" data-col="etp-n1">{ep.etp4 === null ? <span className="nd" title={ep.reason ?? ""}>n.d.</span> : fmtEtp4(ep.etp4)}</td>
                            <td className="num" data-col="cout-etp">{r.kind === "value" && e.etp4 ? eurosOf({ num: r.masse * 10000, den: e.etp4 }) : "n.d."}</td>
                            <td className="num n1" data-col="cout-etp-n1">{p.kind === "value" && ep.etp4 ? eurosOf({ num: p.masse * 10000, den: ep.etp4 }) : "n.d."}</td>
                            {showDsn && (() => {
                              const d = ctx.dsn.get(r.month);
                              const b = d && d.status !== "blocked" ? d.byType["001"] : undefined;
                              if (!d || b === undefined) return <><td className="num nd" data-col="dsn" title={d?.messages.join(" ; ")}>{!d ? "non déposée" : d.status === "blocked" ? "bloquée" : "type 001 absent"}</td><td className="num">—</td></>;
                              return (
                                <>
                                  <td className="num" data-col="dsn" title={d.status !== "complete" ? d.messages.join(" ; ") : undefined}>{euros(b)}{d.status !== "complete" ? " ⚠" : ""}</td>
                                  <td className={numTrend(r.kind === "value" ? r.brut - b : null)} data-col="dsn-ecart">{r.kind === "value" ? eurosSigned(r.brut - b) : "n.d."}</td>
                                </>
                              );
                            })()}
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="total" data-testid="ms-monthly-foot">
                        <th scope="row">Période</th>
                        <td className="num" data-col="masse">{money(cur, (w) => w.masse)}</td>
                        <td className="num n1" data-col="masse-n1">{money(prev, (w) => w.masse)}</td>
                        <td className={numTrend(evoDelta(evo))} data-col="ecart">{evo.kind === "value" ? evoEuros(evo) : "n.d."}</td>
                        <td className="num" data-col="brut">{money(cur, (w) => w.brut)}</td>
                        <td className="num" data-col="primes">{money(cur, (w) => w.byRubric.primes)}</td>
                        <td className="num" data-col="cotisations">{money(cur, (w) => w.cotisations)}</td>
                        <td className="num" data-col="etp">{etpCur.every((e) => e.etp4 !== null) ? `${fmtEtp4(etpCur.reduce((s, e) => s + (e.etp4 ?? 0), 0))} ETP-mois` : "n.d."}</td>
                        <td className="num n1" data-col="etp-n1">{etpPrev.every((e) => e.etp4 !== null) ? `${fmtEtp4(etpPrev.reduce((s, e) => s + (e.etp4 ?? 0), 0))} ETP-mois` : "n.d."}</td>
                        <td className="num" data-col="cout-etp">{cost.kind === "value" ? eurosOf(cost.costCents) : "n.d."}</td>
                        <td className="num n1" data-col="cout-etp-n1">{costPrev.kind === "value" ? eurosOf(costPrev.costCents) : "n.d."}</td>
                        {showDsn && (() => {
                          const w = dsnBrutWindow(ctx.dsn, months);
                          if (w.kind === "nd") return <><td className="num nd" data-col="dsn" title={w.reason}>n.d.</td><td className="num">—</td></>;
                          const warn = w.incompleteMonths.length ? " ⚠" : "";
                          return <><td className="num" data-col="dsn" title={w.incompleteMonths.length ? `mois incomplets : ${w.incompleteMonths.join(", ")}` : undefined}>{euros(w.brutCents)}{warn}</td><td className={numTrend(cur.kind === "value" ? cur.brut - w.brutCents : null)} data-col="dsn-ecart">{cur.kind === "value" ? eurosSigned(cur.brut - w.brutCents) : "n.d."}</td></>;
                        })()}
                      </tr>
                    </tfoot>
                  </table>
                </ScrollTable>
                <NdLines lines={ndList} />
                <p className="tile-foot ms-note" data-testid="ms-dsn-control">
                  {showDsn
                    ? "Contrôle DSN : ⚠ = mois DSN incomplet ou bloqué."
                    : serviceValue !== undefined
                      ? "Contrôle DSN : disponible sur le total entreprise (sans filtre Service)."
                      : "Contrôle DSN : aucune DSN déposée pour ces mois."}{" "}
                  <a href={`/e/${slug}/donnees/dsn`}>Données › DSN</a>
                  <GlossaryLink slug={slug} term={MASSE_TERMS.controleDsn} />
                </p>
              </section>

              {detail && (
                <section className="panel" id="ms-detail" data-testid="ms-detail">
                  <PanelHead
                    title={`Détail par compte — ${formatMonth(detail.month)}${detail.open ? " (provisoire)" : ""}${serviceValue !== undefined ? ` · service ${serviceLabel(serviceValue)}` : ""}`}
                    slug={slug}
                    term={MASSE_TERMS.montants}
                    tools={
                      <div className="ms-detail-nav" role="group" aria-label="Navigation entre les mois">
                        {detailPrev ? <a className="btn small" href={detailHref(detailPrev)} rel="prev">‹ {formatMonth(detailPrev)}</a> : <span className="btn small" aria-disabled="true">‹ Mois précédent</span>}
                        {detailNext ? <a className="btn small" href={detailHref(detailNext)} rel="next">{formatMonth(detailNext)} ›</a> : <span className="btn small" aria-disabled="true">Mois suivant ›</span>}
                        <a className="btn small" href={detailHref(null)}>Fermer le détail</a>
                      </div>
                    }
                  />
                  {detail.kind === "nd" ? (
                    <NdState testid="ms-detail-nd" reason={capital(detail.nd.reason)} />
                  ) : (
                    <ScrollTable label="Tableau du détail par compte">
                      <table className="data-table sticky ms-table" data-testid="ms-detail-accounts">
                        <caption className="ms-sr">Détail par compte de {formatMonth(detail.month)}</caption>
                        <thead><tr><th scope="col">Compte</th><th scope="col">Libellé (PayFit)</th><th scope="col">Rubrique</th><th scope="col" className="num">Débit</th><th scope="col" className="num">Crédit</th><th scope="col" className="num">Solde</th><th scope="col" className="num">Lignes</th></tr></thead>
                        <tbody>
                          {detail.accounts.map((a) => (
                            <tr key={a.accountId} data-account={a.accountId}>
                              <td>{a.accountId}</td>
                              <td className="wrap">{a.accountName ?? <span className="nd">n.d.</span>}</td>
                              <td>{a.rubric ? `${a.rubric.label}${a.rubric.role === "hors-masse" ? " (hors masse)" : ""}` : <span className="nd">non classé (hors masse)</span>}</td>
                              <td className="num">{euros(a.debitCents)}</td>
                              <td className="num">{euros(a.creditCents)}</td>
                              <td className="num">{euros(a.balanceCents)}</td>
                              <td className="num">{a.lines}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="subtotal"><td colSpan={5}>Brut</td><td className="num" data-testid="ms-detail-brut">{euros(detail.brut)}</td><td /></tr>
                          <tr className="subtotal"><td colSpan={5}>Cotisations patronales</td><td className="num" data-testid="ms-detail-cotisations">{euros(detail.cotisations)}</td><td /></tr>
                          <tr className="total"><td colSpan={5}><strong>Masse salariale chargée</strong></td><td className="num" data-testid="ms-detail-masse"><strong>{euros(detail.masse)}</strong></td><td /></tr>
                        </tfoot>
                      </table>
                    </ScrollTable>
                  )}
                </section>
              )}
            </>
          )}
        </>
      )}
    </></MoneyText>
  );
}
