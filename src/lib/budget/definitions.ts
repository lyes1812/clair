// Définitions affichées dans l'écran Hypothèses budgétaires (règle 6 : accessibles depuis chaque indicateur).
export const BUDGET_DEFINITIONS: { id: string; title: string; text: string }[] = [
  {
    id: "base",
    title: "Base figée",
    text:
      "Copie, à la création du scénario, du réel jusqu'au mois de référence (le mois qui précède le premier mois projeté) : masse salariale mois par mois et, pour chaque contrat présent à la fin du mois de référence, son coût de référence. Elle ne change plus, même après une nouvelle synchronisation PayFit.",
  },
  {
    id: "base-contrat",
    title: "Coût de référence d'un contrat",
    text:
      "Rubriques « Salaires et appointements » et « Gratifications de stage » des lignes du journal de paie du contrat au mois de référence ; les primes et indemnités en sont exclues et se projettent par hypothèse. Charges = ce salaire × taux observé du contrat ce mois-là (cotisations ÷ brut total de ses lignes). Un contrat entré pendant le mois de référence, sans ligne de paie ou sans cotisation rattachée a une base n.d. : la projection est refusée tant qu'une correction de base n'est pas saisie.",
  },
  {
    id: "augmentation",
    title: "Augmentation",
    text:
      "Taux appliqué au 1er du mois d'effet, en pourcentage du salaire déjà augmenté : les taux successifs se composent. Si plusieurs augmentations prennent effet le même mois pour un même contrat, la plus ciblée s'applique seule (contrat, puis service, puis toute l'entreprise) ; deux augmentations de même niveau le même mois sont refusées. Les embauches ne reçoivent que les augmentations qui les visent directement.",
  },
  {
    id: "prorata",
    title: "Prorata d'entrée et de sortie",
    text:
      "Règle choisie dans Paramètres › Projection et copiée dans le scénario à sa création. Jours calendaires : jours payés du mois ÷ nombre de jours du mois. Aucun : un mois commencé ou terminé compte entier. Embauche : premier jour payé ; départ : dernier jour payé.",
  },
  {
    id: "contribution",
    title: "Contributions d'un mois projeté",
    text:
      "Le coût d'un mois est la somme de contributions rattachées chacune à la base figée ou à une hypothèse : base du mois complet, effet de chaque augmentation, effet d'un départ ou d'une fin de contrat connue, embauches, éléments ponctuels et coûts de sortie. Calcul exact puis un seul arrondi au centime par niveau cumulé (demi-centime à l'écart de zéro) : chaque contribution est la différence entre deux niveaux arrondis, la somme tombe juste.",
  },
  {
    id: "atterrissage",
    title: "Atterrissage",
    text:
      "Masse salariale chargée de l'année du premier mois projeté : réel figé de janvier au mois de référence + mois projetés jusqu'à décembre. n.d. si un mois réel est n.d. ou si l'horizon s'arrête avant décembre.",
  },
  {
    id: "effectif",
    title: "Effectif et ETP projetés",
    text:
      "Contrats présents le dernier jour du mois, de natures comptées dans l'effectif (Paramètres › KPI) pour la base, ou déclarés « comptés » pour une embauche. ETP : quotité du mois de référence pour un contrat de la base, quotité saisie pour une embauche.",
  },
];
