import { glossaryEntry, glossaryHref } from "@/lib/glossary";
import { GlossaryHelp } from './GlossaryHelp';
import '@/styles/glossary-help.css';

// Renvoi discret « ? » vers la définition d'un terme dans le glossaire : les écrans de chiffres n'expliquent pas, ils renvoient.
// Un identifiant inconnu ne produit aucun lien (jamais un lien mort).
export function GlossaryLink({ slug, term, label }: { slug: string; term: string; label?: string }) {
  const entry = glossaryEntry(term);
  if (!entry) return null;
  return (
    <GlossaryHelp href={glossaryHref(slug, term)} term={label ?? entry.term} definition={entry.definition} formula={entry.formula} />
  );
}
