import "@/styles/croisee-effectifs.css";
import { BarChart } from "@/components/charts";
import { GlossaryLink } from "@/components/GlossaryLink";
import { CROISEE_TERMS } from "@/lib/glossary/croisee";
import type { CroiseeChart, CroiseeTable } from "@/lib/viz/croisee";
import { buildEffectifs, loadEffectifsInput, type EffectifsBlock, type EffectifsModel, type PrevuItem } from "@/lib/viz/croisee-effectifs";
import { capital } from "@/lib/viz/masse";
import { ChartGuard, GraphFoot, NdState, type Affichage } from "../components";
import { AlertList } from "./atomes/AlertList";
import { ModelTable } from "./atomes/ModelTable";
import { NdNote } from "./atomes/NdNote";
import { Tuiles } from "./atomes/Tuile";
import type { CroiseeContext } from "./context";

// Chapitre 02 · Effectifs & mouvements. Le composant lit l'entrée du chapitre (lecteurs du contexte), construit le modèle par la fonction
// pure buildEffectifs (le même que celui des exports) et le rend : cartes, graphiques chacun suivi de son tableau exact, tableaux,
// n.d. avec leur raison et « Prévu ». Aucun nom de personne : le détail nominatif reste dans Collaborateurs › Mouvements.
export default async function ChEffectifs({ ctx }: { ctx: CroiseeContext }) {
  const model = buildEffectifs(await loadEffectifsInput(ctx));
  return <EffectifsView model={model} slug={ctx.slug} affichage={ctx.affichage} tableauHref={ctx.href({ affichage: "tableau" })} />;
}

type ViewProps = { model: EffectifsModel; slug: string; affichage: Affichage; tableauHref: string };

// Rendu synchrone du modèle (testé tel quel). Affichage « Graphiques » : cartes et blocs de graphique, chaque graphique avec un lien
// vers son tableau exact ; « Tableaux » : cartes et tableaux, sans graphique ; « Afficher tout » : tout.
export function EffectifsView({ model, slug, affichage, tableauHref }: ViewProps) {
  if (model.nd) {
    return <NdState testid="cx-effectifs-nd" heading="Effectifs & mouvements" reason={capital(model.nd.reason)} action={model.nd.action} />;
  }
  const tableOf = (id: string) => model.tables.find((t) => t.id === id);
  const chartOf = (id: string) => model.charts.find((c) => c.id === id);
  const showChart = affichage !== "tableau";
  const showTable = affichage !== "graphique";
  return (
    <div className="cx-eff" data-testid="cx-effectifs">
      {model.blocks.map((b) => {
        if (b.id === "cartes") {
          return (
            <section key={b.id} className="cx-eff-tiles" id="cx-effectifs-cartes" aria-label={b.title}>
              <Tuiles tiles={model.tiles} chapter="effectifs" slug={slug} testid="cx-tiles-effectifs" />
              {model.alerts.length > 0 && <AlertList alerts={model.alerts} slug={slug} id="cx-effectifs-alertes" />}
            </section>
          );
        }
        if (!b.graph && !showTable) return null;
        return (
          <Block
            key={b.id}
            b={b}
            slug={slug}
            charts={b.charts.map(chartOf).filter((c): c is CroiseeChart => Boolean(c))}
            tables={b.tables.map(tableOf).filter((t): t is CroiseeTable => Boolean(t))}
            tableOf={tableOf}
            showChart={showChart}
            showTable={showTable}
            affichage={affichage}
            tableauHref={tableauHref}
          />
        );
      })}
      {showTable && model.limits.length > 0 && (
        <section className="cx-eff-limits" data-testid="cx-effectifs-limites" aria-label="Limites de la lecture">
          <h3 className="cx-eff-limits-title">
            Limites de la lecture
            <GlossaryLink slug={slug} term="kpi-limites-lecture" label="Limites de la lecture" />
          </h3>
          <ul>
            {model.limits.map((l) => (
              <li key={l} className="tile-foot">{l}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Block(p: {
  b: EffectifsBlock;
  slug: string;
  charts: CroiseeChart[];
  tables: CroiseeTable[];
  tableOf: (id: string) => CroiseeTable | undefined;
  showChart: boolean;
  showTable: boolean;
  affichage: Affichage;
  tableauHref: string;
}) {
  const { b, slug } = p;
  const chartTables = new Set(p.charts.map((c) => c.tableId));
  const others = p.tables.filter((t) => !chartTables.has(t.id));
  const titleId = `cx-effectifs-${b.id}-titre`;
  return (
    <section className="panel cx-eff-block" id={`cx-effectifs-${b.id}`} aria-labelledby={titleId} data-testid={`cx-effectifs-${b.id}`}>
      <h3 id={titleId} className="cx-eff-title">
        {b.title}
        {b.term && <GlossaryLink slug={slug} term={b.term} label={b.title} />}
      </h3>
      {b.nd.map((n, i) => (
        <NdNote key={`${n.label ?? ""}-${i}`} label={n.label} reason={n.reason} action={n.action} testid={`cx-effectifs-${b.id}-nd${i === 0 ? "" : `-${i + 1}`}`} />
      ))}
      {p.charts.map((c) => {
        const table = p.tableOf(c.tableId);
        return (
          <div key={c.id} className="cx-eff-chart">
            {p.showChart && <ChartView c={c} />}
            {p.showChart && <GraphFoot aff={p.affichage} tableHref={`${p.tableauHref}#cx-table-${c.tableId}`} testid={`cx-chart-${c.id}-tableau`} />}
            {p.showTable && table && <ModelTable table={table} slug={slug} />}
          </div>
        );
      })}
      {p.showTable && others.map((t) => <ModelTable key={t.id} table={t} slug={slug} />)}
      {p.showTable && b.prevu.length > 0 && <PrevuList id={b.id} items={b.prevu} slug={slug} />}
      {p.showTable && b.link && (
        <p className="tile-foot cx-eff-link">
          <a href={b.link.href}>
            {b.link.label}
            <span aria-hidden="true"> →</span>
          </a>
        </p>
      )}
    </section>
  );
}

// Graphique du modèle : barres (séries déjà calculées, n.d. hachurés avec leur raison) ; sans aucune valeur connue, la raison remplace
// le graphique (ChartGuard). Les props sont sérialisables (unité nommée, jamais de fonction).
function ChartView({ c }: { c: CroiseeChart }) {
  const testid = `cx-chart-${c.id}`;
  return (
    <ChartGuard testid={testid} title={c.title} series={c.series}>
      <BarChart
        testid={testid}
        label={`${c.title}, ${c.unit === "nombre" ? "en nombre" : c.unit === "etp" ? "en ETP" : c.unit === "bps" ? "en pourcentage" : "en montants"}`}
        title={c.title}
        categories={c.categories}
        categoryTitles={c.categoryTitles}
        series={c.series}
        unit={c.unit}
        mode={c.mode}
        height={280}
      />
    </ChartGuard>
  );
}

// Caractéristiques ou indicateurs que Clair ne lit pas : mention « Prévu », chacun avec sa raison ; aucun chiffre.
function PrevuList({ id, items, slug }: { id: string; items: PrevuItem[]; slug: string }) {
  return (
    <div className="cx-eff-prevu" data-testid={`cx-prevu-${id}`}>
      <p className="cx-prevu-state">
        <span className="tag">Prévu</span>
        <GlossaryLink slug={slug} term={CROISEE_TERMS.prevu} label="Prévu" />
      </p>
      <ul className="cx-eff-prevu-list">
        {items.map((x) => (
          <li key={x.label}>
            <strong>{x.label}</strong> — {x.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}
