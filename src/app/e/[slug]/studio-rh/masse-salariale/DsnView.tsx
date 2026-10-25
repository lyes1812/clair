import { MoneyText, MoneyUnitLabel } from "@/components/Money";
import { BarChart } from "@/components/charts";
import { GlossaryLink } from "@/components/GlossaryLink";
import { ViewSwitch } from "@/components/ViewSwitch";
import { formatMonth } from "@/lib/dates";
import { MASSE_TERMS } from "@/lib/glossary/masse";
import { dsnBrutWindow, type DsnMonth, type DsnWindow } from "@/lib/payroll/dsn";
import { shiftYear } from "@/lib/payroll/engine";
import { STUDIO_RH_ITEMS } from "@/lib/nav";
import { fmtPercent } from "@/lib/rh/kpi/format";
import { dsnPoint, dsnSeries, euros, eurosSigned, hasNd, monthShortYear, monthsAxis, ndGroups, ndLines, numTrend, reasonLines, trendOf } from "@/lib/viz/masse";
import { AFFICHAGES, ChartGuard, GraphFoot, isAffichage, MM, MONTH_NAMES, monthShort, MsHead, MsRead, NdKey, NdLines, NdState, PanelHead, PeriodBar, ScrollTable, Tile, TrendLegend, type Affichage } from "./components";

// Masse salariale quand la source RH retenue est la DSN : brut déclaré (S21.G00.51 type 001) des déclarations qui font
// foi. Les cotisations patronales ne sont pas portées salarié par salarié de façon fiable par la DSN : la masse chargée
// est n.d. avec sa raison, jamais estimée.
const ITEM = STUDIO_RH_ITEMS.find((i) => i.path === "studio-rh/masse-salariale")!;
const ND_CHARGES = "cotisations patronales non portées salarié par salarié par la DSN (blocs S21.G00.81 et S21.G00.23 non extraits) : utilisez l'API PayFit (journal de paie) pour la masse chargée";
const STATUS: Record<DsnMonth["status"], string> = { complete: "complet", incomplete: "incomplet ⚠", blocked: "bloqué" };

export function DsnView({ slug, dsn, sp }: { slug: string; dsn: Map<string, DsnMonth>; sp: Record<string, string> }) {
  const base = `/e/${slug}/studio-rh/masse-salariale`;
  const covered = [...dsn.keys()].sort();
  const usable = covered.filter((m) => dsn.get(m)!.status !== "blocked" && dsn.get(m)!.byType["001"] !== undefined);
  const last = usable.at(-1) ?? null;
  const source = (
    <p className="desc ms-source" data-testid="ms-source">
      Source : <strong>DSN déposées</strong> (déclarations qui font foi, module Données) · mois couverts <span className="ms-nowrap">{covered[0] ?? "n.d."}</span> → <span className="ms-nowrap">{covered.at(-1) ?? "n.d."}</span> ·{" "}
      <a href={`/e/${slug}/donnees`}>Données</a>
      <GlossaryLink slug={slug} term={MASSE_TERMS.brutDsn} />
    </p>
  );
  if (!last) {
    return (
      <MoneyText><>
        <MsHead title={ITEM.label} />
        <MsRead source={source} />
        <NdState testid="ms-nd" reason="Aucune DSN appliquée avec une rémunération de type 001." action={{ href: `/e/${slug}/donnees`, label: "Déposer des DSN dans Données" }} />
      </></MoneyText>
    );
  }
  const notices: string[] = [];
  const years = [...new Set(covered.map((m) => Number(m.slice(0, 4))))].sort();
  const year = years.includes(Number(sp.annee)) ? Number(sp.annee) : Number(last.slice(0, 4));
  if (sp.annee && String(year) !== sp.annee) notices.push(`paramètre ignoré : annee=${sp.annee} (année hors des DSN déposées)`);
  const aff: Affichage = isAffichage(sp.affichage ?? "") ? (sp.affichage as Affichage) : "tout";
  if (sp.affichage && !isAffichage(sp.affichage)) notices.push(`paramètre ignoré : affichage=${sp.affichage} (valeurs : ${AFFICHAGES.join(", ")})`);
  const showGraph = aff !== "tableau";
  const showTable = aff !== "graphique";
  const lastOfYear = year === Number(last.slice(0, 4)) ? last.slice(5, 7) : (covered.filter((m) => m.startsWith(`${year}-`)).at(-1)?.slice(5, 7) ?? "12");
  let from = MM.includes(sp.de) ? sp.de : "01";
  const to = MM.includes(sp.a) ? sp.a : lastOfYear;
  if (from > to) from = "01";
  const months = MM.filter((m) => m >= from && m <= to).map((m) => `${year}-${m}`);
  const prevMonths = months.map((m) => shiftYear(m, -1));
  const cur = dsnBrutWindow(dsn, months);
  const prev = dsnBrutWindow(dsn, prevMonths);
  const label = (ms: string[]) => (ms.length === 1 ? formatMonth(ms[0]) : `${MONTH_NAMES[Number(ms[0].slice(5)) - 1]} → ${MONTH_NAMES[Number(ms.at(-1)!.slice(5)) - 1]} ${ms[0].slice(0, 4)}`);
  const show = (w: DsnWindow) => (w.kind === "nd" ? "n.d." : euros(w.brutCents));
  // Raisons des n.d. des tuiles : écrites une fois sous les tuiles.
  const tileNd = reasonLines([
    { label: `Période (${label(months)})`, reason: cur.kind === "nd" ? cur.reason : null },
    { label: `N-1 (${label(prevMonths)})`, reason: prev.kind === "nd" ? prev.reason : null },
  ]);
  const evo = cur.kind === "value" && prev.kind === "value" && prev.brutCents !== 0 ? { delta: cur.brutCents - prev.brutCents, ratio: { num: cur.brutCents - prev.brutCents, den: prev.brutCents } } : null;
  const affQ = (a: Affichage) => (a === "tout" ? "" : `&affichage=${a}`);
  const href = (de: string, a: string, v: Affichage = aff) => `${base}?annee=${year}&de=${de}&a=${a}${affQ(v)}`;
  const presets = [
    { label: "Janv.–mars", de: "01", a: "03" },
    { label: "Janv.–juin", de: "01", a: "06" },
    { label: `Janv.–${monthShort(`${year}-${lastOfYear}`)}`, de: "01", a: lastOfYear },
  ]
    .filter((p, i, all) => p.a <= lastOfYear && all.findIndex((x) => x.a === p.a) === i)
    .map((p) => ({ label: p.label, href: href(p.de, p.a), current: p.de === from && p.a === to }));
  // Mois dont la DSN est incomplète (un établissement connu n'a pas déclaré) : tracés, comme dans le tableau, et signalés.
  const incomplete = [...months, ...prevMonths].filter((m) => dsn.get(m)?.status === "incomplete");
  const axis = monthsAxis(months, prevMonths);
  const brutSeries = dsnSeries(months.map((m) => dsn.get(m)), prevMonths.map((m) => dsn.get(m)), { cur: `Brut déclaré ${year}`, prev: `Brut déclaré ${year - 1} (N-1)` });
  // Raisons des mois n.d. du graphique (mêmes raisons que les tuiles), écrites sous le graphique quand le tableau est masqué.
  const dsnNd = ndLines(ndGroups([...months, ...prevMonths].map((m) => ({ month: m, reason: dsnPoint(dsn.get(m)).reason }))));
  // Seule note conservée sous le graphique : les mois à DSN incomplète (le brut ne couvre que les établissements déclarés).
  const incompleteNote = incomplete.length ? `Mois à DSN incomplète (⚠ dans le tableau) : ${incomplete.map(monthShortYear).join(", ")}.` : "";
  return (
    <MoneyText><>
      <MsHead title={ITEM.label} />
      <div className="ms-controls">
        <MsRead source={source} />
        <PeriodBar years={years} year={year} from={from} to={to} hidden={aff !== "tout" ? { affichage: aff } : {}} presets={presets} resetHref={aff !== "tout" ? `${base}?affichage=${aff}` : base} />
        {notices.map((n) => <p key={n} className="notice" data-testid="ms-param-notice">{n}</p>)}
        <div className="ms-toolbar">
          <p className="desc ms-period" data-testid="ms-period"><strong>{label(months)}</strong> · N-1 : {label(prevMonths)} · <MoneyUnitLabel /></p>
          <TrendLegend slug={slug} />
          <ViewSwitch
            testid="ms-affichage"
            label="Affichage des résultats"
            current={aff}
            options={[
              { key: "tout", label: "Afficher tout", href: href(from, to, "tout") },
              { key: "graphique", label: "Graphique", href: href(from, to, "graphique") },
              { key: "tableau", label: "Tableau", href: href(from, to, "tableau") },
            ]}
          />
        </div>
      </div>
      <section className="panel">
        <PanelHead title={`Vue d'ensemble — ${label(months)}`} />
        <dl className="facts ms-tiles">
          <Tile
            testid="ms-tile-brut"
            main
            label="Brut déclaré (DSN, type 001)"
            value={show(cur)}
            nd={cur.kind === "nd"}
            compare={
              <span className="tile-foot" data-testid="ms-tile-brut-n1">
                N-1 : {show(prev)}
                {cur.kind === "value" && cur.incompleteMonths.length ? ` · mois incomplets : ${cur.incompleteMonths.join(", ")}` : ""}
                {prev.kind === "value" && prev.incompleteMonths.length ? ` · mois N-1 incomplets : ${prev.incompleteMonths.join(", ")}` : ""}
              </span>
            }
            def={MASSE_TERMS.brutDsn}
            slug={slug}
          />
          <Tile
            testid="ms-tile-evolution"
            label="Évolution du brut vs N-1"
            value={evo ? `${evo.delta > 0 ? "+" : ""}${fmtPercent(evo.ratio)}` : cur.kind === "nd" || prev.kind === "nd" ? "n.d." : "n.d. — N-1 nul : % non défini"}
            nd={!evo}
            ndLong={!evo && cur.kind === "value" && prev.kind === "value"}
            trend={evo ? trendOf(evo.delta) : undefined}
            lead={evo ? <span className={`ms-delta ${trendOf(evo.delta)}`.trim()}>{eurosSigned(evo.delta)}</span> : undefined}
            def={MASSE_TERMS.evolution}
            slug={slug}
          />
          <Tile testid="ms-tile-masse" label="Masse salariale chargée" value={`n.d. — ${ND_CHARGES}`} nd ndLong def={MASSE_TERMS.masseDsn} slug={slug} />
        </dl>
        <NdLines lines={tileNd} testid="ms-tiles-nd" />
      </section>
      {showGraph && (
        <section className="panel" data-testid="ms-graphs">
          <PanelHead title="Graphiques" slug={slug} term={MASSE_TERMS.graphiques} />
          <div className="ms-charts">
            <div className="ms-chart wide">
              <ChartGuard testid="ms-trend" title={`Brut déclaré par mois, ${year} face à ${year - 1} (N-1)`} series={brutSeries}>
                <BarChart
                  testid="ms-trend"
                  label={`Brut déclaré en DSN par mois, ${year} et ${year - 1}, montants monétaires`}
                  title={`Brut déclaré par mois, ${year} face à ${year - 1} (N-1)`}
                  categories={axis.categories}
                  categoryTitles={axis.titles}
                  series={brutSeries}
                  unit="eur"
                  height={300}
                  note={incompleteNote || undefined}
                />
              </ChartGuard>
            </div>
          </div>
          {hasNd(brutSeries) && <NdKey />}
          {!showTable && <NdLines lines={dsnNd} testid="ms-graph-nd-reasons" />}
          <GraphFoot aff={aff} tableHref={href(from, to, "tableau")} />
        </section>
      )}
      {showTable && (
        <section className="panel">
          <PanelHead title="Mois par mois" slug={slug} term={MASSE_TERMS.moisDsn} />
          <ScrollTable label="Tableau du brut déclaré mois par mois">
            <table className="data-table sticky sticky-first ms-table" data-testid="ms-monthly-table">
              <caption className="ms-sr">Brut déclaré en DSN mois par mois, {label(months)}, comparé à {label(prevMonths)}</caption>
              <thead>
                <tr><th scope="col">Mois</th><th scope="col" className="num">Brut déclaré (001)</th><th scope="col" className="num n1">Brut N-1</th><th scope="col" className="num">Écart</th><th scope="col">DSN</th><th scope="col">Autres types déclarés (non additionnés)</th></tr>
              </thead>
              <tbody>
                {months.map((m) => {
                  const d = dsn.get(m);
                  const p = dsn.get(shiftYear(m, -1));
                  const b = d && d.status !== "blocked" ? d.byType["001"] : undefined;
                  const pInc = p?.status === "incomplete" ? " ⚠" : "";
                  const bp = p && p.status !== "blocked" ? p.byType["001"] : undefined;
                  const others = d ? Object.entries(d.byType).filter(([t]) => t !== "001") : [];
                  return (
                    <tr key={m} data-month={m}>
                      <th scope="row">{formatMonth(m)}</th>
                      <td className="num" data-col="brut">{b === undefined ? "n.d." : euros(b)}</td>
                      <td className="num n1" data-col="brut-n1">{bp === undefined ? "n.d." : `${euros(bp)}${pInc}`}</td>
                      <td className={numTrend(b === undefined || bp === undefined ? null : b - bp)} data-col="ecart">{b === undefined || bp === undefined ? "n.d." : eurosSigned(b - bp)}</td>
                      <td>{d ? STATUS[d.status] : <span className="nd">non déposée</span>}</td>
                      <td className="wrap tile-foot">{others.length ? others.map(([t, c]) => `type ${t} : ${euros(c)}`).join(" · ") : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollTable>
          <NdLines lines={dsnNd} />
        </section>
      )}
    </></MoneyText>
  );
}
