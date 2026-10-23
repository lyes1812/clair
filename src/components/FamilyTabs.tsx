// Sous-onglets d'une famille du Studio RH (entrées du cahier) : un onglet « Prévu » est visible mais mène à une page
// qui dit ce qui reste à préciser, jamais à un écran inventé.
export type FamilyTab = { key: string; label: string; href: string; soon?: boolean };

export function FamilyTabs({ tabs, current, label, testid }: { tabs: FamilyTab[]; current: string; label: string; testid: string }) {
  return (
    <nav className="tabs" aria-label={label} data-testid={testid}>
      {tabs.map((t) => (
        <a key={t.key} href={t.href} aria-current={t.key === current ? "page" : undefined} data-tab={t.key}>
          {t.label}
          {t.soon && <span className="soon">Prévu</span>}
        </a>
      ))}
    </nav>
  );
}
