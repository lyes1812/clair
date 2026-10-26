import type { PrevuLink } from "@/components/Prevu";
import { GlossaryLink } from "@/components/GlossaryLink";
import { CROISEE_TERMS } from "@/lib/glossary/croisee";

// Chapitre (ou bloc) « Prévu » : la mention, la raison en une ligne et les écrans de Clair qui couvrent déjà une partie du besoin.
// Aucun chiffre, aucune simulation. Mêmes classes que le gabarit Prévu commun (prevu-*), sans second titre de niveau 2 : le titre
// du chapitre est déjà en tête de page.
export function ChapterPrevu({ slug, id, reason, links = [], title }: { slug: string; id: string; reason: string; links?: PrevuLink[]; title?: string }) {
  return (
    <section className="panel cx-prevu" data-testid={`cx-prevu-${id}`} aria-label={title ?? "Prévu"}>
      {title && <h3>{title}</h3>}
      <div className="prevu-body">
        <p className="prevu-lead cx-prevu-state">
          <span className="tag">Prévu</span> {reason}
          <GlossaryLink slug={slug} term={CROISEE_TERMS.prevu} label="Prévu" />
        </p>
        {links.length > 0 && (
          <section className="prevu-block" aria-label="Ce qui existe déjà">
            <h3>Ce qui existe déjà</h3>
            <ul className="prevu-links">
              {links.map((l) => (
                <li key={l.href}>
                  <a href={l.href}>
                    <strong>{l.title}</strong>
                    <span>{l.text}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </section>
  );
}
