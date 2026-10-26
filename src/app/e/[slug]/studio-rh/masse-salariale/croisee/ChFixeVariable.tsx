import "@/styles/croisee-masse.css";
import { BarChart, DonutChart, type Part } from "@/components/charts";
import { GlossaryLink } from "@/components/GlossaryLink";
import { MoneyText } from "@/components/Money";
import { CROISEE_TERMS } from "@/lib/glossary/croisee";
import type { ChapterId, CroiseeTable, SortDir } from "@/lib/viz/croisee";
import { buildFixeVariable, loadFixeVariableInput, type FixeVariableModel, type MasseBlock, type MasseChart, type PrevuItem } from "@/lib/viz/croisee-masse";
import { capital } from "@/lib/viz/masse";
import { ChartGuard, GraphFoot, NdLines, NdState, TrendLegend, type Affichage } from "../components";
import { ModelTable } from "./atomes/ModelTable";
import { NdNote } from "./atomes/NdNote";
import { Tuiles } from "./atomes/Tuile";
import type { CroiseeContext } from "./context";

// Chapitre 04 · Fixe & variable. Le composant lit l'entrée du chapitre (lecteurs du contexte, mêmes fonctions que l'onglet Fixe &
// variable de la Masse salariale), construit le modèle par la fonction pure buildFixeVariable (le même que celui des exports) et le
// rend : cartes, graphiques suivis de leur tableau exact, tableaux, indicateurs « Prévu » avec leur raison, limites de la lecture.
export default async function ChFixeVariable({ ctx }: { ctx: CroiseeContext }) {
  const model = buildFixeVariable(await loadFixeVariableInput(ctx));
  return <FixeVariableChapter model={model} slug={ctx.slug} affichage={ctx.affichage} tableauHref={ctx.href({ affichage: "tableau" })} />;
}

// Rendu synchrone du modèle (testé tel quel). « Graphiques » : cartes et blocs de graphique, chaque graphique avec un lien vers son
// tableau exact ; « Tableaux » : cartes et tableaux ; « Afficher tout » : tout.
export function FixeVariableChapter({ model, slug, affichage, tableauHref }: { model: FixeVariableModel; slug: string; affichage: Affichage; tableauHref: string }) {
  if (model.nd) return <NdState testid="cx-fixe-variable-nd" reason={capital(model.nd.reason)} action={model.nd.action} />;
  return (
    <div className="cx-masse" data-testid="cx-fixe-variable">
      <section className="cx-masse-cards" id="cx-fixe-variable-cartes" aria-label="Chiffres clés" data-testid="cx-fixe-variable-cartes">
        <Tuiles tiles={model.tiles} chapter="fixe-variable" slug={slug} testid="cx-tiles-fixe-variable" />
        {(model.tileNd.length > 0 || model.trend) && (
          <div className="cx-masse-under">
            <NdLines lines={model.tileNd} testid="cx-fixe-variable-cartes-nd" />
            {model.trend && <TrendLegend slug={slug} />}
          </div>
        )}
      </section>
      <MasseBlocks chapter="fixe-variable" model={model} slug={slug} affichage={affichage} tableauHref={tableauHref} />
      {affichage !== "graphique" && <PrevuList chapter="fixe-variable" items={model.prevu} slug={slug} />}
      <Limits chapter="fixe-variable" limits={model.limits} />
    </div>
  );
}

// --- Rendu commun aux chapitres 04 et 05 (repris par ChServices) --------------------------------------------------------------------

export type SortProps = { base: string; tri: string | null; sens: SortDir | null };
type BlocksModel = { blocks: MasseBlock[]; charts: MasseChart[]; tables: CroiseeTable[] };
type BlockProps = { chapter: ChapterId; slug: string; affichage: Affichage; tableauHref: string; sort?: SortProps };

// Blocs dans l'ordre du modèle ; deux blocs consécutifs en demi-largeur partagent une rangée.
export function MasseBlocks({ model, ...p }: BlockProps & { model: BlocksModel }) {
  const shown = model.blocks.filter((b) => (p.affichage === "graphique" ? b.graph : p.affichage === "tableau" ? b.tables.length > 0 || b.nd.length > 0 || !b.graph : true));
  const groups: MasseBlock[][] = [];
  for (const b of shown) {
    const last = groups.at(-1);
    if (b.half && last && last[0].half && last.length < 2) last.push(b);
    else groups.push([b]);
  }
  return (
    <>
      {groups.map((g) =>
        g.length > 1 || g[0].half ? (
          <div key={g[0].id} className="cx-masse-halves">
            {g.map((b) => (
              <Block key={b.id} b={b} model={model} {...p} />
            ))}
          </div>
        ) : (
          <Block key={g[0].id} b={g[0]} model={model} {...p} />
        ),
      )}
    </>
  );
}

function Block({ b, model, chapter, slug, affichage, tableauHref, sort }: BlockProps & { b: MasseBlock; model: BlocksModel }) {
  const showChart = affichage !== "tableau";
  const showTable = affichage !== "graphique";
  const charts = b.charts.map((id) => model.charts.find((c) => c.id === id)).filter((c): c is MasseChart => Boolean(c));
  const tables = b.tables.map((id) => model.tables.find((t) => t.id === id)).filter((t): t is CroiseeTable => Boolean(t));
  const titleOf = (id: string) => model.tables.find((t) => t.id === id)?.title ?? "tableau exact";
  const titleId = `cx-${chapter}-${b.id}-titre`;
  return (
    <MoneyText>
      <section className="panel cx-masse-block" id={`cx-${chapter}-${b.id}`} aria-labelledby={titleId} data-testid={`cx-${chapter}-${b.id}`}>
        <div className="cx-masse-head">
          <h3 id={titleId} className="cx-masse-title">
            {b.title}
            {b.term && <GlossaryLink slug={slug} term={b.term} label={b.title} />}
          </h3>
          {b.badge && <span className="tag">{b.badge}</span>}
        </div>
        {b.nd.map((n, i) => (
          <NdNote key={`${n.label ?? ""}-${i}`} label={n.label} reason={n.reason} action={n.action} testid={`cx-${chapter}-${b.id}-nd${i === 0 ? "" : `-${i + 1}`}`} />
        ))}
        {b.notes.map((n) => (
          <p key={n} className="tile-foot cx-masse-note">{n}</p>
        ))}
        {showChart && charts.length > 0 && (
          <div className={charts.length > 1 ? "cx-masse-charts" : "cx-masse-charts one"}>
            {charts.map((c) => (
              <div key={c.id} className="cx-masse-chart">
                <MasseChartView c={c} titled={c.title !== b.title} />
                <GraphFoot aff={affichage} tableHref={`${tableauHref}#cx-table-${c.tableId}`} testid={`cx-chart-${c.id}-tableau`} />
                {affichage === "tout" && !b.tables.includes(c.tableId) && (
                  <p className="tile-foot cx-masse-link" data-testid={`cx-chart-${c.id}-lien`}>
                    <a href={`#cx-table-${c.tableId}`}>Valeurs exactes : tableau « {titleOf(c.tableId)} »</a>
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
        {showTable &&
          tables.map((t) => <ModelTable key={t.id} table={t} slug={slug} {...(sort && t.columns.some((c) => c.sortable) ? { sortBase: sort.base, tri: sort.tri, sens: sort.sens } : {})} />)}
        {showTable && b.trend && <TrendLegend slug={slug} />}
      </section>
    </MoneyText>
  );
}

// Graphique du modèle : barres ou anneau (séries déjà calculées, n.d. hachurés ou listés avec leur raison) ; sans aucune valeur connue,
// la raison remplace le graphique (ChartGuard). Props sérialisables : unité nommée, jamais de fonction.
// titled : le titre du graphique est omis quand il répète celui de son bloc (il reste dans l'étiquette lue par les lecteurs d'écran).
export function MasseChartView({ c, titled = true }: { c: MasseChart; titled?: boolean }) {
  const testid = `cx-chart-${c.id}`;
  const label = `${c.title}, montants monétaires`;
  const title = titled ? c.title : undefined;
  if (c.kind === "anneau") {
    const parts: Part[] = c.series.map((s) => ({ key: s.key, name: s.name, value: s.values[0] ?? null, reason: s.reasons?.[0] ?? null, color: s.color }));
    return (
      <ChartGuard testid={testid} title={c.title} series={c.series}>
        <DonutChart testid={testid} label={label} title={title} parts={parts} unit={c.unit} centerLabel={c.centerLabel} note={c.note} />
      </ChartGuard>
    );
  }
  return (
    <ChartGuard testid={testid} title={c.title} series={c.series}>
      <BarChart testid={testid} label={label} title={title} categories={c.categories} categoryTitles={c.categoryTitles} series={c.series} unit={c.unit} mode={c.mode} toggle={c.mode === "stacked" && c.series.length > 1} note={c.note} />
    </ChartGuard>
  );
}

// Indicateurs que Clair ne lit pas : mention « Prévu », la raison, le renvoi au glossaire ; aucun chiffre.
export function PrevuList({ chapter, items, slug }: { chapter: ChapterId; items: PrevuItem[]; slug: string }) {
  if (items.length === 0) return null;
  const titleId = `cx-${chapter}-prevu-titre`;
  return (
    <section className="panel cx-masse-block cx-masse-prevu" id={`cx-${chapter}-prevu`} aria-labelledby={titleId} data-testid={`cx-${chapter}-prevu`}>
      <h3 id={titleId} className="cx-masse-title">
        Non disponibles dans cette version
        <GlossaryLink slug={slug} term={CROISEE_TERMS.prevu} label="Prévu" />
      </h3>
      <ul className="cx-masse-prevu-list">
        {items.map((x) => (
          <li key={x.id} data-testid={`cx-prevu-${x.id}`}>
            <span className="tag">Prévu</span> <strong>{x.label}</strong> — {x.reason}
            <GlossaryLink slug={slug} term={x.term} label={x.label} />
          </li>
        ))}
      </ul>
    </section>
  );
}

// Limites de la lecture : une ligne chacune (elles changent l'interprétation d'un chiffre).
export function Limits({ chapter, limits }: { chapter: ChapterId; limits: string[] }) {
  if (limits.length === 0) return null;
  return (
    <section className="cx-masse-limits" id={`cx-${chapter}-limites`} data-testid={`cx-${chapter}-limites`} aria-label="Limites de la lecture">
      <h3 className="cx-masse-limits-title">Limites de la lecture</h3>
      <MoneyText>
        <ul>
          {limits.map((l) => (
            <li key={l} className="tile-foot">{l}</li>
          ))}
        </ul>
      </MoneyText>
    </section>
  );
}
