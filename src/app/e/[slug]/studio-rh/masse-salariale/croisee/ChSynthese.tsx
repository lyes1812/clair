import "@/styles/croisee-synthese.css";
import { BarChart, DonutChart, type Part } from "@/components/charts";
import { GlossaryLink } from "@/components/GlossaryLink";
import { MoneyText } from "@/components/Money";
import { buildSynthese, chartHasData, loadSyntheseInput, SYNTHESE_CX_TERMS as T, SYNTHESE_TABLE_IDS as ID, type SyntheseModel } from "@/lib/viz/croisee-synthese";
import { euros } from "@/lib/viz/masse";
import { NdLines, TrendLegend, type Affichage } from "../components";
import { AlertList, ModelTable, NdNote, Pliant, Tuiles } from "./atomes";
import type { CroiseeContext } from "./context";

// Chapitre 01 · Synthèse : six cartes, points à surveiller, masse chargée par mois (réel puis projection, budget saisi, N-1) et son
// tableau exact, composition de la masse chargée, chiffres clés en tableau. Le bloc .cx-syn (cartes, graphique principal, points à
// surveiller) est celui qu'imprime « Synthèse en PDF · 1 page ». Aucun calcul ici : le modèle vient de buildSynthese, comme les exports.
export default async function ChSynthese({ ctx }: { ctx: CroiseeContext }) {
  const model = buildSynthese(await loadSyntheseInput(ctx));
  return <SyntheseView model={model} slug={ctx.slug} affichage={ctx.affichage} />;
}

// Rendu synchrone du modèle (testé à part) ; « Affichage » : tout, graphiques seuls ou tableaux seuls. Les cartes et les points à
// surveiller sont toujours affichés.
export function SyntheseView({ model, slug, affichage }: { model: SyntheseModel; slug: string; affichage: Affichage }) {
  if (model.nd) {
    return (
      <section className="panel cx-syn-nd" data-testid="cx-synthese-nd" aria-label="Synthèse">
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
  const keyTables = [table(ID.montants), table(ID.rh)].filter((t) => t !== undefined);
  // Anneau : une part par série (valeur unique). Une part nulle ou négative n'a pas de secteur : elle est nommée sous l'anneau.
  const parts: Part[] = (comp?.series ?? []).map((s) => ({ key: s.key, name: s.name, value: s.values[0] ?? null, reason: s.reasons?.[0] ?? null, color: s.color }));
  const offRing = parts.filter((p) => p.value !== null && p.value <= 0).map((p) => `${p.name} (${euros(p.value as number)})`);
  return (
    <MoneyText>
      <>
        <div className="cx-syn" data-testid="cx-synthese">
          <section className="cx-syn-cards" id="cx-synthese-cartes" aria-label="Chiffres clés">
            <Tuiles tiles={model.tiles} chapter="synthese" slug={slug} testid="cx-synthese-cartes" />
            {(model.tileNd.length > 0 || model.trend) && (
              <div className="cx-syn-under">
                <NdLines lines={model.tileNd} testid="cx-synthese-cartes-nd" />
                {model.trend && <TrendLegend slug={slug} />}
              </div>
            )}
          </section>
          <div className="cx-syn-body">
            {main && mainTable && (
              <section className="panel cx-syn-chart" id="cx-synthese-graphique" aria-labelledby="cx-synthese-graphique-titre">
                <div className="cx-syn-head">
                  <h3 id="cx-synthese-graphique-titre">{main.title}</h3>
                  <GlossaryLink slug={slug} term={T.ecartBudget} label="Écart au budget saisi" />
                </div>
                {showGraph &&
                  (chartHasData(main) ? (
                    <BarChart testid="cx-chart-synthese-mensuel" label={`${main.title}, montants monétaires`} categories={main.categories} categoryTitles={main.categoryTitles} series={main.series} unit={main.unit} mode={main.mode} />
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
              <p className="tile-foot cx-syn-prevu" data-testid="cx-prevu-synthese-commentaire">
                <span className="tag">Prévu</span> Commentaire du mois
                <GlossaryLink slug={slug} term={T.commentaire} label="Commentaire du mois" />
              </p>
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
                  <a href={model.tableHref}>Afficher le tableau exact</a>
                </p>
              )}
            </div>
          </section>
        )}

        {showTable && keyTables.length > 0 && (
          <Pliant title="Chiffres clés en tableau" id="cx-synthese-chiffres" testid="cx-synthese-chiffres" open={affichage === "tableau"}>
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
