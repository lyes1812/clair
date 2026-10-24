import { definitionParagraphs, familyAnchor, glossaryEntry, glossaryHref, groupByFamily, QUERY_MAX, type GlossaryEntry } from "@/lib/glossary";

// Page Glossaire : en-tête, recherche, sommaire par famille puis les définitions groupées par famille. Composant serveur sans état :
// le filtre est déjà appliqué (paramètre d'adresse « q »), la page n'a besoin d'aucun script.
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`;

function Entry({ slug, entry, shown }: { slug: string; entry: GlossaryEntry; shown: Set<string> }) {
  const paragraphs = definitionParagraphs(entry.definition);
  // « Voir aussi » : seulement des entrées qui existent ; hors des résultats d'une recherche, le lien rouvre le glossaire entier.
  const see = (entry.see ?? []).flatMap((id) => {
    const target = glossaryEntry(id);
    return target && target.id !== entry.id ? [target] : [];
  });
  return (
    <article id={`def-${entry.id}`} className="gl-entry" aria-labelledby={`def-${entry.id}-terme`} data-testid={`glossaire-def-${entry.id}`}>
      <header className="gl-entry-head">
        <h3 id={`def-${entry.id}-terme`}>{entry.term}</h3>
        <a className="gl-perma" href={`#def-${entry.id}`} aria-label={`Lien vers la définition : ${entry.term}`}>#</a>
      </header>
      <div className="gl-entry-body">
        {entry.formula && (
          <p className="gl-formula" data-testid={`glossaire-formule-${entry.id}`}>
            <span className="gl-formula-label">Formule</span>
            <span className="gl-formula-text">{entry.formula}</span>
          </p>
        )}
        <div className="gl-def">
          {paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
        {see.length > 0 && (
          <p className="gl-see">
            <span className="gl-see-label">Voir aussi</span>
            {see.map((t) => (
              <a key={t.id} href={shown.has(t.id) ? `#def-${t.id}` : glossaryHref(slug, t.id)}>{t.term}</a>
            ))}
          </p>
        )}
      </div>
    </article>
  );
}

export function GlossaryView({ slug, query, entries, total }: { slug: string; query: string; entries: GlossaryEntry[]; total: number }) {
  const base = `/e/${slug}/glossaire`;
  const groups = groupByFamily(entries);
  const shown = new Set(entries.map((e) => e.id));
  return (
    <div className="gl-page" data-testid="glossaire">
      <header className="gl-head">
        <span className="label">Aide</span>
        <h1>Glossaire</h1>
        <p className="desc">Définitions des indicateurs, des méthodes de calcul et des conventions de lecture de Clair.</p>
      </header>

      <form className="filters bar gl-search" method="get" action={base} role="search" aria-label="Rechercher dans le glossaire" data-testid="glossaire-recherche">
        <div className="field-row">
          <label htmlFor="gl-q">Rechercher une définition</label>
          <input className="input" id="gl-q" type="search" name="q" defaultValue={query} maxLength={QUERY_MAX} autoComplete="off" placeholder="Un terme ou un mot de la définition" />
        </div>
        <button className="btn primary" type="submit">Rechercher</button>
        {query && <a className="btn" href={base} data-testid="glossaire-effacer">Effacer</a>}
      </form>

      <p className="desc gl-count-line" data-testid="glossaire-compte">
        {query ? `${plural(entries.length, "définition")} sur ${total}, pour « ${query} »` : plural(total, "définition")}
      </p>

      {groups.length === 0 ? (
        <div className="gl-empty" role="status" data-testid="glossaire-vide">
          <p className="gl-empty-title">Aucune définition ne correspond</p>
          <a href={base}>Afficher tout le glossaire</a>
        </div>
      ) : (
        <>
          <nav className="gl-toc" id="glossaire-sommaire" aria-label="Familles de définitions" data-testid="glossaire-sommaire">
            <ul>
              {groups.map((g) => (
                <li key={g.family}>
                  <a href={`#${familyAnchor(g.family)}`}>
                    <span>{g.family}</span>
                    <span className="gl-count">
                      <span aria-hidden="true">{g.entries.length}</span>
                      <span className="gl-sr">{`, ${plural(g.entries.length, "définition")}`}</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          {groups.map((g) => {
            const anchor = familyAnchor(g.family);
            return (
              <section key={g.family} id={anchor} className="gl-family" aria-labelledby={`${anchor}-titre`} data-testid={`glossaire-${anchor}`}>
                <div className="gl-family-head">
                  <h2 id={`${anchor}-titre`}>{g.family}</h2>
                  <span className="gl-count" aria-hidden="true">{g.entries.length}</span>
                  <a className="gl-top" href="#glossaire-sommaire">Sommaire</a>
                </div>
                <div className="gl-entries">
                  {g.entries.map((e) => (
                    <Entry key={e.id} slug={slug} entry={e} shown={shown} />
                  ))}
                </div>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
