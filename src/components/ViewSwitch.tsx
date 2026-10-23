// « Afficher tout / Graphique / Tableau » : bascule d'affichage d'un écran d'analyse (outil observé), portée par l'adresse.
export type ViewOption = { key: string; label: string; href: string };

export function ViewSwitch({ options, current, label = "Affichage", testid }: { options: ViewOption[]; current: string; label?: string; testid: string }) {
  return (
    <nav className="view-switch" aria-label={label} data-testid={testid}>
      {options.map((o) => (
        <a key={o.key} href={o.href} aria-current={o.key === current ? "page" : undefined} data-view={o.key}>{o.label}</a>
      ))}
    </nav>
  );
}
