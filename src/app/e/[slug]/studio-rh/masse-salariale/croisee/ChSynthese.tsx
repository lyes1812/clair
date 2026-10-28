import "@/styles/croisee-synthese.css";
import { BarChart, DonutChart, WaterfallChart, type Part } from "@/components/charts";
import { GlossaryLink } from "@/components/GlossaryLink";
import { MoneyText } from "@/components/Money";
import { cascadeOf } from "@/lib/viz/croisee-budget";
import { chartHasData, syntheseModel, SYNTHESE_CX_TERMS as T, SYNTHESE_TABLE_IDS as ID, type SyntheseBlock, type SyntheseBlockId, type SyntheseModel } from "@/lib/viz/croisee-synthese";
import { euros } from "@/lib/viz/masse";
import { NdLines, TrendLegend, type Affichage } from "../components";
import { AlertList, chartTitle, ModelTable, NdNote, Pliant, Tuiles } from "./atomes";
import type { CroiseeContext } from "./context";

// Chapitre 01 · Synthèse : six cartes, points à surveiller, masse chargée par mois (réel, projection, budget saisi, N-1) et son
// tableau exact, composition de la masse chargée, cascade de l'écart de coût, tableau par service, chiffres clés en tableau. Le bloc
// .cx-syn (cartes, graphique principal, points à surveiller) est celui qu'imprime « Synthèse en PDF · 1 page ». Aucun calcul ici :
// le modèle vient de syntheseModel (mémoïsé par requête), le même que celui des exports.
export default async function ChSynthese({ ctx }: { ctx: CroiseeContext }) {
  const model = await syntheseModel(ctx);
  return <SyntheseView model={model} slug={ctx.slug} affichage={ctx.affichage} />;
}

const blockOf = (model: SyntheseModel, id: SyntheseBlockId): SyntheseBlock | undefined => model.blocks.find((b) => b.id === id);

// n.d. d'un bloc : la raison écrite et l'action qui y remédie.
function BlockNdNotes({ block, testid }: { block: SyntheseBlock | undefined; testid: string }) {
  if (!block || block.nd.length === 0) return null;
  return (
    <>
      {block.nd.map((n, i) => (
        <NdNote key={`${n.reason}-${i}`} label={n.label} reason={n.reason} action={n.action} testid={i === 0 ? testid : `${testid}-${i}`} />
      ))}
    </>
  );
}

// Rendu synchrone du modèle (testé à part) ; « Affichage » : tout, graphiques seuls ou tableaux seuls. Les cartes et les points à
// surveiller sont toujours affichés.
export function SyntheseView({ model, slug, affichage }: { model: SyntheseModel; slug: string; affichage: Affichage }) {
  if (model.nd) {
    // Classe .cx-syn : la Synthèse en PDF d'une page imprime aussi ce n.d. (jamais une page blanche).
    return (
      <section className="panel cx-syn cx-syn-nd" data-testid="cx-synthese-nd" aria-label="Synthèse">
        <NdNote label="Synthèse" reason={model.nd.reason} action={model.nd.action} />
      </section>
    );
  }
  const showGraph = affichage !== "tableau";
  const showTable = affichage !== "graphique";
  const table = (id: string) => model.tables.find((t) => t.id === id);
  const chart = (id: string) => model.charts.find((c) => c.id === id);
  const main = chart(ID.mensuel);
  const mainTable = table(ID.mensuel);
  const comp = chart(ID.composition);
  const compTable = table(ID.composition);
  const cascade = chart(ID.cascade);
  const cascadeTable = table(ID.cascade);
  const cascadeView = cascade ? cascadeOf(cascade) : null;
  // Titre du bloc repliable de la cascade : celui du modèle ; le graphique ne le répète pas en texte visible (chartTitle).
  const cascadeTitle = blockOf(model, "cascade")?.title ?? "D'où vient l'écart de coût ?";
  const services = table(ID.services);
  const keyTables = (blockOf(model, "chiffres")?.tables ?? []).map(table).filter((t) => t !== undefined);
  const folded = model.print.folded;
  // Anneau : une part par série (valeur unique). Une part nulle ou négative n'a pas de secteur : elle est nommée sous l'anneau.
  const parts: Part[] = (comp?.series ?? []).map((s) => ({ key: s.key, name: s.name, value: s.values[0] ?? null, reason: s.reasons?.[0] ?? null, color: s.color }));
  const offRing = parts.filter((p) => p.value !== null && p.value <= 0).map((p) => `${p.name} (${euros(p.value as number)})`);
  return (
    <MoneyText>
      <>
        <div className="cx-syn" data-testid="cx-synthese">
          <section className="cx-syn-cards" id="cx-synthese-cartes" aria-label="Chiffres clés">
            <Tuiles tiles={model.tiles} chapter="synthese" slug={slug} testid="cx-synthese-cartes" />
            {model.trend && (
              <div className="cx-syn-under">
                <TrendLegend slug={slug} />
              </div>
            )}
          </section>
          <div className="cx-syn-body">
            {main && mainTable && (
              <section className={`panel cx-syn-chart${showGraph ? " with-graph" : ""}`} id="cx-synthese-graphique" aria-labelledby="cx-synthese-graphique-titre">
                <div className="cx-syn-head">
                  <h3 id="cx-synthese-graphique-titre">{main.title}</h3>
                  <GlossaryLink slug={slug} term={T.atterrissage} label="Atterrissage annuel (réel + projection)" />
                </div>
                {showGraph &&
                  (chartHasData(main) ? (
                    <BarChart testid="cx-chart-synthese-mensuel" label={`${main.title}, montants monétaires`} categories={main.categories} categoryTitles={main.categoryTitles} series={main.series} unit={main.unit} mode={main.mode} note={main.note} />
                  ) : (
                    <NdNote label="Graphique non tracé" reason="aucune valeur connue sur l'année (raisons dans le tableau exact)" testid="cx-chart-synthese-mensuel-nd" />
                  ))}
                {showTable && (
                  <div className="cx-syn-table">
                    <ModelTable table={mainTable} slug={slug} />
                  </div>
                )}
                {!showTable && (
                  <p className="tile-foot cx-syn-tablelink">
                    <a href={model.tableHref}>Afficher le tableau exact</a>
                  </p>
                )}
              </section>
            )}
            <aside className="cx-syn-side" id="cx-synthese-alertes" aria-label="Points à surveiller">
              <AlertList alerts={model.alerts} slug={slug} id="cx-synthese-alertes-liste" />
              {folded > 0 && (
                <p className="tile-foot cx-syn-print-more" data-testid="cx-synthese-print-more">
                  {`+ ${folded} ${folded > 1 ? "autres repères" : "autre repère"} (liste complète à l'écran)`}
                </p>
              )}
              {model.mentions.map((m) => (
                <p key={m.id} className="tile-foot cx-syn-mention" data-testid={`cx-mention-${m.id}`}>
                  {m.text}
                  {m.href && (
                    <>
                      {" "}
                      <a href={m.href}>
                        {m.linkLabel ?? "Paramètres"}
                        <span aria-hidden="true"> →</span>
                      </a>
                    </>
                  )}
                </p>
              ))}
              {model.prevu.map((p) => (
                <p key={p.id} className="tile-foot cx-syn-prevu" data-testid={`cx-prevu-synthese-${p.id}`} title={p.reason}>
                  <span className="tag">Prévu</span> {p.label}
                  <GlossaryLink slug={slug} term={p.term} label={p.label} />
                </p>
              ))}
            </aside>
          </div>
          {model.limits.length > 0 && (
            <p className="tile-foot cx-syn-limits" data-testid="cx-synthese-limites">
              Limites de la lecture : {model.limits.join(" · ")}
              <GlossaryLink slug={slug} term={T.etpProratise} label="ETP contractuel proratisé" />
            </p>
          )}
        </div>

        {comp && compTable && (
          <section className="panel cx-syn-composition" id="cx-synthese-composition" aria-labelledby="cx-synthese-composition-titre">
            <div className="cx-syn-head">
              <h3 id="cx-synthese-composition-titre">{comp.title}</h3>
              <GlossaryLink slug={slug} term={T.fixeVariable} label="Fixe et variable" />
            </div>
            <div className={showGraph && showTable ? "cx-syn-comp-body" : "cx-syn-comp-body one"}>
              {showGraph &&
                (chartHasData(comp) ? (
                  <DonutChart
                    testid="cx-chart-synthese-composition"
                    label={`${comp.title}, montants monétaires`}
                    parts={parts}
                    unit={comp.unit}
                    centerLabel="masse chargée"
                    note={offRing.length ? `Hors anneau (montant nul ou négatif) : ${offRing.join(" ; ")}.` : undefined}
                  />
                ) : (
                  <NdNote label="Graphique non tracé" reason={parts.find((p) => p.reason)?.reason ?? "aucune valeur connue sur la période"} testid="cx-chart-synthese-composition-nd" />
                ))}
              {showTable && <ModelTable table={compTable} slug={slug} />}
              {!showTable && (
                <p className="tile-foot cx-syn-tablelink">
                  <a href={model.tableHrefs.composition}>Afficher le tableau exact</a>
                </p>
              )}
            </div>
          </section>
        )}

        <Pliant title={cascadeTitle} id="cx-synthese-cascade" testid="cx-synthese-cascade" open={affichage === "tableau"} term={T.cascades} slug={slug}>
          <BlockNdNotes block={blockOf(model, "cascade")} testid="cx-synthese-cascade-nd" />
          {cascade && showGraph &&
            (cascadeView ? (
              <WaterfallChart
                testid="cx-chart-synthese-cascade"
                label={`${cascade.title}, montants monétaires`}
                title={chartTitle(cascadeTitle, cascade.title)}
                startLabel={cascadeView.startLabel}
                endLabel={cascadeView.endLabel}
                start={cascadeView.start}
                end={cascadeView.end}
                steps={cascadeView.steps}
                unit={cascade.unit}
                trend="cost"
              />
            ) : (
              <NdNote label="Graphique non tracé" reason="valeur absente (voir le tableau exact)" testid="cx-chart-synthese-cascade-nd" />
            ))}
          {cascadeTable && showTable && <ModelTable table={cascadeTable} slug={slug} />}
          {cascadeTable && !showTable && (
            <p className="tile-foot cx-syn-tablelink">
              <a href={model.tableHrefs.cascade}>Afficher le tableau exact</a>
            </p>
          )}
        </Pliant>

        {showTable && (
          <Pliant title="Tableau de synthèse par service" id="cx-synthese-services" testid="cx-synthese-services" open={affichage === "tableau"} term={T.service} slug={slug}>
            <BlockNdNotes block={blockOf(model, "services")} testid="cx-synthese-services-nd" />
            {model.servicesNote && (
              <p className="tile-foot" data-testid="cx-synthese-services-note">{model.servicesNote}</p>
            )}
            {services && <ModelTable table={services} slug={slug} />}
            {(blockOf(model, "services")?.notes ?? []).map((n) => (
              <p key={n} className="tile-foot">{n}</p>
            ))}
          </Pliant>
        )}

        {showTable && keyTables.length > 0 && (
          <Pliant title="Chiffres clés en tableau" id="cx-synthese-chiffres" testid="cx-synthese-chiffres" open={affichage === "tableau"}>
            <NdLines lines={model.tileNd} testid="cx-synthese-cartes-nd" />
            {keyTables.map((t) => (
              <ModelTable key={t.id} table={t} slug={slug} />
            ))}
          </Pliant>
        )}

        {model.links.length > 0 && (
          <nav className="cx-syn-links" aria-label="Pour aller plus loin" data-testid="cx-synthese-liens">
            {model.links.map((l) => (
              <a key={l.href} href={l.href}>
                {l.label}
                <span aria-hidden="true"> ›</span>
              </a>
            ))}
          </nav>
        )}
      </>
    </MoneyText>
  );
}
