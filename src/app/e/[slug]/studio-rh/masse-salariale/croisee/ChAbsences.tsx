import "@/styles/croisee-absences.css";
import { BarChart } from "@/components/charts";
import { GlossaryLink } from "@/components/GlossaryLink";
import { CROISEE_TERMS } from "@/lib/glossary/croisee";
import type { CroiseeChart, CroiseeTable } from "@/lib/viz/croisee";
import { absencesModel, type AbsencesBlock, type AbsencesModel, type PrevuItem } from "@/lib/viz/croisee-absences";
import { capital, hasData } from "@/lib/viz/masse";
import { GraphFoot, NdState, type Affichage } from "../components";
import { ModelTable } from "./atomes/ModelTable";
import { NdNote } from "./atomes/NdNote";
import { Tuiles } from "./atomes/Tuile";
import type { CroiseeContext } from "./context";

// Chapitre 03 · Absences & congés. Le composant prend le modèle du chapitre par absencesModel (un seul calcul par requête, le même que
// celui des exports) et le rend : cartes, graphiques chacun suivi de son tableau exact, tableaux par motif, n.d. avec leur raison et
// « Prévu ». Aucun nom ni identifiant : le détail nominatif reste dans Collaborateurs et KPI RH.
export default async function ChAbsences({ ctx }: { ctx: CroiseeContext }) {
  const model = await absencesModel(ctx);
  return <AbsencesView model={model} slug={ctx.slug} affichage={ctx.affichage} tableauHref={ctx.href({ affichage: "tableau" })} />;
}

type ViewProps = { model: AbsencesModel; slug: string; affichage: Affichage; tableauHref: string };

// Rendu synchrone du modèle (testé tel quel). « Graphiques » : cartes et blocs de graphique, chacun avec un lien vers son tableau
// exact ; « Tableaux » : cartes et tableaux, sans graphique ; « Afficher tout » : tout.
export function AbsencesView({ model, slug, affichage, tableauHref }: ViewProps) {
  // Le titre du chapitre est déjà celui de la page (h2) : l'état n.d. ne le répète pas.
  if (model.nd) return <NdState testid="cx-absences-nd" reason={capital(model.nd.reason)} action={model.nd.action} />;
  const tableOf = (id: string) => model.tables.find((t) => t.id === id);
  const chartOf = (id: string) => model.charts.find((c) => c.id === id);
  const showChart = affichage !== "tableau";
  const showTable = affichage !== "graphique";
  return (
    <div className="cx-abs" data-testid="cx-absences">
      {model.blocks.map((b) => {
        if (b.id === "cartes") {
          return (
            <section key={b.id} className="cx-abs-tiles" id="cx-absences-cartes" aria-label={b.title}>
              <Tuiles tiles={model.tiles} chapter="absences" slug={slug} testid="cx-tiles-absences" />
              {b.nd.map((n, i) => (
                <NdNote key={`${n.label ?? ""}-${i}`} label={n.label} reason={n.reason} action={n.action} testid={`cx-absences-cartes-nd${i === 0 ? "" : `-${i + 1}`}`} />
              ))}
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
        <section className="cx-abs-limits" data-testid="cx-absences-limites" aria-label="Limites de la lecture">
          <h3 className="cx-abs-limits-title">
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
  b: AbsencesBlock;
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
  const titleId = `cx-absences-${b.id}-titre`;
  return (
    <section className="panel cx-abs-block" id={`cx-absences-${b.id}`} aria-labelledby={titleId} data-testid={`cx-absences-${b.id}`}>
      <h3 id={titleId} className="cx-abs-title">
        {b.title}
        {b.term && <GlossaryLink slug={slug} term={b.term} label={b.title} />}
      </h3>
      {b.nd.map((n, i) => (
        <NdNote key={`${n.label ?? ""}-${i}`} label={n.label} reason={n.reason} action={n.action} testid={`cx-absences-${b.id}-nd${i === 0 ? "" : `-${i + 1}`}`} />
      ))}
      {p.charts.map((c) => {
        const table = p.tableOf(c.tableId);
        return (
          <div key={c.id} className="cx-abs-chart">
            {p.showChart && <ChartView c={c} />}
            {p.showChart && <GraphFoot aff={p.affichage} tableHref={`${p.tableauHref}#cx-table-${c.tableId}`} testid={`cx-chart-${c.id}-tableau`} />}
            {p.showTable && table && <ModelTable table={table} slug={slug} />}
          </div>
        );
      })}
      {p.showTable && others.map((t) => <ModelTable key={t.id} table={t} slug={slug} />)}
      {p.showTable && b.prevu.length > 0 && <PrevuList items={b.prevu} slug={slug} />}
    </section>
  );
}

const UNIT_TEXT: Partial<Record<CroiseeChart["unit"], string>> = { bps: "en pourcentage", nombre: "en demi-journées" };

// Graphique du modèle : barres groupées ou empilées (séries déjà calculées, n.d. hachurés ou absents de la pile, avec leur raison dans
// l'infobulle). Sans aucune valeur connue, la raison remplace le graphique (le titre du bloc n'est pas répété). Les props sont
// sérialisables (unité nommée, jamais de fonction).
function ChartView({ c }: { c: CroiseeChart }) {
  const testid = `cx-chart-${c.id}`;
  if (!hasData(c.series)) {
    const reasons = [...new Set(c.series.flatMap((s) => (s.reasons ?? []).filter((r): r is string => Boolean(r))))];
    const shown = reasons.slice(0, 3);
    return <NdState testid={`${testid}-vide`} reason="Aucune valeur connue sur la période : graphique non tracé." reasons={shown} more={reasons.length - shown.length} />;
  }
  return (
    <BarChart
      testid={testid}
      label={`${c.title}${UNIT_TEXT[c.unit] ? `, ${UNIT_TEXT[c.unit]}` : ""}`}
      title={c.title}
      categories={c.categories}
      categoryTitles={c.categoryTitles}
      series={c.series}
      unit={c.unit}
      mode={c.mode}
      toggle={c.mode === "stacked"}
      height={280}
    />
  );
}

// Indicateurs que Clair ne calcule pas : mention « Prévu », chacun avec sa raison, sa définition et, s'il y a lieu, l'écran qui s'en
// approche ; aucun chiffre.
function PrevuList({ items, slug }: { items: PrevuItem[]; slug: string }) {
  return (
    <div className="cx-abs-prevu">
      <p className="cx-prevu-state">
        <span className="tag">Prévu</span>
        <GlossaryLink slug={slug} term={CROISEE_TERMS.prevu} label="Prévu" />
      </p>
      <ul className="cx-abs-prevu-list">
        {items.map((x) => (
          <li key={x.id} data-testid={`cx-prevu-${x.id}`}>
            <strong>{x.label}</strong>
            {x.term && <GlossaryLink slug={slug} term={x.term} label={x.label} />} — {x.reason}
            {x.link && (
              <>
                {" "}
                <a href={x.link.href}>
                  {x.link.label}
                  <span aria-hidden="true"> →</span>
                </a>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
