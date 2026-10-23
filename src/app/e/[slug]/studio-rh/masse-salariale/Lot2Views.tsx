import { BarChart, DonutChart, LineChart } from "@/components/charts";
import { formatMonth } from "@/lib/dates";
import { formatEuros } from "@/lib/money";
import { servicesOf, shiftYear, windowPayroll, withService, type JournalInput } from "@/lib/payroll/engine";
import { RUBRICS, type RubricId } from "@/lib/payroll/grid";
import { comptaGap, labelTotals, operatingRevenue, provisionMonth, reconcile, type ComptaLine, type ProvisionMonth } from "@/lib/payroll/lot2";
import { fmtPercent } from "@/lib/rh/kpi/format";
import { brutParts, fixeVariableMonths, fixeVariableSeries, monthsAxis, primesSeries, provisionParts, provisionTotals, reconMonthSeries, reconRubricChart, type PrimesMonth } from "@/lib/viz/masse";
import { ChartGuard, GraphFoot, monthlyNote, NdLines, PanelTitle, ScrollTable, Tile, type Affichage } from "./components";

const lowerMonth = (m: string) => formatMonth(m).toLowerCase();
const signed = (c: number) => `${c > 0 ? "+" : ""}${formatEuros(c)}`;
const pct = (a: number, b: number) => (b === 0 ? "n.d. (N-1 nul)" : b < 0 ? "n.d. (N-1 négatif)" : `${a - b > 0 ? "+" : ""}${fmtPercent({ num: a - b, den: b })}`);
const rubricLabel = (id: RubricId | "non-classe") => (id === "non-classe" ? "Comptes 63/64 non classés" : (RUBRICS.find((r) => r.id === id)?.label ?? id));
const ERR = "lecture de la comptabilité en erreur (détail dans les journaux du serveur) : rechargez la page ou vérifiez la source comptable dans Données";
const BRUT: RubricId[] = ["salaires", "primes", "stages", "indemnites"];
// Raisons des n.d. d'un tableau, listées sous le tableau (jamais seulement en infobulle).
const ndReasons = (reasons: (string | null | undefined)[]) => {
  const list = [...new Set(reasons.filter((r): r is string => Boolean(r)))];
  return list.length ? <p className="tile-foot nd" data-testid="nd-reasons">n.d. : {list.join(" ; ")}</p> : null;
};

// --- Onglet « Fixe & variable » : brut par rubrique et par libellé de paie PayFit, N et N-1, primes par famille et par mois.
export function FixeVariableView({ input, months, prevMonths, aff = "tout", tableHref = "" }: { input: JournalInput; months: string[]; prevMonths: string[]; aff?: Affichage; tableHref?: string }) {
  const cur = windowPayroll(input, months);
  const prev = windowPayroll(input, prevMonths);
  const showGraph = aff !== "tableau";
  const showTable = aff !== "graphique";
  // Fixe, variable et gratifications de stage mois par mois : mêmes valeurs que le tableau « Fixe et variable par mois ».
  const fvMonths = fixeVariableMonths(cur.months);
  const open = cur.months.filter((r) => r.open).map((r) => r.month);
  const axis = monthsAxis(months, [], open);
  const fvSeries = fixeVariableSeries(fvMonths);
  const monthsChart = (
    <ChartGuard testid="fv-chart-months" title="Fixe et variable par mois" series={fvSeries}>
      <BarChart
        testid="fv-chart-months"
        label={`Brut par mois, fixe, variable et gratifications de stage, ${months[0].slice(0, 4)}, en euros`}
        title="Fixe et variable par mois"
        categories={axis.categories}
        categoryTitles={axis.titles}
        series={fvSeries}
        unit="eur"
        mode="stacked"
        toggle
        note={`Fixe + variable + gratifications de stage = brut du mois. ${monthlyNote(open)}`}
      />
    </ChartGuard>
  );
  if (cur.kind === "nd") {
    return (
      <>
        <p className="nd" data-testid="fv-nd">n.d. — {cur.nd.reason}</p>
        {showGraph && (
          <section className="panel" data-testid="fv-graphs">
            <PanelTitle title="Graphiques" desc="Mois par mois ; les mois n.d. sont hachurés, avec leur raison." />
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
  const tile = (id: string, label: string, a: number | null, b: number | null, foot: string) => (
    <Tile
      testid={`fv-tile-${id}`}
      label={label}
      value={a === null ? "n.d." : formatEuros(a)}
      lead={foot}
      compare={<span className="tile-foot">N-1 : {b === null ? "n.d." : formatEuros(b)}{a !== null && b !== null ? ` · ${signed(a - b)} · ${pct(a, b)}` : ""}</span>}
      def="fixe-variable"
    />
  );
  // Primes par famille et par mois : une seule lecture des lignes de chaque mois pour le tableau et pour le graphique.
  const primesMonths: PrimesMonth[] = cur.months.map((r) => {
    if (r.kind === "nd") return { month: r.month, kind: "nd", reason: r.nd.reason };
    const lt = labelTotals(input, [r.month]);
    return { month: r.month, kind: "value", byFamily: families.map((f) => lt.filter((t) => t.key === f.key).reduce((s, t) => s + t.cents, 0)) };
  });
  const brutSplit = { fixe: cur.byRubric.salaires, variable: cur.byRubric.primes + cur.byRubric.indemnites, stages: cur.byRubric.stages };
  // Une nature sans montant positif n'a pas de secteur : elle est nommée sous l'anneau (son montant est dans les tuiles et le tableau).
  const omittedParts = ([["Fixe", brutSplit.fixe], ["Variable", brutSplit.variable], ["Gratifications de stage", brutSplit.stages]] as [string, number][]).filter(([, v]) => v <= 0).map(([n, v]) => `${n} (${formatEuros(v)})`);
  return (
    <>
      <section className="panel">
        <PanelTitle title="Fixe et variable" desc="Brut de la période par nature, comparé à la même période un an plus tôt (N-1) ; chaque chiffre renvoie à sa définition." />
        <dl className="facts ms-tiles">
          {tile("fixe", "Fixe (salaires et congés payés)", fixe(cur), fixe(prev), "rubrique « Salaires et appointements »")}
          {tile("variable", "Variable (primes et indemnités)", variable(cur), variable(prev), "rubriques « Primes » et « Indemnités et avantages »")}
          {tile("primes", "dont primes", cur.byRubric.primes, prev.kind === "value" ? prev.byRubric.primes : null, `${families.length} famille(s) : ${families.map((f) => f.label).join(", ") || "aucune"}`)}
          {tile("stages", "Gratifications de stage", cur.byRubric.stages, prev.kind === "value" ? prev.byRubric.stages : null, "rubrique à part, comptée dans le brut")}
        </dl>
        <NdLines lines={prevNd ? [`N-1 (${prevMonths[0]} → ${prevMonths.at(-1)}) : ${prevNd}`] : []} testid="fv-tiles-nd" />
      </section>

      {showGraph && (
        <section className="panel" data-testid="fv-graphs">
          <PanelTitle title="Graphiques" desc="Brut par nature, mois par mois et sur la période ; montants en euros." />
          <div className="ms-charts">
            <div className="ms-chart wide">
              <div className="ms-charts-split">
                <div className="ms-chart">
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
                <div className="ms-chart">{monthsChart}</div>
              </div>
            </div>
            {families.length > 0 && (
              <div className="ms-chart wide">
                {families.length <= 8 ? (
                  <BarChart
                    testid="fv-chart-primes"
                    label="Primes par famille et par mois, en euros"
                    title="Primes par famille et par mois"
                    categories={axis.categories}
                    categoryTitles={axis.titles}
                    series={primesSeries(families, primesMonths)}
                    unit="eur"
                    mode="stacked"
                    toggle
                    note={`Familles = libellés des lignes de prime du journal PayFit. ${monthlyNote(open)}`}
                  />
                ) : (
                  <div className="ms-nd-block" data-testid="fv-chart-primes-nd">
                    <h3 className="ms-sub">Primes par famille et par mois</h3>
                    <p className="nd">Plus de huit familles de prime : l'empilement par mois ne tient plus lisiblement dans les huit teintes de la charte. Les montants de chaque famille, mois par mois, sont dans le tableau « Primes par famille et par mois » (affichage <a href={tableHref}>Tableau</a>).</p>
                  </div>
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
            <PanelTitle title="Fixe et variable par mois" desc="Brut de chaque mois par nature : fixe + variable + gratifications de stage = brut ; « dont primes » est une part de la colonne Variable." />
            <ScrollTable label="Tableau du fixe et du variable par mois">
              <table className="data-table sticky sticky-first ms-table" data-testid="fv-months">
                <caption className="ms-sr">Brut par mois : fixe, variable, dont primes, gratifications de stage</caption>
                <thead>
                  <tr><th scope="col">Mois</th><th scope="col" className="num">Fixe</th><th scope="col" className="num">Variable</th><th scope="col" className="num">dont primes</th><th scope="col" className="num">Gratifications de stage</th><th scope="col" className="num">Brut</th></tr>
                </thead>
                <tbody>
                  {fvMonths.map((m) => (
                    <tr key={m.month} data-month={m.month}>
                      <th scope="row">{formatMonth(m.month)}</th>
                      {m.kind === "nd" ? (
                        <td className="num nd" colSpan={5} title={m.reason}>n.d.</td>
                      ) : (
                        <>
                          <td className="num" data-col="fixe">{formatEuros(m.fixe)}</td>
                          <td className="num" data-col="variable">{formatEuros(m.variable)}</td>
                          <td className="num" data-col="primes">{formatEuros(m.primes)}</td>
                          <td className="num" data-col="stages">{formatEuros(m.stages)}</td>
                          <td className="num" data-col="brut">{formatEuros(m.brut)}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr data-testid="fv-months-total">
                    <th scope="row">Période</th>
                    <td className="num" data-col="fixe">{formatEuros(brutSplit.fixe)}</td>
                    <td className="num" data-col="variable">{formatEuros(brutSplit.variable)}</td>
                    <td className="num" data-col="primes">{formatEuros(cur.byRubric.primes)}</td>
                    <td className="num" data-col="stages">{formatEuros(brutSplit.stages)}</td>
                    <td className="num" data-col="brut">{formatEuros(cur.brut)}</td>
                  </tr>
                </tfoot>
              </table>
            </ScrollTable>
          </section>
          <section className="panel">
            <PanelTitle title="Brut par libellé de paie" desc="Libellés des lignes du journal PayFit, classés par la grille de comptes." />
            <ScrollTable label="Tableau du brut par libellé de paie">
              <table className="data-table sticky ms-table" data-testid="fv-labels">
                <caption className="ms-sr">Brut par libellé de paie, période et N-1</caption>
                <thead><tr><th scope="col">Rubrique</th><th scope="col">Libellé (PayFit)</th><th scope="col" className="num n1">N-1</th><th scope="col" className="num">N</th><th scope="col" className="num">Écart €</th><th scope="col" className="num">Écart %</th></tr></thead>
                <tbody>
                  {keys.map((t) => {
                    const k = t.key;
                    const a = val(n, k);
                    const b = val(p, k);
                    return (
                      <tr key={k} data-label={t.label}>
                        <td>{rubricLabel(t.rubric)}</td>
                        <td className="wrap">{t.label}</td>
                        <td className="num n1" data-col="n1">{prev.kind === "value" ? formatEuros(b) : "n.d."}</td>
                        <td className="num" data-col="n">{formatEuros(a)}</td>
                        <td className="num">{prev.kind === "value" ? signed(a - b) : "n.d."}</td>
                        <td className="num">{prev.kind === "value" ? pct(a, b) : "n.d."}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr data-testid="fv-labels-total"><td colSpan={2}>Brut</td><td className="num n1">{prev.kind === "value" ? formatEuros(prev.brut) : "n.d."}</td><td className="num" data-col="n">{formatEuros(cur.brut)}</td><td className="num">{prev.kind === "value" ? signed(cur.brut - prev.brut) : "n.d."}</td><td className="num">{prev.kind === "value" ? pct(cur.brut, prev.brut) : "n.d."}</td></tr>
                </tfoot>
              </table>
            </ScrollTable>
            {ndReasons([prevNd && `N-1 (${prevMonths[0]} → ${prevMonths.at(-1)}) : ${prevNd}`])}
          </section>
          <section className="panel">
            <PanelTitle title="Primes par famille et par mois" />
            {families.length === 0 ? (
              <p className="desc">Aucune prime sur la période (rubrique « Primes » de la grille de comptes).</p>
            ) : (
              <ScrollTable label="Tableau des primes par famille et par mois">
                <table className="data-table sticky sticky-first ms-table" data-testid="fv-primes-months">
                  <caption className="ms-sr">Primes par famille et par mois</caption>
                  <thead><tr><th scope="col">Mois</th>{families.map((f) => <th key={f.key} scope="col" className="num">{f.label}</th>)}<th scope="col" className="num">Total primes</th></tr></thead>
                  <tbody>
                    {cur.months.map((r, i) => {
                      const pm = primesMonths[i];
                      return (
                        <tr key={r.month} data-month={r.month}>
                          <th scope="row">{formatMonth(r.month)}</th>
                          {families.map((f, j) => <td key={f.key} className="num">{pm.kind === "value" ? formatEuros(pm.byFamily[j]) : "n.d."}</td>)}
                          <td className="num">{r.kind === "value" ? formatEuros(r.byRubric.primes) : "n.d."}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </ScrollTable>
            )}
            <p className="tile-foot" data-testid="fv-non-recurrents">
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
}) {
  const { slug, input, fullInput, months, serviceFiltered, compta, aff = "tout", tableHref = "" } = props;
  const showGraph = aff !== "tableau";
  const showTable = aff !== "graphique";
  const last = months.at(-1)!;
  const prov = (m: string) => provisionMonth(input, m);
  const cur = prov(last);
  const n1 = prov(shiftYear(last, -1));
  type PV = Extract<ProvisionMonth, { kind: "value" }>;
  const show = (x: ProvisionMonth, pick: (v: PV) => number | null) => {
    const v = x.kind === "nd" ? null : pick(x);
    return v === null ? "n.d." : formatEuros(v);
  };
  // Raisons des n.d. de la provision : mois n.d., ou part (congés, charges) n.d. — le total l'est alors aussi.
  const why = (x: ProvisionMonth, m: string) => (x.kind === "nd" ? `${m} : ${x.reason}` : x.missing.length ? `${m} : ${x.missing.join(" ; ")}` : null);
  const totalOf = (x: ProvisionMonth) => (x.kind === "value" ? x.total : null);
  const gapOf = (a: ProvisionMonth, b: ProvisionMonth) => {
    const ta = totalOf(a);
    const tb = totalOf(b);
    return ta === null || tb === null ? "n.d." : signed(ta - tb);
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
  const wide = months.length > 9 ? "ms-chart wide" : "ms-chart";
  const axisBoth = monthsAxis(months, prevMonths);
  const year = months[0].slice(0, 4);
  const prevYear = String(Number(year) - 1);
  const provParts = provisionParts(provCur);
  const provTotals = provisionTotals(provCur, provPrev, { cur: `Provision ${year}`, prev: `Provision ${prevYear} (N-1)` });
  // Rapprochement : mêmes lignes pour les graphiques et pour les tableaux.
  const reconAxis = recon?.kind === "value" ? monthsAxis(recon.months.map((r) => r.month)) : null;
  const reconRubrics = recon?.kind === "value" ? reconRubricChart(recon.rows.map((r) => ({ key: r.rubric, label: rubricLabel(r.rubric), journal: r.journal, compta: r.compta }))) : null;
  return (
    <>
      <section className="panel" data-testid="pc-provision">
        <PanelTitle title="Que doit l'entreprise en congés payés ?" desc="Provision à fin de mois, charges sociales comprises." />
        <dl className="facts ms-tiles single">
          <Tile
            testid="pc-tile-provision"
            main
            label={`Provision fin ${lowerMonth(last)}`}
            value={totalOf(cur) === null ? `n.d. — ${why(cur, last)}` : formatEuros(totalOf(cur)!)}
            nd={totalOf(cur) === null}
            ndLong
            lead={`congés payés ${show(cur, (v) => v.conges)} + charges sociales ${show(cur, (v) => v.charges)}`}
            compare={<span className="tile-foot" data-testid="pc-tile-provision-n1">fin {lowerMonth(shiftYear(last, -1))} : {totalOf(n1) === null ? `n.d. — ${why(n1, shiftYear(last, -1))}` : formatEuros(totalOf(n1)!)}{totalOf(cur) !== null && totalOf(n1) !== null ? ` · ${gapOf(cur, n1)}` : ""}</span>}
            def="provision"
          />
        </dl>
        {showGraph && (
          <div className="ms-charts" data-testid="pc-graphs">
            <div className={wide}>
              <ChartGuard testid="pc-chart-provision" title={`Provision fin de mois — ${year}`} series={provParts}>
                <BarChart
                  testid="pc-chart-provision"
                  label={`Provision de congés payés à fin de mois, ${year}, congés payés et charges sociales, en euros`}
                  title={`Provision fin de mois — ${year}`}
                  categories={axisN.categories}
                  categoryTitles={axisN.titles}
                  series={provParts}
                  unit="eur"
                  mode="stacked"
                  toggle
                  note="Congés payés + charges sociales = provision du mois ; une part n.d. (sans ligne de dotation « Mois courant ») n'est pas tracée et rend le total n.d."
                />
              </ChartGuard>
            </div>
            <div className={wide}>
              <ChartGuard testid="pc-chart-provision-n1" title={`Total de la provision — ${year} face à ${prevYear} (N-1)`} series={provTotals}>
                <LineChart
                  testid="pc-chart-provision-n1"
                  label={`Total de la provision à fin de mois, ${year} et ${prevYear}, en euros`}
                  title={`Total de la provision — ${year} face à ${prevYear} (N-1)`}
                  categories={axisBoth.categories}
                  categoryTitles={axisBoth.titles}
                  series={provTotals}
                  unit="eur"
                  note="Un total n.d. interrompt la courbe ; sa raison est dans l'infobulle et sous le tableau."
                />
              </ChartGuard>
            </div>
          </div>
        )}
        {showGraph && !showTable && ndReasons(months.flatMap((m, i) => [why(provCur[i], m), why(provPrev[i], shiftYear(m, -1))]))}
        {showGraph && <GraphFoot aff={aff} tableHref={tableHref} />}
        {showTable && (
          <>
            <ScrollTable label="Tableau de la provision de congés payés par mois">
              <table className="data-table sticky sticky-first ms-table" data-testid="pc-provision-months">
                <caption className="ms-sr">Provision de congés payés à fin de mois, N et N-1</caption>
                <thead><tr><th scope="col">Fin de mois</th><th scope="col" className="num">Congés payés</th><th scope="col" className="num">Charges sociales</th><th scope="col" className="num">Total</th><th scope="col" className="num n1">Total N-1</th><th scope="col" className="num">Écart</th></tr></thead>
                <tbody>
                  {months.map((m, i) => {
                    const a = provCur[i];
                    const b = provPrev[i];
                    return (
                      <tr key={m} data-month={m}>
                        <th scope="row">{formatMonth(m)}</th>
                        <td className="num">{show(a, (v) => v.conges)}</td>
                        <td className="num">{show(a, (v) => v.charges)}</td>
                        <td className="num" data-col="total">{show(a, (v) => v.total)}</td>
                        <td className="num n1" data-col="total-n1">{show(b, (v) => v.total)}</td>
                        <td className="num">{gapOf(a, b)}</td>
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
                  <thead><tr><th scope="col">Service — fin {lowerMonth(last)}</th><th scope="col" className="num">Congés payés</th><th scope="col" className="num">Charges sociales</th><th scope="col" className="num">Total</th><th scope="col" className="num n1">Total N-1</th><th scope="col" className="num">Écart</th></tr></thead>
                  <tbody>
                    {services.map((s) => {
                      const a = provisionMonth(withService(fullInput, s), last);
                      const b = provisionMonth(withService(fullInput, s), shiftYear(last, -1));
                      return (
                        <tr key={s ?? "__nv__"} data-service={s ?? "__nv__"}>
                          <td>{s ?? "Non ventilé"}</td>
                          <td className="num">{show(a, (v) => v.conges)}</td>
                          <td className="num">{show(a, (v) => v.charges)}</td>
                          <td className="num" data-col="total">{show(a, (v) => v.total)}</td>
                          <td className="num n1">{show(b, (v) => v.total)}</td>
                          <td className="num">{gapOf(a, b)}</td>
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
        <PanelTitle title="Rapprochement avec la comptabilité" desc="Comptes 63 et 64 du journal de paie et de la comptabilité, mêmes mois, même grille." />
        {serviceFiltered ? (
          <p className="desc">Disponible sur le total entreprise (sans filtre Service) : la comptabilité ne porte pas le code analytique du journal de paie.</p>
        ) : compta.error ? (
          <p className="nd" data-testid="pc-recon-nd">n.d. — {ERR}</p>
        ) : !compta.source ? (
          <p className="nd" data-testid="pc-recon-nd">n.d. — aucune source comptable retenue ({compta.reason}) : connectez Pennylane ou déposez un FEC dans <a href={`/e/${slug}/donnees`}>Données</a>.</p>
        ) : recon?.kind === "nd" ? (
          <p className="nd" data-testid="pc-recon-nd">n.d. — {recon.reason} (source comptable : {compta.source === "fec" ? "FEC" : "API Pennylane"}).</p>
        ) : recon ? (
          <>
            <p className="desc">Source comptable : {compta.source === "fec" ? "FEC déposés" : "API Pennylane"} · {compta.reason}</p>
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
                      note="Comptes 63 et 64 : écart = journal de paie − comptabilité (dans le tableau)."
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
                      note="Écart par rubrique = journal de paie − comptabilité (dans le tableau) ; noms complets des rubriques dans l'infobulle."
                    />
                  </div>
                </div>
                <GraphFoot aff={aff} tableHref={tableHref} testid="pc-recon-graph-foot" />
              </>
            )}
            {showTable && (
              <>
                <ScrollTable label="Tableau du rapprochement par rubrique">
                  <table className="data-table sticky ms-table" data-testid="pc-recon-rubrics">
                    <caption className="ms-sr">Rapprochement par rubrique : journal de paie et comptabilité</caption>
                    <thead><tr><th scope="col">Rubrique</th><th scope="col" className="num">Journal de paie</th><th scope="col" className="num">Comptabilité</th><th scope="col" className="num">Écart</th></tr></thead>
                    <tbody>
                      {recon.rows.map((r) => (
                        <tr key={r.rubric} data-rubric={r.rubric}>
                          <td>{rubricLabel(r.rubric)}</td>
                          <td className="num">{formatEuros(r.journal)}</td>
                          <td className="num">{formatEuros(r.compta)}</td>
                          <td className="num" data-col="ecart">{signed(r.ecart)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr data-testid="pc-recon-total"><td>Total comptes 63/64</td><td className="num">{formatEuros(recon.journal)}</td><td className="num">{formatEuros(recon.compta)}</td><td className="num" data-col="ecart">{signed(recon.ecart)}</td></tr>
                    </tfoot>
                  </table>
                </ScrollTable>
                <ScrollTable gap label="Tableau du rapprochement par mois">
                  <table className="data-table sticky sticky-first ms-table" data-testid="pc-recon-months">
                    <caption className="ms-sr">Rapprochement par mois : journal de paie et comptabilité</caption>
                    <thead><tr><th scope="col">Mois</th><th scope="col" className="num">Journal de paie</th><th scope="col" className="num">Comptabilité</th><th scope="col" className="num">Écart</th></tr></thead>
                    <tbody>
                      {recon.months.map((m) => (
                        <tr key={m.month} data-month={m.month}><th scope="row">{formatMonth(m.month)}</th><td className="num">{formatEuros(m.journal)}</td><td className="num">{formatEuros(m.compta)}</td><td className="num" data-col="ecart">{signed(m.journal - m.compta)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollTable>
              </>
            )}
          </>
        ) : null}
      </section>

      <section className="panel" data-testid="pc-ratio">
        <PanelTitle title="Masse salariale ÷ produits d'exploitation" />
        <p data-testid="pc-ratio-value">
          {serviceFiltered
            ? "Disponible sur le total entreprise (sans filtre Service)."
            : masse.kind === "nd"
              ? `n.d. — ${masse.nd.reason}`
              : produits === null
                ? `n.d. — ${compta.error ? ERR : compta.source ? gap : `aucune source comptable retenue (${compta.reason}) : produits d'exploitation 70 à 75`}`
                : produits <= 0
                  ? "n.d. — aucun produit d'exploitation (comptes 70 à 75) sur la période"
                  : `${fmtPercent({ num: masse.masse, den: produits })} — masse chargée ${formatEuros(masse.masse)} ÷ produits d'exploitation ${formatEuros(produits)}`}
        </p>
      </section>
    </>
  );
}
