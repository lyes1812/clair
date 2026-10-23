// Module 5 — Hypothèses budgétaires : types de la base figée, des hypothèses et de la projection.
// Montants en centimes entiers (EUR), taux en points de base (1 % = 100), quotités et ETP en dix-millièmes (1 = 10 000).

export const CURRENCY = "EUR";

// --- Base figée : copie, à la création du scénario, du réel jusqu'au mois de référence (mois qui précède la bascule)
// et du coût de référence de chaque contrat présent à la fin de ce mois. Jamais recalculée ensuite.
// Catégories de contrat suivies dans les effectifs et les ETP.
export type CategoryId = "cdi" | "cdd" | "apprenti" | "stagiaire";
export const CATEGORY_IDS: CategoryId[] = ["cdi", "cdd", "apprenti", "stagiaire"];
export const CATEGORY_LABELS: Record<CategoryId, string> = { cdi: "CDI", cdd: "CDD", apprenti: "Apprenti", stagiaire: "Stagiaire" };

export type BaseContract = {
  contractKey: string;
  externalId: string;
  label: string; // personne (nom d'usage ou nom) — affichage seulement
  service: string | null; // code analytique du mois de référence (null : non ventilé)
  serviceNd: string | null; // raison d'un service null (ex. lignes réparties sur plusieurs codes)
  startDate: string | null;
  endDate: string | null; // fin de contrat connue à la création (ex. CDD) : la projection s'arrête à cette date
  counted: boolean; // nature comptée dans l'effectif (paramètre KPI de l'espace)
  etp4: number | null; // ETP fin du mois de référence
  etpNd: string | null;
  nature?: string | null; // code de nature DSN du contrat
  category?: CategoryId | null; // catégorie proposée depuis la nature (modifiable par une hypothèse « catégorie »)
  baseNote?: string | null; // base reconstituée par une règle (ex. entrée en cours du mois de référence)
  // Base de coût : rubriques Salaires (et gratifications de stage) du mois de référence ; charges au taux observé du
  // contrat ce mois-là (cotisations ÷ brut total). n.d. avec raison si le mois de référence ne la donne pas.
  base: { salaryCents: number; refBrutCents: number; refCotisationsCents: number } | null;
  baseNd: string | null;
};

export type ActualMonth =
  | { month: string; kind: "value"; brut: number; cotisations: number; masse: number; headcount: number | null; etp4: number | null; etpNd: string | null }
  | { month: string; kind: "nd"; reason: string };

export type BaseSnapshot = {
  currency: typeof CURRENCY;
  refMonth: string; // AAAA-MM, dernier mois clos avant la bascule
  syncId: string; // lecture PayFit appliquée à la création
  readAt: string; // date de la lecture
  contracts: BaseContract[];
  actuals: ActualMonth[]; // mois lus jusqu'au mois de référence inclus
  // Rapprochement du mois de référence : masse du journal = base des contrats + éléments hors base (primes, indemnités,
  // contrats sortis, lignes sans contrat), pour que la base se lise contre le réel.
  refMasse: number;
  refBaseCost: number | null; // null si une base de contrat est n.d.
  etpNote: string | null; // limite des ETP de la base (ex. quotités PayFit à la date de lecture, non historisées)
  // Base dérivée d'un scénario (budget N+1) : état projeté du scénario parent à la fin de son horizon. Absent : base
  // figée sur le réel PayFit.
  origin?: BaseOrigin;
  prior?: PriorMonth[]; // mois projetés par le(s) scénario(s) parent(s) entre leur bascule et le mois de référence
  upcoming?: BaseContract[]; // contrats connus de PayFit qui commencent après l'horizon (repris par une base dérivée)
};

export type BaseOrigin = {
  kind: "scenario";
  scenarioId: string;
  scenarioName: string;
  month: string;
  at: string;
  notCarried: string[];
  gap?: { label: string; cost: number }[]; // coût projeté du mois − base dérivée, par nature (absent : base antérieure)
};
export type PriorMonth =
  | { month: string; kind: "value"; cost: number; brut: number | null; charges: number | null; headcount: number; etp4: number | null; etpNd: string | null; source: string }
  | { month: string; kind: "nd"; reason: string; source: string };

// --- Hypothèses datées saisies dans Clair.
export type Scope = { kind: "global" } | { kind: "service"; service: string } | { kind: "contrat"; key: string };
export type Amount = { mode: "brut"; brutCents: number; chargesBps: number } | { mode: "charge"; costCents: number };

export type Hypothesis =
  | { id: string; kind: "augmentation"; label: string; from: string; rateBps: number; scope: Scope }
  // Congé non payé ou partiellement payé (congé sans solde, congé supplémentaire pris en charge par un tiers…) : jours
  // de la période (bornes incluses) payés à paidBps du salaire (0 = aucun salaire, charges proportionnelles).
  | { id: string; kind: "absence"; label: string; contractKey: string; from: string; to: string; paidBps: number }
  | { id: string; kind: "categorie"; label: string; contractKey: string; category: CategoryId }
  | {
      id: string;
      kind: "embauche";
      label: string;
      service: string | null;
      start: string; // premier jour payé
      end: string | null; // dernier jour payé (CDD), null : sans fin
      grossFullTimeCents: number; // brut mensuel temps plein
      quotaBps: number; // quotité (10 000 = temps plein)
      chargesBps: number; // taux de charges patronales
      counted: boolean; // compté dans l'effectif
      category?: CategoryId | null; // CDI, CDD, apprenti, stagiaire
      replaces: string | null; // id de l'hypothèse de départ remplacée (lien documentaire)
      // Descriptifs saisis, sans effet sur le calcul : motif d'embauche, métier, salarié dont le profil a été recopié.
      motif?: string;
      metier?: string;
      copiedFrom?: string | null;
    }
  | { id: string; kind: "depart"; label: string; contractKey: string; lastPaidDate: string; exitCost: Amount | null; motif?: string }
  | { id: string; kind: "ponctuel"; label: string; month: string; amount: Amount; service: string | null; nonRecurring?: boolean; contractKey?: string | null }
  // Élément non récurrent déjà passé en comptabilité (mois réalisé) : le journal PayFit ne le distingue pas, il est saisi
  // à la main (catégorie libre) et sert seulement à l'atterrissage retraité ; il ne change pas la projection.
  | { id: string; kind: "realise"; label: string; category: string; month: string; costCents: number }
  | { id: string; kind: "base"; label: string; contractKey: string; salaryCents: number; chargesBps: number }
  // Enveloppe budgétaire saisie par mois, par centre de coûts (axis « service ») ou par rubrique libre (axis « rubrique »).
  // Montants des mois renseignés seulement (un mois absent n'a pas d'enveloppe) : en brut si chargesBps est fourni
  // (charges = brut × taux), sinon en coût chargé non ventilé.
  | { id: string; kind: "enveloppe"; label: string; axis: "service" | "rubrique"; target: string; monthly: Record<string, number>; chargesBps: number | null; nonRecurring?: boolean }
  // Constante de référence saisie par mois (taux légal, plafond, horaire…), en centièmes de l'unité (€ → centimes,
  // % → points de base, nombre → centièmes). Documentaire : aucune règle de calcul ne la lit.
  | { id: string; kind: "constante"; label: string; unit: "eur" | "pct" | "nombre"; values: Record<string, number>; source: string }
  // Changement d'affectation ou de quotité d'un salarié à compter du 1er jour d'un mois : nouveau service (les coûts
  // suivants lui sont attribués) et/ou nouvelle quotité (salaire proportionnel à la quotité, ETP au nouveau niveau).
  | { id: string; kind: "changement"; label: string; contractKey: string; from: string; service?: string; quotaBps?: number; poste?: string };

export type HypothesisKind = Hypothesis["kind"];

// Conventions de calcul : paramètre de l'espace, copié dans le scénario à sa création.
export type Prorata = "calendaire" | "ouvres" | "aucun";
export type Conventions = { prorata: Prorata };

// --- Résultat.
export type ContributionKind = "base" | "augmentation" | "quotite" | "absence" | "depart" | "fin-contrat" | "entree" | "embauche" | "ponctuel" | "enveloppe" | "sortie";
export type Contribution = {
  hypothesisId: string | null; // null : base figée ou fin de contrat connue
  kind: ContributionKind;
  label: string;
  contractKey: string | null;
  who: string;
  service: string | null;
  brut: number | null; // null : saisi en coût chargé, sans ventilation brut / charges
  charges: number | null;
  cost: number;
  nonRecurringCents?: number; // part non récurrente de cette contribution (coûts de sortie, ponctuel marqué, tuilage)
  nonRecurringLabel?: string; // catégorie de l'élément non récurrent (motif du départ)
  rubric?: string; // rubrique libre d'une enveloppe « par rubrique »
};

// Salarié compté présent le dernier jour d'un mois projeté (effectifs, entrées et sorties par différence de deux mois).
export type PresentPerson = { etp4: number | null; category: string | null; service: string | null };

export type ProjectedMonth =
  | {
      month: string;
      kind: "value";
      brut: number | null;
      charges: number | null;
      cost: number;
      headcount: number;
      etp4: number | null;
      etpNd: string | null;
      byCategory?: Record<string, { headcount: number; etp4: number | null }>; // clé : catégorie, ou « nc » (non classé)
      people?: Record<string, PresentPerson>; // clé : contrat ou embauche, salariés comptés présents en fin de mois
      contributions: Contribution[];
    }
  | { month: string; kind: "nd"; reasons: string[] };

export type Projection = { kind: "value"; months: ProjectedMonth[] } | { kind: "error"; errors: string[] };
