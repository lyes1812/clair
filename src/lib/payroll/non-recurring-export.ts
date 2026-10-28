import type { SheetSpec, ExportCell } from "@/lib/export/xlsx";
import { buildActualNonRecurring, type ActualEvent } from "./non-recurring";
import type { ConfidentialiteSetting, PersonLink } from "@/lib/confidentialite";
import type { JournalInput } from "./engine";
import { maskNonRecurring } from "./non-recurring-mask";
import type { ServiceGuard } from "./service-rows";

const categories: [ActualEvent["kind"], string][] = [["licenciement", "Licenciements"], ["rupture-conventionnelle", "Ruptures conventionnelles"], ["tuilage", "Tuilages"], ["autre", "Autres éléments identifiés"]];
// conf : seuil de confidentialité, mêmes statuts que l'écran (maskNonRecurring) ; une nature masquée est n.d. sur toute sa ligne, un mois
// masqué d'une nature affichée l'est seul. guard : garde du filtre Service, la masse du service retenu est n.d. comme à l'écran.
export type NonRecurringConf = { link: PersonLink; confidentialite: ConfidentialiteSetting; guard: ServiceGuard | null };
export function actualNonRecurringSheet(input: JournalInput, events: ActualEvent[], months: string[], syncId: string | null, conf: NonRecurringConf): SheetSpec {
  const built = buildActualNonRecurring(input, events, months, syncId);
  const result = conf.guard ? { ...built, raw: null, adjusted: null, reasons: [conf.guard.reason, ...built.reasons] } : built;
  const mask = maskNonRecurring(result.rows, months, conf.link, conf.confidentialite);
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
      const hidden = mask[kind].reason;
      if (hidden) return [label, { nd: hidden }, ...months.map((): ExportCell => ({ nd: hidden })), { nd: hidden }, "Non affiché : seuil de confidentialité (voir l'onglet Filtres)."];
      const monthCell = (month: string): ExportCell => {
        const r = mask[kind].months[month];
        return r ? { nd: r } : sum(rows.filter((row) => row.event.month === month));
      };
      return [label, rows.length, ...months.map(monthCell), sum(rows), "Déclaration du client, rattachée à la lecture PayFit ; montants déjà compris dans la paie. Liste non exhaustive, aucun prorata de tuilage présumé."];
    }).concat([
      ["Masse chargée source", "", ...months.map(() => ""), money(result.raw, conf.guard?.reason ?? "masse source indisponible"), "Journal PayFit inchangé"],
      ["Éléments déclarés à isoler", result.rows.length, ...months.map(() => ""), money(result.nonRecurring, result.reasons.join(" ; ") || "montant manquant"), "Aucun total partiel"],
      ["Masse hors éléments identifiés", "", ...months.map(() => ""), money(result.adjusted, result.reasons.join(" ; ") || "retraitement indisponible"), "Masse source − éléments identifiés ; aucune écriture de paie modifiée"],
    ] as ExportCell[][]),
    note: "Ventilation analytique déclarée, non exhaustive. Aucun nom, binôme individuel ou note libre exporté. Saisie et valeurs exactes en euros, affichage indépendant du choix € / k€.",
  };
}
