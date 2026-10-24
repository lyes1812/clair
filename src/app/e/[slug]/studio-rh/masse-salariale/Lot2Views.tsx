import { BarChart, DonutChart, LineChart } from "@/components/charts";
import { formatMonth } from "@/lib/dates";
import { servicesOf, shiftYear, windowPayroll, withService, type JournalInput } from "@/lib/payroll/engine";
import { RUBRICS, type RubricId } from "@/lib/payroll/grid";
import { comptaGap, labelTotals, operatingRevenue, provisionMonth, reconcile, type ComptaLine, type ProvisionMonth } from "@/lib/payroll/lot2";
import { fmtPercent } from "@/lib/rh/kpi/format";
import { brutParts, capital, euros, eurosSigned, fixeVariableMonths, fixeVariableSeries, hueReuseNote, monthsAxis, ndNote, noPeriod, pluriel, primesSeries, provisionParts, provisionTotals, reasonText, reconMonthSeries, reconRubricChart, type PrimesMonth } from "@/lib/viz/masse";
import { ChartGuard, GraphFoot, monthlyNote, NdLines, NdState, PanelHead, ScrollTable, Tile, type Affichage } from "./components";

const lowerMonth = (m: string) => formatMonth(m).toLowerCase();
// Écart en % : « n.d. » avec sa raison quand la valeur de départ est nulle ou négative ; le moins est le vrai signe moins.
const pct = (a: number, b: number) => (b === 0 ? "n.d. (N-1 nul)" : b < 0 ? "n.d. (N-1 négatif)" : `${a - b > 0 ? "+" : ""}${fmtPercent({ num: a - b, den: b })}`);
const rubricLabel = (id: RubricId | "non-classe") => (id === "non-classe" ? "Comptes 63/64 non classés" : (RUBRICS.find((r) => r.id === id)?.label ?? id));
const BRUT: RubricId[] = ["salaires", "primes", "stages", "indemnites"];
// Raisons des n.d. d'un tableau, listées sous le tableau (jamais seulement en infobulle).
const ndReasons = (reasons: (string | null | undefined)[]) => {
  const list = [...new Set(reasons.filter((r): r is string => Boolean(r)))];
  return list.length ? <NdLines lines={list} testid="nd-reasons" /> : null;
};

// --- Onglet « Fixe & variable » : brut par rubrique et par libellé de paie PayFit, N et N-1, primes par famille et par mois.
export function FixeVariableView({ input, months, prevMonths, aff = "tout", tableHref = "" }: { input: JournalInput; months: string[]; prevMonths: string[]; aff?: Affichage; tableHref?: string }) {
  const cur = windowPayroll(input, months);
  const prev = windowPayroll(input, prevMonths);
  const showGraph = aff !== "tableau";
  const showTable = aff !== "graphique";
  const year = months[0].slice(0, 4);
  // Fixe, variable et gratifications de stage mois par mois : mêmes valeurs que le tableau « Fixe et variable par mois ».
  const fvMonths = fixeVariableMonths(cur.months);
  const open = cur.months.filter((r) => r.open).map((r) => r.month);
  const axis = monthsAxis(months, [], open);
  const fvSeries = fixeVariableSeries(fvMonths);
  const monthsChart = (
    <ChartGuard testid="fv-chart-months" title={`Brut par nature et par mois, ${year}`} series={fvSeries}>
      <BarChart
        testid="fv-chart-months"
        label={`Brut par mois, fixe, variable et gratifications de stage, ${year}, en euros`}
        title={`Brut par nature et par mois, ${year}`}
        categories={axis.categories}
        categoryTitles={axis.titles}
        series={fvSeries}
        unit="eur"
        mode="stacked"
        toggle
        note={["Fixe + variable + gratifications de stage = brut du mois.", monthlyNote(open, fvSeries)].filter(Boolean).join(" ")}
      />
    </ChartGuard>
  );
  if (cur.kind === "nd") {
    return (
      <>
        <NdState testid="fv-nd" reason={capital(cur.nd.reason)} />
        {showGraph && (
          <section className="panel" data-testid="fv-graphs">
            <PanelHead title="Graphiques" desc="Brut par nature, mois par mois ; montants en euros. La raison de chaque mois n.d. est écrite plus haut." />
            <div className="ms-charts"><div className="ms-chart wide">{monthsChart}</div></div>
          </section>
        )}
      </>
    );
  }
  const n = labelTotals(input, months);
  const p = prev.kind === "value" ? labelTotals(input, prevMonths) : [];
  // Même clé que le calcul (libellé sans accents ni casse) ; libellé affiché : celui de la période N s'il existe.
  const keys = [...new Map([...p, ...n].map((t) => [t.key, t])).values()].sort((a, b) => BRUT.indexOf(a.rubric) - BRUT.indexOf(b.rubric) || a.label.localeCompare(b.label));
  const val = (list: typeof n, k: string) => list.filter((t) => t.key === k).reduce((s, t) => s + t.cents, 0);
  const prevNd = prev.kind === "nd" ? prev.nd.reason : null;
  const fixe = (w: typeof prev) => (w.kind === "value" ? w.byRubric.salaires : null);
  const variable = (w: typeof prev) => (w.kind === "value" ? w.byRubric.primes + w.byRubric.indemnites : null);
  const families = n.filter((t) => t.rubric === "primes").sort((a, b) => a.label.localeCompare(b.label));
  // Une rubrique sans aucune ligne dans le journal sur la période : le zéro est dit « aucune ligne », pas présenté comme un montant lu.
  const hasStages = n.some((t) => t.rubric === "stages");
  const tile = (id: string, label: string, a: number | null, b: number | null, foot: string, sub = false) => (
    <Tile
      testid={`fv-tile-${id}`}
      label={label}
      sub={sub}
      value={a === null ? "n.d." : euros(a)}
      nd={a === null}
      lead={foot}
      compare={<span className="tile-foot">N-1 : {b === null ? "n.d." : euros(b)}{a !== null && b !== null ? ` · écart ${eurosSigned(a - b)} · ${pct(a, b)}` : ""}</span>}
      def="fixe-variable"
    />
  );
  // Primes par famille et par mois : une seule lecture des lignes de chaque mois pour le tableau et pour le graphique.
  const primesMonths: PrimesMonth[] = cur.months.map((r) => {
    if (r.kind === "nd") return { month: r.month, kind: "nd", reason: r.nd.reason };
    const lt = labelTotals(input, [r.month]);
    return { month: r.month, kind: "value", byFamily: families.map((f) => lt.filter((t) => t.key === f.key).reduce((s, t) => s + t.cents, 0)) };
  });
  const primesSeriesList = primesSeries(families, primesMonths);
  const noPrimeMonths = primesMonths.filter((m) => m.kind === "value" && m.byFamily.every((v) => v === 0)).map((m) => m.month);
  const brutSplit = { fixe: cur.byRubric.salaires, variable: cur.byRubric.primes + cur.byRubric.indemnites, stages: cur.byRubric.stages };
  // Une nature sans montant positif n'a pas de secteur : elle est nommée sous l'anneau (son montant est dans les tuiles et le tableau).
  const omittedParts = ([["Fixe", brutSplit.fixe], ["Variable", brutSplit.variable], ["Gratifications de stage", brutSplit.stages]] as [string, number][]).filter(([, v]) => v <= 0).map(([n, v]) => `${n} (${euros(v)})`);
  // Les primes tiennent dans une demi-largeur tant que les colonnes y écrivent leurs montants (neuf mois au plus), à côté de l'anneau.
  const half = families.length > 0 && months.length <= 9;
  const half2 = half ? "ms-chart" : "ms-chart wide";
  return (
    <>
      <section className="panel">
        <PanelHead title="Fixe et variable" desc="Brut de la période par nature, comparé à la même période un an plus tôt (N-1) ; chaque chiffre renvoie à sa définition." />
        <dl className="facts ms-tiles four">
          {tile("fixe", "Fixe (salaires et congés payés)", fixe(cur), fixe(prev), "rubrique « Salaires et appointements »")}
          {tile("variable", "Variable (primes et indemnités)", variable(cur), variable(prev), "rubriques « Primes » et « Indemnités et avantages »")}
          {tile("primes", "dont primes", cur.byRubric.primes, prev.kind === "value" ? prev.byRubric.primes : null, `part du variable · ${families.length ? `${pluriel(families.length, "famille")} : ${families.map((f) => f.label).join(", ")}` : "aucune famille"}`, true)}
          {tile("stages", "Gratifications de stage", cur.byRubric.stages, prev.kind === "value" ? prev.byRubric.stages : null, hasStages ? "rubrique à part, comptée dans le brut" : "rubrique à part, comptée dans le brut ; aucune ligne dans le journal sur la période")}
        </dl>
        <NdLines lines={prevNd ? [`N-1 (${prevMonths[0]} → ${prevMonths.at(-1)}) : ${prevNd}`] : []} testid="fv-tiles-nd" />
      </section>

      {showGraph && (
        <section className="panel" data-testid="fv-graphs">
          <PanelHead title="Graphiques" desc={`Brut par nature, mois par mois et sur la période ; montants en euros.`} />
          <div className="ms-charts">
            <div className="ms-chart wide">{monthsChart}</div>
            <div className={half2}>
              <DonutChart
                testid="fv-chart-brut"
                label="Répartition du brut de la période entre fixe, variable et gratifications de stage, en euros"
                title="Répartition du brut de la période"
                parts={brutParts(brutSplit)}
                unit="eur"
                centerLabel="brut"
                note={omittedParts.length ? `Nature sans montant positif, absente de l'anneau : ${omittedParts.join(" ; ")}. Les parts sont calculées sur les natures tracées.` : undefined}
              />
            </div>
            {families.length > 0 && (
              <div className={half2}>
                {families.length <= 8 ? (
                  <BarChart
                    testid="fv-chart-primes"
                    label="Primes par famille et par mois, en euros"
                    title={`Répartition mensuelle des primes, ${year}`}
                    categories={axis.categories}
                    categoryTitles={axis.titles}
                    series={primesSeriesList}
                    unit="eur"
                    mode="stacked"
                    toggle
                    note={[
                      "Familles = libellés des lignes de prime du journal PayFit.",
                      noPrimeMonths.length ? "Un mois sans colonne n'a aucune prime (0,00 €) : il n'est pas absent." : "",
                      hueReuseNote(families.length, "familles", "fixe, variable, gratifications de stage"),
                      monthlyNote(open, primesSeriesList),
                    ].filter(Boolean).join(" ")}
                  />
                ) : (
                  <NdState
                    testid="fv-chart-primes-nd"
                    heading={`Répartition mensuelle des primes, ${year}`}
                    title="Graphique non tracé"
                    reason={<>Plus de huit familles de prime : l'empilement par mois ne tient plus lisiblement dans les huit teintes de la charte. Les montants de chaque famille, mois par mois, sont dans le tableau « Primes par famille et par mois » (affichage <a href={tableHref}>Tableau</a>).</>}
                  />
                )}
              </div>
            )}
          </div>
          <GraphFoot aff={aff} tableHref={tableHref} />
        </section>
      )}

      {showTable && (
        <>
          <section className="panel">
            <PanelHead title="Fixe et variable par mois" desc="Brut de chaque mois par nature : fixe + variable + gratifications de stage = brut ; « dont primes » est une part de la colonne Variable." />
            <ScrollTable label="Tableau du fixe et du variable par mois">
              <table className="data-table sticky sticky-first ms-table" data-testid="fv-months">
                <caption className="ms-sr">Brut par mois : fixe, variable, dont primes, gratifications de stage</caption>
                <thead>
                  <tr><th scope="col">Mois</th><th scope="col" className="num">Brut</th><th scope="col" className="num">Fixe</th><th scope="col" className="num">Variable</th><th scope="col" className="num">dont primes</th><th scope="col" className="num">Gratifications de stage</th></tr>
                </thead>
                <tbody>
                  {fvMonths.map((m) => (
                    <tr key={m.month} data-month={m.month}>
                      <th scope="row">{formatMonth(m.month)}</th>
                      {m.kind === "nd" ? (
                        <td className="num nd" colSpan={5} title={m.reason}>n.d.</td>
                      ) : (
                        <>
                          <td className="num" data-col="brut">{euros(m.brut)}</td>
                          <td className="num" data-col="fixe">{euros(m.fixe)}</td>
                          <td className="num" data-col="variable">{euros(m.variable)}</td>
                          <td className="num" data-col="primes">{euros(m.primes)}</td>
                          <td className="num" data-col="stages">{euros(m.stages)}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="total" data-testid="fv-months-total">
                    <th scope="row">Période</th>
                    <td className="num" data-col="brut">{euros(cur.brut)}</td>
                    <td className="num" data-col="fixe">{euros(brutSplit.fixe)}</td>
                    <td className="num" data-col="variable">{euros(brutSplit.variable)}</td>
                    <td className="num" data-col="primes">{euros(cur.byRubric.primes)}</td>
                    <td className="num" data-col="stages">{euros(brutSplit.stages)}</td>
                  </tr>
                </tfoot>
              </table>
            </ScrollTable>
            {ndReasons(fvMonths.map((m) => (m.kind === "nd" ? `${formatMonth(m.month)} : ${m.reason}` : null)))}
          </section>
          <section className="panel">
            <PanelHead title="Brut par libellé de paie" desc="Libellés des lignes du journal PayFit, classés par la grille de comptes." />
            <ScrollTable label="Tableau du brut par libellé de paie">
              <table className="data-table sticky sticky-first ms-table" data-testid="fv-labels">
                <caption className="ms-sr">Brut par libellé de paie, période et N-1</caption>
                <thead><tr><th scope="col">Libellé (PayFit)</th><th scope="col" className="num">{year}</th><th scope="col" className="num n1">N-1</th><th scope="col" className="num">Écart €</th><th scope="col" className="num">Écart %</th><th scope="col">Rubrique</th></tr></thead>
                <tbody>
                  {keys.map((t) => {
                    const k = t.key;
                    const a = val(n, k);
                    const b = val(p, k);
                    return (
                      <tr key={k} data-label={t.label}>
                        <th scope="row" className="wrap">{t.label}</th>
                        <td className="num" data-col="n">{euros(a)}</td>
                        <td className="num n1" data-col="n1">{prev.kind === "value" ? euros(b) : "n.d."}</td>
                        <td className="num">{prev.kind === "value" ? eurosSigned(a - b) : "n.d."}</td>
                        <td className="num">{prev.kind === "value" ? pct(a, b) : "n.d."}</td>
                        <td>{rubricLabel(t.rubric)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="total" data-testid="fv-labels-total"><th scope="row">Brut</th><td className="num" data-col="n">{euros(cur.brut)}</td><td className="num n1">{prev.kind === "value" ? euros(prev.brut) : "n.d."}</td><td className="num">{prev.kind === "value" ? eurosSigned(cur.brut - prev.brut) : "n.d."}</td><td className="num">{prev.kind === "value" ? pct(cur.brut, prev.brut) : "n.d."}</td><td /></tr>
                </tfoot>
              </table>
            </ScrollTable>
            {ndReasons([prevNd && `N-1 (${prevMonths[0]} → ${prevMonths.at(-1)}) : ${prevNd}`])}
          </section>
          <section className="panel">
            <PanelHead title="Primes par famille et par mois" desc="Une colonne par famille de prime (libellé de paie du journal PayFit) ; le total des primes est la colonne « dont primes » du tableau précédent." />
            {families.length === 0 ? (
              <p className="desc">Aucune prime sur la période (rubrique « Primes » de la grille de comptes).</p>
            ) : (
              <ScrollTable label="Tableau des primes par famille et par mois">
                <table className="data-table sticky sticky-first ms-table" data-testid="fv-primes-months">
                  <caption className="ms-sr">Primes par famille et par mois</caption>
                  <thead><tr><th scope="col">Mois</th><th scope="col" className="num">Total primes</th>{families.map((f) => <th key={f.key} scope="col" className="num">{f.label}</th>)}</tr></thead>
                  <tbody>
                    {cur.months.map((r, i) => {
                      const pm = primesMonths[i];
                      return (
                        <tr key={r.month} data-month={r.month}>
                          <th scope="row">{formatMonth(r.month)}</th>
                          <td className="num">{r.kind === "value" ? euros(r.byRubric.primes) : <span className="nd" title={r.nd.reason}>n.d.</span>}</td>
                          {families.map((f, j) => <td key={f.key} className="num">{pm.kind === "value" ? euros(pm.byFamily[j]) : <span className="nd" title={pm.reason}>n.d.</span>}</td>)}
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="total" data-testid="fv-primes-months-total">
                      <th scope="row">Période</th>
                      <td className="num">{euros(cur.byRubric.primes)}</td>
                      {families.map((f) => <td key={f.key} className="num">{euros(f.cents)}</td>)}
                    </tr>
                  </tfoot>
                </table>
              </ScrollTable>
            )}
            {ndReasons(primesMonths.map((m) => (m.kind === "nd" ? `${formatMonth(m.month)} : ${m.reason}` : null)))}
            <p className="tile-foot ms-note" data-testid="fv-non-recurrents">
              Éléments non récurrents (indemnités de rupture conventionnelle, indemnités compensatrices de congés payés) : non distingués par le journal PayFit, qui les passe avec
              les autres lignes du compte 6414 « Indemnités et avantages divers » ; ils restent dans la rubrique « Indemnités et avantages ».
            </p>
          </section>
        </>
      )}
    </>
  );
}

// --- Onglet « Paie & comptabilité » : provision de congés payés et rapprochement avec la comptabilité.
export function PaieComptaView(props: {
  slug: string;
  input: JournalInput;
  fullInput: JournalInput;
  months: string[];
  serviceFiltered: boolean;
  compta: { source: "pennylane" | "fec" | null; reason: string; lines: ComptaLine[]; months: string[]; nd: Record<string, string>; error: boolean };
  aff?: Affichage;
  tableHref?: string;
  unfilterHref?: string; // adresse de l'écran sans le filtre Service
}) {
  const { slug, input, fullInput, months, serviceFiltered, compta, aff = "tout", tableHref = "", unfilterHref } = props;
  const showGraph = aff !== "tableau";
  const showTable = aff !== "graphique";
  const last = months.at(-1)!;
  const prov = (m: string) => provisionMonth(input, m);
  const cur = prov(last);
  const n1 = prov(shiftYear(last, -1));
  type PV = Extract<ProvisionMonth, { kind: "value" }>;
  const show = (x: ProvisionMonth, pick: (v: PV) => number | null) => {
    const v = x.kind === "nd" ? null : pick(x);
    return v === null ? "n.d." : euros(v);
  };
  // Raisons des n.d. de la provision : mois n.d., ou part (congés, charges) n.d. — le total l'est alors aussi.
  const why = (x: ProvisionMonth, m: string) => (x.kind === "nd" ? `${m} : ${x.reason}` : x.missing.length ? `${m} : ${x.missing.join(" ; ")}` : null);
  const totalOf = (x: ProvisionMonth) => (x.kind === "value" ? x.total : null);
  const gapOf = (a: ProvisionMonth, b: ProvisionMonth) => {
    const ta = totalOf(a);
    const tb = totalOf(b);
    return ta === null || tb === null ? "n.d." : eurosSigned(ta - tb);
  };
  const services = fullInput.serviceAxis ? servicesOf(fullInput, [last, shiftYear(last, -1)]) : [];
  const recon = serviceFiltered ? null : compta.source ? reconcile(fullInput, compta.lines, compta.months, months, compta.nd) : null;
  const masse = windowPayroll(fullInput, months);
  const gap = compta.source ? comptaGap(compta.months, compta.nd, months) : null;
  const produits = compta.source && !gap ? operatingRevenue(compta.lines, months) : null;
  // Provision mois par mois (N et N-1) : une seule lecture pour le tableau et pour les graphiques.
  const provCur = months.map(prov);
  const provPrev = months.map((m) => prov(shiftYear(m, -1)));
  const prevMonths = months.map((m) => shiftYear(m, -1));
  const axisN = monthsAxis(months);
  const axisBoth = monthsAxis(months, prevMonths);
  const year = months[0].slice(0, 4);
  const prevYear = String(Number(year) - 1);
  const provParts = provisionParts(provCur);
  const provTotals = provisionTotals(provCur, provPrev, { cur: `Provision ${year}`, prev: `Provision ${prevYear} (N-1)` });
  // Rapprochement : mêmes lignes pour les graphiques et pour les tableaux.
  const reconAxis = recon?.kind === "value" ? monthsAxis(recon.months.map((r) => r.month)) : null;
  const reconRubrics = recon?.kind === "value" ? reconRubricChart(recon.rows.map((r) => ({ key: r.rubric, label: rubricLabel(r.rubric), journal: r.journal, compta: r.compta }))) : null;
  const donnees = `/e/${slug}/donnees`;
  // Comptabilité : le rapprochement et le ratio dépendent des mêmes données. Quand elles manquent, une seule raison est écrite, une seule fois.
  const sourceName = compta.source === "fec" ? "FEC déposés" : "API Pennylane";
  const sharedNd: { reason: string; action: { href: string; label: string } } | null = serviceFiltered
    ? null
    : compta.error
      ? { reason: "lecture de la comptabilité en erreur ; le détail est dans les journaux du serveur, rechargez la page", action: { href: donnees, label: "Vérifier la source comptable dans Données" } }
      : !compta.source
        ? { reason: /^aucune source appliquée/i.test(compta.reason) ? "aucune source comptable retenue pour ce domaine" : `aucune source comptable retenue : ${reasonText(compta.reason)}`, action: { href: donnees, label: "Connecter Pennylane ou déposer un FEC dans Données" } }
        : masse.kind === "nd"
          ? { reason: `journal de paie : ${noPeriod(masse.nd.reason)}`, action: { href: donnees, label: "Lire le journal de paie dans Données" } }
          : gap
            ? { reason: `${noPeriod(gap)} (source comptable : ${sourceName})`, action: { href: donnees, label: "Compléter la comptabilité dans Données" } }
            : null;
  const ratioText =
    masse.kind === "nd" || produits === null
      ? null
      : produits <= 0
        ? "n.d. — aucun produit d'exploitation (comptes 70 à 75) sur la période"
        : `${fmtPercent({ num: masse.masse, den: produits })} — masse chargée ${euros(masse.masse)} ÷ produits d'exploitation ${euros(produits)}`;
  return (
    <>
      <section className="panel" data-testid="pc-provision">
        <PanelHead title="Que doit l'entreprise en congés payés ?" desc="Provision à fin de mois, charges sociales comprises ; comparée à la même fin de mois un an plus tôt (N-1)." />
        {(() => {
          const tile = (
            <dl className="facts ms-tiles single">
              <Tile
                testid="pc-tile-provision"
                main
                label={`Provision fin ${lowerMonth(last)}`}
                value={totalOf(cur) === null ? `n.d. — ${why(cur, last)}` : euros(totalOf(cur)!)}
                nd={totalOf(cur) === null}
                ndLong
                lead={`congés payés ${show(cur, (v) => v.conges)} + charges sociales ${show(cur, (v) => v.charges)}`}
                compare={<span className="tile-foot" data-testid="pc-tile-provision-n1">fin {lowerMonth(shiftYear(last, -1))} : {totalOf(n1) === null ? `n.d. — ${why(n1, shiftYear(last, -1))}` : euros(totalOf(n1)!)}{totalOf(cur) !== null && totalOf(n1) !== null ? ` · écart ${gapOf(cur, n1)}` : ""}</span>}
                def="provision"
              />
            </dl>
          );
          if (!showGraph) return tile;
          const partsChart = (
            <ChartGuard testid="pc-chart-provision" title={`Provision fin de mois, ${year}`} series={provParts}>
              <BarChart
                testid="pc-chart-provision"
                label={`Provision de congés payés à fin de mois, ${year}, congés payés et charges sociales, en euros`}
                title={`Provision fin de mois, ${year}`}
                categories={axisN.categories}
                categoryTitles={axisN.titles}
                series={provParts}
                unit="eur"
                mode="stacked"
                toggle
                note={["Congés payés + charges sociales = provision du mois.", provParts.some((s) => s.values.some((v) => v === null)) ? "Une part n.d. (sans ligne de dotation « Mois courant ») n'est pas tracée et rend le total n.d." : ""].filter(Boolean).join(" ")}
              />
            </ChartGuard>
          );
          return (
            <div className="ms-charts" data-testid="pc-graphs">
              <div className="ms-chart wide">
                {months.length > 9 ? (
                  <>
                    {tile}
                    <div className="ms-table-gap">{partsChart}</div>
                  </>
                ) : (
                  <div className="ms-charts-split ms-tile-split">
                    {tile}
                    <div className="ms-chart">{partsChart}</div>
                  </div>
                )}
              </div>
              <div className="ms-chart wide">
                <ChartGuard testid="pc-chart-provision-n1" title={`Total de la provision, ${year} face à ${prevYear} (N-1)`} series={provTotals}>
                  <LineChart
                    testid="pc-chart-provision-n1"
                    label={`Total de la provision à fin de mois, ${year} et ${prevYear}, en euros`}
                    title={`Total de la provision, ${year} face à ${prevYear} (N-1)`}
                    categories={axisBoth.categories}
                    categoryTitles={axisBoth.titles}
                    series={provTotals}
                    unit="eur"
                    note={ndNote(provTotals, "courbe") || undefined}
                  />
                </ChartGuard>
              </div>
            </div>
          );
        })()}
        {showGraph && !showTable && ndReasons(months.flatMap((m, i) => [why(provCur[i], m), why(provPrev[i], shiftYear(m, -1))]))}
        {showGraph && <GraphFoot aff={aff} tableHref={tableHref} />}
        {showTable && (
          <>
            <ScrollTable label="Tableau de la provision de congés payés par mois">
              <table className="data-table sticky sticky-first ms-table" data-testid="pc-provision-months">
                <caption className="ms-sr">Provision de congés payés à fin de mois, N et N-1</caption>
                <thead><tr><th scope="col">Fin de mois</th><th scope="col" className="num">Total</th><th scope="col" className="num n1">Total N-1</th><th scope="col" className="num">Écart</th><th scope="col" className="num">dont congés payés</th><th scope="col" className="num">dont charges sociales</th></tr></thead>
                <tbody>
                  {months.map((m, i) => {
                    const a = provCur[i];
                    const b = provPrev[i];
                    return (
                      <tr key={m} data-month={m}>
                        <th scope="row">{formatMonth(m)}</th>
                        <td className="num" data-col="total">{show(a, (v) => v.total)}</td>
                        <td className="num n1" data-col="total-n1">{show(b, (v) => v.total)}</td>
                        <td className="num">{gapOf(a, b)}</td>
                        <td className="num">{show(a, (v) => v.conges)}</td>
                        <td className="num">{show(a, (v) => v.charges)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollTable>
            {ndReasons(months.flatMap((m, i) => [why(provCur[i], m), why(provPrev[i], shiftYear(m, -1))]))}
            {services.length > 0 && !serviceFiltered && (
              <div className="ms-table-gap">
                <ScrollTable label="Tableau de la provision de congés payés par service">
                  <table className="data-table sticky sticky-first ms-table" data-testid="pc-provision-services">
                    <caption className="ms-sr">Provision de congés payés par service, fin {lowerMonth(last)}</caption>
                    <thead><tr><th scope="col">Service, fin {lowerMonth(last)}</th><th scope="col" className="num">Total</th><th scope="col" className="num n1">Total N-1</th><th scope="col" className="num">Écart</th><th scope="col" className="num">dont congés payés</th><th scope="col" className="num">dont charges sociales</th></tr></thead>
                    <tbody>
                      {services.map((s) => {
                        const a = provisionMonth(withService(fullInput, s), last);
                        const b = provisionMonth(withService(fullInput, s), shiftYear(last, -1));
                        return (
                          <tr key={s ?? "__nv__"} data-service={s ?? "__nv__"}>
                            <th scope="row">{s ?? "Non ventilé"}</th>
                            <td className="num" data-col="total">{show(a, (v) => v.total)}</td>
                            <td className="num n1">{show(b, (v) => v.total)}</td>
                            <td className="num">{gapOf(a, b)}</td>
                            <td className="num">{show(a, (v) => v.conges)}</td>
                            <td className="num">{show(a, (v) => v.charges)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </ScrollTable>
                {ndReasons(services.flatMap((s) => [last, shiftYear(last, -1)].map((m) => why(provisionMonth(withService(fullInput, s), m), `${s ?? "Non ventilé"} ${m}`))))}
              </div>
            )}
          </>
        )}
      </section>

      <section className="panel" data-testid="pc-recon">
        <PanelHead title="Comptabilité" desc="Rapprochement des comptes 63 et 64 du journal de paie avec la comptabilité (mêmes mois, même grille), puis poids de la masse salariale dans les produits d'exploitation." />
        {serviceFiltered ? (
          <NdState
            testid="pc-recon-nd"
            reason="Avec le filtre Service, le rapprochement et le ratio ne sont pas calculés : la comptabilité ne porte pas le code analytique du journal de paie. Ils se lisent sur le total entreprise."
            action={unfilterHref ? { href: unfilterHref, label: "Retirer le filtre Service" } : undefined}
          />
        ) : sharedNd ? (
          <NdState testid="pc-recon-nd" reason={`Rapprochement et ratio : ${sharedNd.reason}.`} action={sharedNd.action} />
        ) : (
          <>
            <p className="desc">Source comptable : {sourceName} · {compta.reason}</p>
            {recon?.kind === "value" && (
              <>
                <h3 className="ms-sub">Rapprochement des comptes 63 et 64</h3>
                {showGraph && reconAxis && reconRubrics && (
                  <>
                    <div className="ms-charts" data-testid="pc-recon-graphs">
                      <div className="ms-chart">
                        <BarChart
                          testid="pc-chart-recon-months"
                          label="Rapprochement par mois : journal de paie et comptabilité, comptes 63 et 64, en euros"
                          title="Journal de paie et comptabilité, par mois"
                          categories={reconAxis.categories}
                          categoryTitles={reconAxis.titles}
                          series={reconMonthSeries(recon.months)}
                          unit="eur"
                          note="Écart = journal de paie − comptabilité (dans le tableau)."
                        />
                      </div>
                      <div className="ms-chart">
                        <BarChart
                          testid="pc-chart-recon-rubrics"
                          label="Rapprochement par rubrique : journal de paie et comptabilité, en euros"
                          title="Journal de paie et comptabilité, par rubrique"
                          categories={reconRubrics.categories}
                          categoryTitles={reconRubrics.titles}
                          series={reconRubrics.series}
                          unit="eur"
                          note="Écart par rubrique = journal de paie − comptabilité ; noms complets des rubriques dans l'infobulle."
                        />
                      </div>
                    </div>
                    <GraphFoot aff={aff} tableHref={tableHref} testid="pc-recon-graph-foot" />
                  </>
                )}
                {showTable && (
                  <>
                    <ScrollTable label="Tableau du rapprochement par rubrique">
                      <table className="data-table sticky sticky-first ms-table" data-testid="pc-recon-rubrics">
                        <caption className="ms-sr">Rapprochement par rubrique : journal de paie et comptabilité</caption>
                        <thead><tr><th scope="col">Rubrique</th><th scope="col" className="num">Écart</th><th scope="col" className="num">Journal de paie</th><th scope="col" className="num">Comptabilité</th></tr></thead>
                        <tbody>
                          {recon.rows.map((r) => (
                            <tr key={r.rubric} data-rubric={r.rubric}>
                              <th scope="row">{rubricLabel(r.rubric)}</th>
                              <td className="num" data-col="ecart">{eurosSigned(r.ecart)}</td>
                              <td className="num">{euros(r.journal)}</td>
                              <td className="num">{euros(r.compta)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="total" data-testid="pc-recon-total"><th scope="row">Total comptes 63/64</th><td className="num" data-col="ecart">{eurosSigned(recon.ecart)}</td><td className="num">{euros(recon.journal)}</td><td className="num">{euros(recon.compta)}</td></tr>
                        </tfoot>
                      </table>
                    </ScrollTable>
                    <ScrollTable gap label="Tableau du rapprochement par mois">
                      <table className="data-table sticky sticky-first ms-table" data-testid="pc-recon-months">
                        <caption className="ms-sr">Rapprochement par mois : journal de paie et comptabilité</caption>
                        <thead><tr><th scope="col">Mois</th><th scope="col" className="num">Écart</th><th scope="col" className="num">Journal de paie</th><th scope="col" className="num">Comptabilité</th></tr></thead>
                        <tbody>
                          {recon.months.map((m) => (
                            <tr key={m.month} data-month={m.month}><th scope="row">{formatMonth(m.month)}</th><td className="num" data-col="ecart">{eurosSigned(m.journal - m.compta)}</td><td className="num">{euros(m.journal)}</td><td className="num">{euros(m.compta)}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </ScrollTable>
                  </>
                )}
              </>
            )}
            <div className="ms-ratio" data-testid="pc-ratio">
              <h3 className="ms-sub">Masse salariale ÷ produits d'exploitation</h3>
              <p data-testid="pc-ratio-value">{ratioText ?? "n.d. — produits d'exploitation (comptes 70 à 75) non disponibles"}</p>
            </div>
          </>
        )}
      </section>
    </>
  );
}
