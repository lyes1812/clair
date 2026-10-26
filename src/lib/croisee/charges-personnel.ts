import { RUBRICS, type RubricId, type RubricRole } from "@/lib/payroll/grid";

// Passage de la masse salariale chargée aux charges de personnel du journal de paie (Masse salariale croisée, chapitre 07).
// Fonction pure sur les soldes par rubrique déjà calculés par le moteur (windowPayroll / monthPayroll : byRubric, débit − crédit,
// en centimes) : chaque ligne reprend une rubrique de la grille de comptes de l'espace, sans reclassement ; les sous-totaux suivent
// le rôle fixe des rubriques (brut, cotisations, hors masse). Rémunération brute + cotisations patronales et taxes = masse chargée ;
// masse chargée + rubriques hors masse (provisions de congés payés, autres charges de personnel) = charges de personnel du journal.
// La somme des lignes de rubrique est égale au total. Une rubrique n.d. rend n.d. chaque sous-total qui la contient et le total :
// jamais une somme partielle, jamais un zéro.

export type Amount = number | { nd: string };
export type ChargesLineKind = "rubrique" | "sous-total" | "total";
export type ChargesLine = {
  key: RubricId | "brut" | "cotisations" | "masse" | "total";
  label: string;
  kind: ChargesLineKind;
  role: RubricRole | null; // rôle de la rubrique (null pour un sous-total ou le total)
  amount: Amount;
};
export type ChargesPassage = { lines: ChargesLine[]; brut: Amount; cotisations: Amount; masse: Amount; horsMasse: Amount; total: Amount };

// Libellés des sous-totaux et du total (les rubriques gardent le libellé de la grille).
export const CHARGES_LABELS = {
  brut: "Rémunération brute",
  cotisations: "Cotisations patronales et taxes",
  masse: "Masse salariale chargée",
  total: "Charges de personnel du journal",
} as const;

const isNd = (a: Amount): a is { nd: string } => typeof a === "object";

// Somme exacte de montants : n.d. dès qu'un terme l'est (raisons distinctes, dans l'ordre) ; une liste vide vaut 0 (aucune rubrique
// de ce rôle dans la grille : rien à additionner, ce n'est pas une donnée absente).
export function sumAmounts(list: readonly Amount[]): Amount {
  const reasons = [...new Set(list.filter(isNd).map((a) => a.nd))];
  if (reasons.length) return { nd: reasons.join(" ; ") };
  return (list as number[]).reduce((s, v) => s + v, 0);
}

// Écart a − b (N moins N-1) : n.d. si l'un des deux l'est.
export function amountGap(a: Amount, b: Amount): Amount {
  if (isNd(a)) return { nd: `période n.d. (${a.nd})` };
  if (isNd(b)) return { nd: `N-1 n.d. (${b.nd})` };
  return a - b;
}

// Passage complet, ligne par ligne, à partir des soldes par rubrique (montant ou n.d. par rubrique).
export function chargesPersonnel(byRubric: Readonly<Record<RubricId, Amount>>): ChargesPassage {
  const lines: ChargesLine[] = [];
  const rubricLines = (role: RubricRole): Amount[] =>
    RUBRICS.filter((r) => r.role === role).map((r) => {
      const amount = byRubric[r.id];
      lines.push({ key: r.id, label: r.label, kind: "rubrique", role, amount });
      return amount;
    });
  const brut = sumAmounts(rubricLines("brut"));
  lines.push({ key: "brut", label: CHARGES_LABELS.brut, kind: "sous-total", role: null, amount: brut });
  const cotisations = sumAmounts(rubricLines("cotisations"));
  lines.push({ key: "cotisations", label: CHARGES_LABELS.cotisations, kind: "sous-total", role: null, amount: cotisations });
  const masse = sumAmounts([brut, cotisations]);
  lines.push({ key: "masse", label: CHARGES_LABELS.masse, kind: "sous-total", role: null, amount: masse });
  const horsMasse = sumAmounts(rubricLines("hors-masse"));
  const total = sumAmounts([masse, horsMasse]);
  lines.push({ key: "total", label: CHARGES_LABELS.total, kind: "total", role: null, amount: total });
  return { lines, brut, cotisations, masse, horsMasse, total };
}

// Passage d'une fenêtre du moteur (windowPayroll) : soldes par rubrique quand la fenêtre est connue ; sinon chaque rubrique est n.d.
// avec la raison de la fenêtre (le total l'est donc aussi).
export type ChargesWindowIn = { kind: "value"; byRubric: Record<RubricId, number> } | { kind: "nd"; reason: string };
export function chargesOfWindow(w: ChargesWindowIn): ChargesPassage {
  const byRubric = Object.fromEntries(RUBRICS.map((r) => [r.id, w.kind === "value" ? w.byRubric[r.id] : { nd: w.reason }])) as Record<RubricId, Amount>;
  return chargesPersonnel(byRubric);
}
