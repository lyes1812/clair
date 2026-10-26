import { roundDiv } from "@/lib/budget/engine";
import { scopeKeyOf } from "@/lib/budget/grids";
import type { BaseContract, BaseSnapshot, Hypothesis } from "@/lib/budget/types";

// Lignes des grilles de saisie (Bases individuelles, Enveloppes, Hypothèses globales), communes à l'écran et à l'export Excel.
// Aucune valeur n'est déduite : ce sont les hypothèses enregistrées et la base figée du scénario.
export type BaseFix = Extract<Hypothesis, { kind: "base" }>;
export type Envelope = Extract<Hypothesis, { kind: "enveloppe" }>;
export type Constant = Extract<Hypothesis, { kind: "constante" }>;

// Corrections de base saisies, par contrat.
export const baseFixes = (hypotheses: Hypothesis[]): Map<string, BaseFix> => new Map(hypotheses.flatMap((h) => (h.kind === "base" ? [[h.contractKey, h] as const] : [])));
// Coût mensuel de la base d'un contrat : salaire + charges au taux observé du mois de référence (arrondi au centime) ; n.d. sans base.
export const baseMonthlyCost = (c: BaseContract): number | null => (c.base ? c.base.salaryCents + roundDiv(BigInt(c.base.salaryCents) * BigInt(c.base.refCotisationsCents), BigInt(c.base.refBrutCents)) : null);

// Enveloppes enregistrées d'un axe (centre de coûts ou rubrique), dans l'ordre de saisie.
export const envelopesOf = (hypotheses: Hypothesis[], axis: Envelope["axis"]): Envelope[] => hypotheses.filter((h): h is Envelope => h.kind === "enveloppe" && h.axis === axis);

// Constantes de référence enregistrées.
export const constantsOf = (hypotheses: Hypothesis[]): Constant[] => hypotheses.filter((h): h is Constant => h.kind === "constante");

// Taux d'augmentation de la grille, par « périmètre|mois » (points de base).
export function rateMap(hypotheses: Hypothesis[]): Map<string, number> {
  const rate = new Map<string, number>();
  for (const h of hypotheses) {
    if (h.kind !== "augmentation") continue;
    const k = scopeKeyOf(h.scope);
    if (k) rate.set(`${k}|${h.from}`, h.rateBps);
  }
  return rate;
}

// Périmètres de la grille des taux : toute l'entreprise, chaque service, puis les statuts cadre dirigeant / autres quand la base les
// renseigne (ou qu'un taux par statut existe). `label` : intitulé complet ; `short` et `note` : affichage sur deux lignes.
export type RateScope = { key: string; label: string; short: string; note: string | null };
export function rateScopes(base: BaseSnapshot, hypotheses: Hypothesis[]): { scopes: RateScope[]; statutNote: string | null } {
  const services = [...new Set([...base.contracts.map((c) => c.service), ...hypotheses.map((h) => (h.kind === "embauche" ? h.service : h.kind === "augmentation" && h.scope.kind === "service" ? h.scope.service : null))].filter((s): s is string => s !== null))].sort();
  // Statut « cadre dirigeant » de PayFit : lu dans le référentiel Collaborateurs et conservé dans la base figée du scénario.
  const dirigeants = base.contracts.filter((c) => c.executive === true).length;
  const autres = base.contracts.filter((c) => c.executive === false).length;
  const unknown = base.contracts.length - dirigeants - autres;
  const oldBase = base.contracts.every((c) => c.executive === undefined);
  const hasStatutHyp = hypotheses.some((h) => h.kind === "augmentation" && h.scope.kind === "statut");
  const showStatut = dirigeants + autres > 0 || hasStatutHyp;
  const statutNote = oldBase
    ? "Statut cadre dirigeant absent de la base figée de ce scénario (créé avant sa conservation) : créez un nouveau scénario pour l'utiliser."
    : dirigeants + autres === 0
      ? "Statut cadre dirigeant non renseigné dans les données lues (PayFit : champ estCadreDirigeant vide pour tous les contrats) : aucune ligne par statut."
      : unknown > 0
        ? `${unknown} contrat(s) sans statut renseigné ne reçoivent aucune augmentation par statut (seulement celles de leur service, de toute l'entreprise ou saisies sur eux).`
        : null;
  const count = (n: number) => `${n} contrat${n > 1 ? "s" : ""}`;
  const scopes: RateScope[] = [
    { key: "global", label: "Toute l'entreprise (hors embauches et entrées après la base)", short: "Toute l'entreprise", note: "hors embauches et entrées après la base" },
    ...services.map((s) => ({ key: `service:${s}`, label: `Service ${s}`, short: `Service ${s}`, note: null })),
    ...(showStatut
      ? [
          { key: "statut:dirigeant", label: `Cadres dirigeants (${count(dirigeants)})`, short: "Cadres dirigeants", note: count(dirigeants) },
          { key: "statut:autres", label: `Hors cadres dirigeants (${count(autres)})`, short: "Hors cadres dirigeants", note: count(autres) },
        ]
      : []),
  ];
  return { scopes, statutNote };
}
