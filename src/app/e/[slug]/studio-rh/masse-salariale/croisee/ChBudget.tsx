import "@/styles/croisee-budget.css";
import { BarChart, LineChart, WaterfallChart } from "@/components/charts";
import { GlossaryLink } from "@/components/GlossaryLink";
import { MoneyText } from "@/components/Money";
import { CROISEE_TERMS } from "@/lib/glossary/croisee";
import type { CroiseeChart, CroiseeTable } from "@/lib/viz/croisee";
import { budgetModel, cascadeOf, type BlocksModel, type CxBlock, type CxPrevu } from "@/lib/viz/croisee-budget";
import { GraphFoot, NdLines, TrendLegend, type Affichage } from "../components";
import { ChartNd, chartTitle } from "./atomes/ChartTitle";
import { ModelTable } from "./atomes/ModelTable";
import { NdNote } from "./atomes/NdNote";
import { Tuiles } from "./atomes/Tuile";
import type { CroiseeContext } from "./context";

// Chapitre 06 · Budget & prévisions : réalisé, budget saisi et écart sur la période ; douze mois du scénario retenu face au réalisé et
// au budget (comme Hypothèses › Résultat › Comparaison) ; atterrissage et atterrissage retraité ; écart lié aux contrats observés ;
// blocs « Prévu ». Aucun calcul ici : le modèle vient de budgetModel, calculé une fois par requête et repris tel quel par les exports.
export default async function ChBudget({ ctx }: { ctx: CroiseeContext }) {
  const model = await budgetModel(ctx);
  return <BlocksChapter model={model} slug={ctx.slug} affichage={ctx.affichage} tableauHref={ctx.href({ affichage: "tableau" })} />;
}

// --- Rendu commun aux chapitres 06 et 08 (repris par ChEffets) ---------------------------------------------------------------------

const CHAPTER_TITLES: Record<string, string> = { budget: "Budget & prévisions", effets: "Effets d'évolution" };

// Rendu synchrone d'un modèle à blocs (testé tel quel). Cartes toujours affichées ; « Graphiques » : graphiques, chacun avec l'accès à
// son tableau exact ; « Tableaux » : tableaux exacts ; « Afficher tout » : tout. Les blocs « Prévu » et les limites restent visibles.
export function BlocksChapter({ model, slug, affichage, tableauHref }: { model: BlocksModel; slug: string; affichage: Affichage; tableauHref: string }) {
  const chapter = model.chapter;
  if (model.nd) {
    return (
      <section className="panel cx-bud-block" data-testid={`cx-${chapter}-nd`} aria-label={CHAPTER_TITLES[chapter] ?? chapter}>
        <NdNote label={CHAPTER_TITLES[chapter]} reason={model.nd.reason} action={model.nd.action} />
      </section>
    );
  }
  const legend = model.trend || model.blocks.some((b) => b.trend && (b.tables.length > 0 || b.charts.length > 0));
  return (
    <MoneyText>
      <div className="cx-bud" data-testid={`cx-${chapter}`}>
        <section className="cx-bud-cards" id={`cx-${chapter}-cartes`} aria-label="Chiffres clés">
          <Tuiles tiles={model.tiles} chapter={chapter} slug={slug} testid={`cx-${chapter}-cartes`} />
          {(model.tileNd.length > 0 || legend) && (
            <div className="cx-bud-under">
              <NdLines lines={model.tileNd} testid={`cx-${chapter}-cartes-nd`} />
              {legend && <TrendLegend slug={slug} />}
            </div>
          )}
        </section>
        {model.blocks.map((b) => (
          <Block key={b.id} b={b} model={model} slug={slug} affichage={affichage} tableauHref={tableauHref} />
        ))}
        <PrevuBlock chapter={chapter} items={model.prevu} slug={slug} />
        <Limits chapter={chapter} limits={model.limits} />
      </div>
    </MoneyText>
  );
}

function Block({ b, model, slug, affichage, tableauHref }: { b: CxBlock; model: BlocksModel; slug: string; affichage: Affichage; tableauHref: string }) {
  const chapter = model.chapter;
  const showChart = affichage !== "tableau";
  const showTable = affichage !== "graphique";
  const charts = b.charts.map((id) => model.charts.find((c) => c.id === id)).filter((c): c is CroiseeChart => Boolean(c));
  const tables = b.tables.map((id) => model.tables.find((t) => t.id === id)).filter((t): t is CroiseeTable => Boolean(t));
  const anchor = `cx-${chapter}-${b.id}`;
  return (
    <section className="panel cx-bud-block" id={anchor} aria-labelledby={`${anchor}-titre`} data-testid={anchor}>
      <div className="cx-bud-head">
        <h3 id={`${anchor}-titre`} className="cx-bud-title">
          {b.title}
          {b.term && <GlossaryLink slug={slug} term={b.term} label={b.title} />}
        </h3>
        {b.links.length > 0 && (
          <p className="cx-bud-links">
            {b.links.map((l) => (
              <a key={l.href} href={l.href}>
                {l.label}
                <span aria-hidden="true"> →</span>
              </a>
            ))}
          </p>
        )}
      </div>
      {b.nd.map((n, i) => (
        <NdNote key={`${n.label ?? ""}-${i}`} label={n.label} reason={n.reason} action={n.action} testid={`${anchor}-nd${i === 0 ? "" : `-${i + 1}`}`} />
      ))}
      {b.notes.map((n) => (
        <p key={n} className="tile-foot cx-bud-note">{n}</p>
      ))}
      {showChart && charts.length > 0 && (
        <div className={charts.length > 1 ? "cx-bud-charts" : "cx-bud-charts one"}>
          {charts.map((c) => (
            <div key={c.id} className="cx-bud-chart">
              <ChartView c={c} block={b.title} />
              <GraphFoot aff={affichage} tableHref={`${tableauHref}#cx-table-${c.tableId}`} testid={`cx-chart-${c.id}-tableau`} />
            </div>
          ))}
        </div>
      )}
      {showTable && tables.map((t) => <ModelTable key={t.id} table={t} slug={slug} />)}
      {!showTable && charts.length === 0 && tables.length > 0 && (
        <p className="tile-foot cx-bud-tablelink" data-testid={`${anchor}-tableau`}>
          <a href={`${tableauHref}#${anchor}`}>Afficher le tableau exact</a>
        </p>
      )}
    </section>
  );
}

// Graphique du modèle : courbes (Comparaison), barres ou cascade (WaterfallChart, rouge / vert seulement pour une cascade de coût).
// Sans valeur connue, la raison remplace le graphique ; une cascade n'est jamais tracée avec une valeur absente. `block` : titre du bloc
// qui contient le graphique ; le même titre n'est pas répété en texte visible (chartTitle), le libellé accessible le garde en entier.
export function ChartView({ c, block }: { c: CroiseeChart; block?: string }) {
  const testid = `cx-chart-${c.id}`;
  const label = `${c.title}, ${c.unit === "eur" ? "montants monétaires" : c.unit === "etp" ? "en équivalents temps plein" : "valeurs"}`;
  const title = chartTitle(block, c.title);
  if (c.kind === "cascade") {
    const w = cascadeOf(c);
    if (!w) return <NdNote label="Graphique non tracé" reason="valeur absente (voir le tableau exact)" testid={`${testid}-nd`} />;
    return <WaterfallChart testid={testid} label={label} title={title} startLabel={w.startLabel} endLabel={w.endLabel} start={w.start} end={w.end} steps={w.steps} unit={c.unit} trend={c.trend === "cost" ? "cost" : undefined} />;
  }
  if (c.kind === "courbe") {
    return (
      <ChartNd testid={testid} heading={title} series={c.series}>
        <LineChart testid={testid} label={label} title={title} categories={c.categories} categoryTitles={c.categoryTitles} series={c.series} unit={c.unit} />
      </ChartNd>
    );
  }
  return (
    <ChartNd testid={testid} heading={title} series={c.series}>
      <BarChart testid={testid} label={label} title={title} categories={c.categories} categoryTitles={c.categoryTitles} series={c.series} unit={c.unit} mode={c.mode} />
    </ChartNd>
  );
}

// Blocs du rapport historique non repris dans cette version : mention « Prévu », raison, renvois vers les écrans qui existent déjà.
function PrevuBlock({ chapter, items, slug }: { chapter: string; items: CxPrevu[]; slug: string }) {
  if (items.length === 0) return null;
  const titleId = `cx-${chapter}-prevu-titre`;
  return (
    <section className="panel cx-bud-block cx-bud-prevu" id={`cx-${chapter}-prevu`} aria-labelledby={titleId} data-testid={`cx-${chapter}-prevu`}>
      <h3 id={titleId} className="cx-bud-title">
        Non disponibles dans cette version
        <GlossaryLink slug={slug} term={CROISEE_TERMS.prevu} label="Prévu" />
      </h3>
      <ul className="cx-bud-prevu-list">
        {items.map((x) => (
          <li key={x.id} data-testid={`cx-prevu-${x.id}`}>
            <span className="tag">Prévu</span> <strong>{x.label}</strong> — {x.reason}
            {x.term && <GlossaryLink slug={slug} term={x.term} label={x.label} />}
            {x.links.map((l) => (
              <span key={l.href}>
                {" "}
                <a href={l.href}>
                  {l.label}
                  <span aria-hidden="true"> →</span>
                </a>
              </span>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}

// Limites de la lecture : une ligne chacune (elles changent l'interprétation d'un chiffre).
function Limits({ chapter, limits }: { chapter: string; limits: string[] }) {
  if (limits.length === 0) return null;
  return (
    <section className="cx-bud-limits" id={`cx-${chapter}-limites`} data-testid={`cx-${chapter}-limites`} aria-label="Limites de la lecture">
      <h3 className="cx-bud-limits-title">Limites de la lecture</h3>
      <ul>
        {limits.map((l) => (
          <li key={l} className="tile-foot">{l}</li>
        ))}
      </ul>
    </section>
  );
}
