"use client";

// Le choix d'affichage conserve l'adresse exacte fournie par chaque écran, avec ses filtres et ses références.
export type ViewOption = { key: string; label: string; href: string };
export type ViewSwitchProps = { options: ViewOption[]; current: string; label?: string; testid: string; resolveHref?: (href: string) => string };

export function ViewSwitch({ options, current, label = "Affichage", testid, resolveHref }: ViewSwitchProps) {
  const selected = options.find((option) => option.key === current) ?? options[0];
  return (
    <label className="view-select" data-testid={testid}>
      <span>Affichage</span>
      <select className="select" aria-label={label} value={selected?.href ?? ""} disabled={!selected}
        onChange={(event) => {
          const option = options.find((item) => item.href === event.currentTarget.value);
          if (option) window.location.assign(resolveHref ? resolveHref(option.href) : option.href);
        }}>
        {options.map((option) => <option key={option.key} value={option.href} data-view={option.key}>{option.label}</option>)}
      </select>
    </label>
  );
}
