import "@/styles/croisee-budget.css";
import { buildEffets, loadEffetsInput } from "@/lib/viz/croisee-budget";
import { BlocksChapter } from "./ChBudget";
import type { CroiseeContext } from "./context";

// Chapitre 08 · Effets d'évolution : décomposition de l'écart de masse entre N-1 et N en effet volume et effet coût moyen (pont de
// l'Analyse des écarts), cascade d'ETP, blocs « Prévu » (tuilages, effet de structure, hausses de base, masse / niveau / report).
// Aucun calcul ici : le modèle vient de buildEffets, comme les exports ; rendu commun avec le chapitre 06 (BlocksChapter).
export default async function ChEffets({ ctx }: { ctx: CroiseeContext }) {
  const model = buildEffets(await loadEffetsInput(ctx));
  return <BlocksChapter model={model} slug={ctx.slug} affichage={ctx.affichage} tableauHref={ctx.href({ affichage: "tableau" })} />;
}
