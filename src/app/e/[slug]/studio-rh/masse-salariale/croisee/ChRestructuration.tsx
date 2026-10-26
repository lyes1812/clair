import type { PrevuLink } from "@/components/Prevu";
import { ChapterPrevu } from "./atomes/ChapterPrevu";
import type { CroiseeContext } from "./context";

// Chapitre 09 · Restructuration : « Prévu » en première version. Toutes les entrées du rapport d'origine (coûts exceptionnels, paie
// avant et après, surcoûts, délai, horizon, suivi, cohorte) sont des hypothèses de projet saisies, aucune n'est lue dans les sources,
// et Clair n'a pas de calcul de délai de retour ni de point mort. Aucun chiffre, aucune simulation, aucune source lue : la raison, ce
// qui existe déjà dans Hypothèses budgétaires (scénarios, départs, mesures de management) et ce qui reste à décider.
export const RESTRUCTURATION_RAISON = "Hypothèses de projet à saisir ; délai de retour et point mort non calculés dans cette version.";

export function restructurationLiens(slug: string): PrevuLink[] {
  const h = `/e/${slug}/studio-rh/hypotheses`;
  return [
    { href: h, title: "Hypothèses budgétaires › Scénarios", text: "Scénarios de l'espace, avec leurs hypothèses datées." },
    { href: `${h}?vue=postes`, title: "Hypothèses budgétaires › Modifications de postes", text: "Départs : dernier jour payé, motif et coûts de sortie." },
    { href: `${h}?vue=resultat&sous=atterrissage`, title: "Hypothèses budgétaires › Résultat › Atterrissage", text: "Mesures de management : paie évitée, coûts de sortie, économie nette et année pleine par départ." },
  ];
}

export const RESTRUCTURATION_OUVERT = [
  "Délai de retour et point mort : nouveau calcul de projection rattaché à un scénario, chaque euro remontant à une hypothèse visible.",
  "Hypothèses du projet : coûts exceptionnels au lancement, paie récurrente avant et après, surcoûts hors paie, délai avant économies, horizon.",
  "Suivi du projet, personnes clés et coût mensuel par ETP avant et après : contenu à définir.",
];

export default function ChRestructuration({ ctx }: { ctx: CroiseeContext }) {
  const id = ctx.chapter.id;
  return (
    <>
      <div id={`cx-${id}-prevu`}>
        <ChapterPrevu slug={ctx.slug} id={id} reason={RESTRUCTURATION_RAISON} links={restructurationLiens(ctx.slug)} />
      </div>
      <section className="panel cx-prevu" id={`cx-${id}-ouvert`} data-testid={`cx-prevu-${id}-ouvert`} aria-labelledby={`cx-${id}-ouvert-titre`}>
        <div className="prevu-body">
          <section className="prevu-block">
            <h3 id={`cx-${id}-ouvert-titre`}>Reste à décider</h3>
            <ul className="prevu-open">
              {RESTRUCTURATION_OUVERT.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </section>
        </div>
      </section>
    </>
  );
}
