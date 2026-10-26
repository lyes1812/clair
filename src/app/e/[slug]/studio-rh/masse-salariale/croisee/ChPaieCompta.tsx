import "@/styles/croisee-paie.css";
import { BarChart, LineChart } from "@/components/charts";
import { GlossaryLink } from "@/components/GlossaryLink";
import { MoneyText } from "@/components/Money";
import { CROISEE_TERMS } from "@/lib/glossary/croisee";
import type { CroiseeChart, CroiseeTable } from "@/lib/viz/croisee";
import { buildPaieCompta, loadPaieComptaInput, type PaieBlock, type PaieModel } from "@/lib/viz/croisee-paie";
import { capital, hasNd } from "@/lib/viz/masse";
import { ChartGuard, GraphFoot, NdKey, NdState, TrendLegend, type Affichage } from "../components";
import { ModelTable } from "./atomes/ModelTable";
import { NdNote } from "./atomes/NdNote";
import { Tuiles } from "./atomes/Tuile";
import type { CroiseeContext } from "./context";

// Chapitre 07 · Paie & comptabilité. Le composant lit l'entrée du chapitre (lecteurs du contexte, mêmes fonctions que l'onglet Paie
// & comptabilité de la Masse salariale), construit le modèle par la fonction pure buildPaieCompta (le même que celui des exports) et
// le rend : cartes, blocs (graphiques suivis de leur tableau exact), blocs « Prévu » avec leur raison, limites de la lecture.
export default async function ChPaieCompta({ ctx }: { ctx: CroiseeContext }) {
  const model = buildPaieCompta(await loadPaieComptaInput(ctx));
  return <PaieComptaChapter model={model} slug={ctx.slug} affichage={ctx.affichage} tableauHref={ctx.href({ affichage: "tableau" })} />;
}

// Rendu synchrone du modèle (testé tel quel). « Graphiques » : cartes et blocs à graphique, chaque graphique avec un lien vers son
// tableau exact ; « Tableaux » : cartes et tableaux ; « Afficher tout » : tout.
export function PaieComptaChapter({ model, slug, affichage, tableauHref }: { model: PaieModel; slug: string; affichage: Affichage; tableauHref: string }) {
  if (model.nd) return <NdState testid="cx-paie-compta-nd" reason={capital(model.nd.reason)} action={model.nd.action} />;
  const shown = model.blocks.filter((b) => affichage !== "graphique" || b.graph);
  return (
    <div className="cx-paie" data-testid="cx-paie-compta">
      <section className="cx-paie-cards" id="cx-paie-compta-cartes" aria-label="Chiffres clés" data-testid="cx-paie-compta-cartes">
        <Tuiles tiles={model.tiles} chapter="paie-compta" slug={slug} testid="cx-tiles-paie-compta" />
        {model.trend && <TrendLegend slug={slug} />}
      </section>
      {shown.map((b) => (
        <Block key={b.id} b={b} model={model} slug={slug} affichage={affichage} tableauHref={tableauHref} />
      ))}
      {affichage !== "graphique" && model.prevu.length > 0 && (
        <section className="panel cx-paie-block cx-paie-prevu" id="cx-paie-compta-prevu" aria-labelledby="cx-paie-compta-prevu-titre" data-testid="cx-paie-compta-prevu">
          <h3 id="cx-paie-compta-prevu-titre" className="cx-paie-title">
            Non disponibles dans cette version
            <GlossaryLink slug={slug} term={CROISEE_TERMS.prevu} label="Prévu" />
          </h3>
          <ul className="cx-paie-prevu-list">
            {model.prevu.map((x) => (
              <li key={x.id} data-testid={`cx-prevu-${x.id}`}>
                <span className="tag">Prévu</span> <strong>{x.label}</strong> — {x.reason}
                <GlossaryLink slug={slug} term={x.term} label={x.label} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {model.limits.length > 0 && (
        <section className="cx-paie-limits" id="cx-paie-compta-limites" data-testid="cx-paie-compta-limites" aria-label="Limites de la lecture">
          <h3 className="cx-paie-limits-title">Limites de la lecture</h3>
          <MoneyText>
            <ul>
              {model.limits.map((l) => (
                <li key={l} className="tile-foot">{l}</li>
              ))}
            </ul>
          </MoneyText>
        </section>
      )}
    </div>
  );
}

function Block({ b, model, slug, affichage, tableauHref }: { b: PaieBlock; model: PaieModel; slug: string; affichage: Affichage; tableauHref: string }) {
  const showChart = affichage !== "tableau";
  const showTable = affichage !== "graphique";
  const charts = b.charts.map((id) => model.charts.find((c) => c.id === id)).filter((c): c is CroiseeChart => Boolean(c));
  const tables = b.tables.map((id) => model.tables.find((t) => t.id === id)).filter((t): t is CroiseeTable => Boolean(t));
  const nds = b.nd.filter((n) => showTable || !n.tableOnly);
  const titleId = `cx-paie-compta-${b.id}-titre`;
  return (
    <MoneyText>
      <section className="panel cx-paie-block" id={`cx-paie-compta-${b.id}`} aria-labelledby={titleId} data-testid={`cx-paie-compta-${b.id}`}>
        <h3 id={titleId} className="cx-paie-title">
          {b.title}
          {b.term && <GlossaryLink slug={slug} term={b.term} label={b.title} />}
        </h3>
        {b.notes.map((n) => (
          <p key={n} className="tile-foot cx-paie-note">{n}</p>
        ))}
        {nds.map((n, i) => (
          <NdNote key={`${n.label ?? ""}-${i}`} label={n.label} reason={n.reason} action={n.action} testid={`cx-paie-compta-${b.id}-nd${i === 0 ? "" : `-${i + 1}`}`} />
        ))}
        {showChart && charts.length > 0 && (
          <>
            <div className={charts.length > 1 ? "cx-paie-charts" : "cx-paie-charts one"}>
              {charts.map((c) => (
                <div key={c.id} className="cx-paie-chart">
                  <ChartView c={c} />
                  <GraphFoot aff={affichage} tableHref={`${tableauHref}#cx-table-${c.tableId}`} testid={`cx-chart-${c.id}-tableau`} />
                </div>
              ))}
            </div>
            {charts.some((c) => hasNd(c.series)) && <NdKey testid={`cx-paie-compta-${b.id}-nd-key`} />}
          </>
        )}
        {showTable && tables.map((t) => <ModelTable key={t.id} table={t} slug={slug} />)}
      </section>
    </MoneyText>
  );
}

// Graphique du modèle : barres ou courbe (séries déjà calculées, n.d. hachurés ou interrompus avec leur raison) ; sans aucune valeur
// connue, la raison remplace le graphique (ChartGuard). Props sérialisables : unité nommée, jamais de fonction.
function ChartView({ c }: { c: CroiseeChart }) {
  const testid = `cx-chart-${c.id}`;
  const label = `${c.title}, montants monétaires`;
  return (
    <ChartGuard testid={testid} title={c.title} series={c.series}>
      {c.kind === "courbe" ? (
        <LineChart testid={testid} label={label} title={c.title} categories={c.categories} categoryTitles={c.categoryTitles} series={c.series} unit={c.unit} />
      ) : (
        <BarChart testid={testid} label={label} title={c.title} categories={c.categories} categoryTitles={c.categoryTitles} series={c.series} unit={c.unit} mode={c.mode} toggle={c.mode === "stacked" && c.series.length > 1} />
      )}
    </ChartGuard>
  );
}
