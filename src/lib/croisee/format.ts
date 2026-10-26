import type { PayrollContext } from "@/lib/payroll/context";
import { monthShortYear, sourceReason } from "@/lib/viz/masse";

// Mises en forme pures de la Masse salariale croisée, partagées par la page (croisee/context.ts les ré-exporte), les chapitres
// (src/lib/viz/croisee-*.ts) et les exports : aucune lecture, aucune dépendance à l'application ni à la base de données.

// Date courte, heure de Paris : « 10/02/2026 ».
export const dateFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeZone: "Europe/Paris" });

// Raison pour laquelle le journal de paie n'est pas lu (null quand il l'est) : lecture PayFit absente ou incomplète (raison du
// contexte de paie), ou source RH retenue = DSN (le journal PayFit n'est alors pas lu). Même texte dans la page, les chapitres et
// les exports.
export function journalReason(pay: Pick<PayrollContext, "input" | "unavailable" | "source">): string | null {
  if (pay.input) return null;
  if (pay.unavailable) return sourceReason(pay.unavailable);
  return pay.source === "dsn" ? "source RH retenue : DSN — journal de paie PayFit non lu" : "journal de paie indisponible";
}

// Mois non clos, en clair : « oct. 2026, nov. 2026 ».
export const openMonthsText = (ctx: { openMonths: readonly string[] }): string => ctx.openMonths.map(monthShortYear).join(", ");
