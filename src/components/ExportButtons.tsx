import "@/styles/export.css";

// Boutons d'export d'un tableau : « Excel (.xlsx) » en premier, « CSV » conservé. Composant serveur, sans fonction en props : les
// deux liens reprennent les paramètres d'adresse de la page (versions, période, niveau de détail…) et pointent vers la même route,
// qui produit du CSV par défaut et de l'Excel avec ?format=xlsx.
export function ExportButtons({
  href,
  params = "",
  label = "Exporter",
  xlsxTestId = "export-xlsx",
  csvTestId = "export-csv",
}: {
  href: string; // route d'export, sans paramètres
  params?: string | Record<string, string>; // paramètres d'adresse de la page (chaîne « a=1&b=2 » ou objet)
  label?: string;
  xlsxTestId?: string;
  csvTestId?: string;
}) {
  const base = new URLSearchParams(params);
  base.delete("format");
  const csv = base.toString();
  base.set("format", "xlsx");
  const xlsx = base.toString();
  return (
    <div className="export-buttons" role="group" aria-label={label}>
      <span className="export-label" aria-hidden="true">{label}&nbsp;:</span>
      <a className="btn" href={`${href}?${xlsx}`} data-testid={xlsxTestId}>Excel (.xlsx)</a>
      <a className="btn" href={csv ? `${href}?${csv}` : href} data-testid={csvTestId}>CSV</a>
    </div>
  );
}
