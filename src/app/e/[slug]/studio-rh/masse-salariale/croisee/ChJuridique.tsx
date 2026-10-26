import type { PrevuLink } from "@/components/Prevu";
import { ChapterPrevu } from "./atomes/ChapterPrevu";
import type { CroiseeContext } from "./context";

// Chapitre 10 · Bibliothèque juridique : « Prévu » en première version. Le catalogue du rapport d'origine (résumés de textes,
// versions lues à une date, liens, convention de l'entreprise) est un contenu éditorial figé, non repris : aucune convention collective
// ni aucun texte juridique n'est codé dans Clair. Aucune source lue : la raison, ce qui existe déjà (règles de l'espace, glossaire) et
// ce qui reste à décider pour une bibliothèque propre à l'espace.
export const JURIDIQUE_RAISON = "Aucune convention collective ni aucun texte juridique n'est codé dans Clair ; la bibliothèque de l'espace reste à définir.";

export function juridiqueLiens(slug: string): PrevuLink[] {
  return [
    { href: `/e/${slug}/parametres`, title: "Paramètres", text: "Règles de calcul de l'espace, saisies par un administrateur." },
    { href: `/e/${slug}/glossaire`, title: "Glossaire", text: "Définitions des indicateurs et des règles de calcul." },
  ];
}

export const JURIDIQUE_OUVERT = [
  "Bibliothèque de l'espace : références ajoutées par les éditeurs (titre, référence, thème, lien officiel, note), avec recherche et filtres.",
  "Sites officiels acceptés pour les liens : liste à arrêter.",
  "Favoris par utilisateur.",
  "Code de convention collective déclaré dans la DSN : non lu par Clair ; le lire est un choix à valider.",
  "Aucun résumé juridique rédigé par Clair : seulement des liens vers les textes officiels.",
];

export default function ChJuridique({ ctx }: { ctx: CroiseeContext }) {
  const id = ctx.chapter.id;
  return (
    <>
      <div id={`cx-${id}-prevu`}>
        <ChapterPrevu slug={ctx.slug} id={id} reason={JURIDIQUE_RAISON} links={juridiqueLiens(ctx.slug)} />
      </div>
      <section className="panel cx-prevu" id={`cx-${id}-ouvert`} data-testid={`cx-prevu-${id}-ouvert`} aria-labelledby={`cx-${id}-ouvert-titre`}>
        <div className="prevu-body">
          <section className="prevu-block">
            <h3 id={`cx-${id}-ouvert-titre`}>Reste à décider</h3>
            <ul className="prevu-open">
              {JURIDIQUE_OUVERT.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </section>
        </div>
      </section>
    </>
  );
}
