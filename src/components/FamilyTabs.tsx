// Sous-onglets d'une famille du Studio RH (entrées du cahier) : un onglet « Prévu » est visible mais mène à une page
// qui dit ce qui reste à préciser, jamais à un écran inventé.
export type FamilyTab = { key: string; label: string; href: string; soon?: boolean };
export type FamilyTabGroup = { key: string; label: string; keys: readonly string[] };
import { DropdownMenu } from './DropdownMenu';

export function FamilyTabs({ tabs, current, label, testid, groups }: { tabs: FamilyTab[]; current: string; label: string; testid: string; groups?: readonly FamilyTabGroup[] }) {
  const ordered = tabs.filter(tab => !tab.soon).concat(tabs.filter(tab => tab.soon));
  const item = (t: FamilyTab) => <a key={t.key} href={t.href} aria-current={t.key === current ? 'page' : undefined} data-tab={t.key} className={t.soon ? 'tab-planned' : undefined}>{t.label}{t.soon && <span className="soon">Prévu</span>}</a>;
  if (groups) return <nav className="tabs tabs-grouped" aria-label={label} data-testid={testid}>
    {groups.map(group => {
      const entries = ordered.filter(tab => group.keys.includes(tab.key));
      if (!entries.length) return null;
      if (entries.length === 1) return item(entries[0]);
      const selected = entries.find(tab => tab.key === current);
      return <DropdownMenu key={group.key} className={`family-tab-group${selected ? ' is-current' : ''}`} testid={`${testid}-group-${group.key}`} label={<span>{group.label}{selected && <small>{selected.label}</small>}</span>}>
        <div className="family-tab-entries">{entries.map(item)}</div>
      </DropdownMenu>;
    })}
    {ordered.filter(tab => !groups.some(group => group.keys.includes(tab.key))).map(item)}
  </nav>;
  return (
    <nav className="tabs" aria-label={label} data-testid={testid}>
      {ordered.map(item)}
    </nav>
  );
}
