import { DropdownMenu } from "./DropdownMenu";

export type ExportOption = { label: string; href: string; testid?: string };

/** N'affiche que les formats déjà proposés par la page, sans modifier leurs adresses. */
export function ExportMenu({ options, label = "Exporter", testid }: { options: ExportOption[]; label?: string; testid?: string }) {
  return <DropdownMenu label={label} testid={testid} className="export-menu">
    {options.map((option) => <a key={option.href} href={option.href} data-testid={option.testid}>{option.label}</a>)}
  </DropdownMenu>;
}
