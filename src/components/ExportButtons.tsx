import "@/styles/export.css";
import { ExportMenu } from "./ExportMenu";

// Menu d'export d'un tableau : « Excel (.xlsx) » en premier, « CSV » conservé. Composant serveur, sans fonction en props : les
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
    <ExportMenu label={label} options={[
      { label: "Excel (.xlsx)", href: `${href}?${xlsx}`, testid: xlsxTestId },
      { label: "CSV (.csv)", href: csv ? `${href}?${csv}` : href, testid: csvTestId },
    ]} />
  );
}
