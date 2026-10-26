import { evolution, servicesOf, windowPayroll, withService, type Evolution, type JournalInput, type PayrollWindow } from "./engine";

// Lignes par service de la masse salariale : une seule règle pour l'écran Masse salariale (tableau « Services » et son export
// Excel, via syntheseOf) et pour la Masse salariale croisée (chapitres 01 et 05). Toujours calculées sur tout le journal : la somme
// des services, non ventilé compris, égale le total. Pour chaque service présent sur la période ou sur N-1 : masse de la période,
// masse de N-1 et évolution de la masse ; classement par coût de la période décroissant (un service n.d. après les services
// de coût positif ou nul), « Non ventilé » toujours en dernier. Aucun autre calcul que ceux du moteur de paie.

export type ServiceRow = { value: string | null; cur: PayrollWindow; prev: PayrollWindow; evo: Evolution };

// Libellé d'un service : son code analytique, ou « Non ventilé » pour les lignes sans code de l'axe.
export const serviceLabel = (v: string | null): string => (v === null ? "Non ventilé" : v);

// Sans axe de service dans le journal (aucun code analytique retenu) : aucune ligne.
export function serviceRows(journal: JournalInput, months: string[], prevMonths: string[]): ServiceRow[] {
  if (!journal.serviceAxis) return [];
  const rows = servicesOf(journal, [...months, ...prevMonths]).map((v): ServiceRow => {
    const si = withService(journal, v);
    const c = windowPayroll(si, months);
    const p = windowPayroll(si, prevMonths);
    return { value: v, cur: c, prev: p, evo: evolution(c, p, (w) => w.masse) };
  });
  const masseOf = (w: PayrollWindow) => (w.kind === "value" ? w.masse : -1);
  return rows.sort((a, b) => (a.value === null ? 1 : b.value === null ? -1 : masseOf(b.cur) - masseOf(a.cur)));
}
