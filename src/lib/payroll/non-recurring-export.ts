import type { SheetSpec, ExportCell } from "@/lib/export/xlsx";
import { buildActualNonRecurring, type ActualEvent } from "./non-recurring";
import type { JournalInput } from "./engine";

const categories: [ActualEvent["kind"], string][] = [["licenciement", "Licenciements"], ["rupture-conventionnelle", "Ruptures conventionnelles"], ["tuilage", "Tuilages"], ["autre", "Autres éléments identifiés"]];
export function actualNonRecurringSheet(input: JournalInput, events: ActualEvent[], months: string[], syncId: string | null): SheetSpec {
  const result = buildActualNonRecurring(input, events, months, syncId);
  const money = (value: number | null, reason: string): ExportCell => value === null ? { nd: reason } : value;
  return {
    name: "Non récurrents réalisés",
    columns: [{ key: "nature", header: "Nature", kind: "text", width: 32 }, { key: "count", header: "Éléments identifiés", kind: "nombre" }, ...months.map((month) => ({ key: month, header: month, kind: "eur" as const })), { key: "total", header: "Total chargé identifié", kind: "eur" }, { key: "reason", header: "Source et limites", kind: "text", width: 56 }],
    rows: categories.map(([kind, label]) => {
      const rows = result.rows.filter((row) => row.event.kind === kind);
      const sum = (selected: typeof rows): ExportCell => {
        if (!selected.length) return "Aucun élément identifié";
        const reasons = selected.filter((row) => row.amount === null).map((row) => row.reason ?? "montant chargé à renseigner");
        if (reasons.length) return { nd: [...new Set(reasons)].join(" ; ") };
        const total = selected.reduce((value, row) => value + BigInt(row.amount!), 0n);
        return total > BigInt(Number.MAX_SAFE_INTEGER) || total < BigInt(Number.MIN_SAFE_INTEGER) ? { nd: "somme hors borne entière exacte" } : Number(total);
      };
      const estimates = rows.filter((row) => row.event.calculation).length;
      const source = estimates ? `${estimates} estimation${estimates > 1 ? "s" : ""} calendaire${estimates > 1 ? "s" : ""} : coût chargé mensuel de l’entrant × jours de chevauchement ÷ jours de présence de l’entrant. Primes et régularisations non ventilées par jour. Autres montants : déclarations du client. Paie inchangée, liste non exhaustive.`
        : "Déclaration du client, rattachée à la lecture PayFit ; montants déjà compris dans la paie. Liste non exhaustive, aucun prorata de tuilage présumé.";
      return [label, rows.length, ...months.map((month) => sum(rows.filter((row) => row.event.month === month))), sum(rows), source];
    }).concat([
      ["Masse chargée source", "", ...months.map(() => ""), money(result.raw, "masse source indisponible"), "Journal PayFit inchangé"],
      ["Éléments déclarés à isoler", result.rows.length, ...months.map(() => ""), money(result.nonRecurring, result.reasons.join(" ; ") || "montant manquant"), "Aucun total partiel"],
      ["Masse hors éléments identifiés", "", ...months.map(() => ""), money(result.adjusted, result.reasons.join(" ; ") || "retraitement indisponible"), "Masse source − éléments identifiés ; aucune écriture de paie modifiée"],
    ] as ExportCell[][]),
    note: "Ventilation analytique déclarée ou estimation calendaire explicitement indiquée, non exhaustive. Aucun nom, binôme individuel ou note libre exporté. Montants en euros, affichage indépendant du choix € / k€.",
  };
}
