// Page d'une entrée du menu qui n'est pas encore construite : on dit l'état en une phrase, ce qui existe déjà (avec un lien)
// et ce qui reste à préciser, sans jamais simuler un écran. Un seul gabarit pour toutes les familles.
export type PrevuLink = { href: string; title: string; text: string };

export function Prevu({ title, lead, existing = [], open = [], children }: { title: string; lead?: React.ReactNode; existing?: PrevuLink[]; open?: string[]; children?: React.ReactNode }) {
  return (
    <section className="panel" data-testid="prevu">
      <h2>{title} <span className="tag">Prévu</span></h2>
      <div className="prevu-body">
        {lead && <p className="prevu-lead">{lead}</p>}
        {children}
        {existing.length > 0 && (
          <section className="prevu-block" aria-label="Ce qui existe déjà">
            <h3>Ce qui existe déjà</h3>
            <ul className="prevu-links">
              {existing.map((l) => (
                <li key={l.href}><a href={l.href}><strong>{l.title}</strong><span>{l.text}</span></a></li>
              ))}
            </ul>
          </section>
        )}
        {open.length > 0 && (
          <section className="prevu-block" aria-label="Reste à préciser">
            <h3>Reste à préciser</h3>
            <ul className="prevu-open">{open.map((t) => <li key={t}>{t}</li>)}</ul>
          </section>
        )}
      </div>
    </section>
  );
}
