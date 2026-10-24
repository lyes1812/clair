import { glossaryEntry, glossaryHref } from "@/lib/glossary";

// Renvoi discret « ? » vers la définition d'un terme dans le glossaire : les écrans de chiffres n'expliquent pas, ils renvoient.
// Un identifiant inconnu ne produit aucun lien (jamais un lien mort).
export function GlossaryLink({ slug, term, label }: { slug: string; term: string; label?: string }) {
  const entry = glossaryEntry(term);
  if (!entry) return null;
  return (
    <a className="gloss-link" href={glossaryHref(slug, term)} aria-label={`Définition : ${label ?? entry.term}`} title={`Définition : ${label ?? entry.term}`}>?</a>
  );
}
