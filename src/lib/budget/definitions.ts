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
      "Rubriques « Salaires et appointements » et « Gratifications de stage » des lignes du journal de paie du contrat au mois de référence ; les primes et indemnités en sont exclues et se projettent par hypothèse. Charges = ce salaire × taux observé du contrat ce mois-là (cotisations ÷ brut total de ses lignes). Un contrat entré pendant le mois de référence ou après (déjà connu de PayFit à la lecture), sans ligne de paie ou sans cotisation rattachée a une base n.d. : la projection est n.d. tant qu'une correction de base n'est pas saisie (0 possible pour un contrat non payé). Un contrat dont les lignes portent plusieurs services est non ventilé.",
  },
  {
    id: "augmentation",
    title: "Augmentation",
    text:
      "Taux appliqué au 1er du mois d'effet, en pourcentage du salaire déjà augmenté : les taux successifs se composent. Si plusieurs augmentations prennent effet le même mois pour un même contrat, la plus ciblée s'applique seule (contrat, puis service, puis toute l'entreprise) ; deux augmentations de même niveau le même mois sont refusées. Les embauches et les contrats entrés après le mois de référence (base saisie à leur entrée) ne reçoivent que les augmentations qui les visent directement. L'effet d'une augmentation est calculé sur le mois complet ; un départ ou une fin de contrat dans le mois porte la réduction correspondante.",
  },
  {
    id: "prorata",
    title: "Prorata d'entrée et de sortie",
    text:
      "Règle choisie dans Paramètres › Projection et copiée dans le scénario à sa création. Jours calendaires : jours payés du mois ÷ nombre de jours du mois. Jours ouvrés : jours ouvrés payés ÷ jours ouvrés du mois (lundi à vendredi hors jours fériés légaux français — 1er janvier, lundis de Pâques et de Pentecôte, 1er mai, 8 mai, Ascension, 14 juillet, 15 août, 1er et 11 novembre, 25 décembre — calculés pour toute année ; ni jours fériés locaux d'Alsace-Moselle, ni ponts). Aucun : un mois commencé ou terminé compte entier. Embauche : premier jour payé ; départ : dernier jour payé.",
  },
  {
    id: "absence",
    title: "Congé non payé",
    text:
      "Période (bornes incluses) pendant laquelle un salarié est payé à une part de son salaire (0 % : aucun salaire, par exemple un congé pris en charge par l'assurance maladie ; les charges patronales sont proportionnelles au salaire payé). Les jours non payés sont comptés selon la règle de prorata du scénario (calendaires, ou ouvrés ; sans prorata, en jours calendaires). Le salarié reste dans l'effectif. Une ligne « congé non payé » apparaît dans le détail du mois.",
  },
  {
    id: "categories",
    title: "Catégories CDI, CDD, apprenti, stagiaire",
    text:
      "Catégorie proposée depuis le code de nature du contrat (table de Paramètres › Projection ; valeur proposée : 01 CDI, 02 CDD, 29 convention de stage), corrigée salarié par salarié par une hypothèse « catégorie » (PayFit code certains apprentis en CDD). Une embauche porte sa catégorie. Effectif et ETP de fin de mois sont ventilés par catégorie ; un contrat sans catégorie est « non classé ».",
  },
  {
    id: "entrant",
    title: "Entrée en cours du mois de référence",
    text:
      "Un contrat entré pendant le mois de référence, avec des lignes de salaire et de cotisations, a pour base le salaire de ce mois ramené au mois complet : salaire ÷ part de présence (règle de prorata du scénario, ex. 18 jours ouvrés sur 22 pour une entrée le 7 septembre). Le calcul est indiqué sur le salarié ; il reste corrigeable par une base saisie.",
  },
  {
    id: "contribution",
    title: "Contributions d'un mois projeté",
    text:
      "Le coût d'un mois est la somme de contributions rattachées chacune à la base figée ou à une hypothèse : base du mois complet, effet de chaque augmentation, effet d'un départ ou d'une fin de contrat connue, embauches, éléments ponctuels et coûts de sortie. Un contrat entré après le mois de référence apparaît avec sa base du mois complet et une ligne « Entrée » qui retire les jours non payés. Calcul exact puis un seul arrondi au centime par niveau cumulé (demi-centime à l'écart de zéro) : chaque contribution est la différence entre deux niveaux arrondis, la somme tombe juste.",
  },
  {
    id: "atterrissage",
    title: "Atterrissage",
    text:
      "Masse salariale chargée de l'année du premier mois projeté : réel figé de janvier au dernier mois clos + mois projetés par le ou les scénarios parents (base dérivée) + mois projetés par ce scénario jusqu'à décembre, chaque partie affichée avec sa source. n.d. si un mois est n.d. ou si l'horizon s'arrête avant décembre.",
  },
  {
    id: "derivee",
    title: "Base dérivée (simulateur N+1)",
    text:
      "Base d'un scénario créé à partir d'un autre, figé : état projeté de ce dernier au dernier mois de son horizon (brut et charges du mois complet). Contrats encore présents ce mois-là au salaire du mois complet (augmentations comprises) et à leur taux de charges, embauches reprises comme contrats, départs effectués exclus. Les éléments ponctuels et les hypothèses postérieures à ce mois ne sont pas repris (listés). Les mois projetés du scénario parent servent de N-1 et d'atterrissage de l'année en cours.",
  },
  {
    id: "budget-saisi",
    title: "Budget saisi",
    text:
      "Coût employeur global par mois d'une année, saisi dans Clair (budget préparé hors de Clair). Un mois vide est non saisi (n.d.), jamais 0. Sans ETP ni ventilation par service : le pont d'écart n'est pas calculable face à un budget saisi.",
  },
  {
    id: "pont",
    title: "Pont d'écart volume / coût moyen",
    text:
      "Écart de coût employeur entre deux lectures sur les mêmes mois, décomposé en effet volume = (ETP-mois de ce scénario − ETP-mois de la lecture comparée) × coût par ETP-mois de la lecture comparée, et effet coût moyen = (coût par ETP-mois de ce scénario − coût par ETP-mois comparé) × ETP-mois de ce scénario. ETP-mois = somme des ETP fin de mois. Calcul exact ; l'effet volume est arrondi au centime et l'effet coût moyen porte le reste : la somme égale l'écart. L'effet de structure (mix) n'est pas calculé : il exige des données individuelles datées des deux lectures. n.d. si un mois n'a pas d'ETP.",
  },
  {
    id: "retraite",
    title: "Atterrissage retraité",
    text:
      "Atterrissage de l'année − éléments non récurrents. Déjà en comptabilité : éléments saisis à la main (le journal PayFit passe les indemnités de rupture et de congés payés avec les autres lignes du compte 6414 et ne les distingue pas), avec leur montant chargé. D'ici décembre : coûts de sortie des hypothèses de départ, éléments ponctuels marqués « non récurrent » et tuilages (coût de l'entrant, augmentations comprises, pendant les jours où le salarié remplacé est encore payé). Les catégories sont libres.",
  },
  {
    id: "mesures",
    title: "Mesures de management",
    text:
      "Pour chaque départ, comparaison de la projection avec et sans lui. Paie évitée = coût du contrat concerné dans la projection sans le départ − avec le départ, sur les mois projetés de l'année (hors coûts de sortie). Économie nette = paie évitée − coûts de sortie − coût du remplaçant lié (embauche qui remplace ce départ, tuilage compris). Année pleine = 12 × (coût du mois complet de décembre du contrat − celui du remplaçant) ; n.d. si décembre est hors horizon ou si le remplaçant arrive après le 1er décembre.",
  },
  {
    id: "sensibilites",
    title: "Sensibilités",
    text:
      "Effet sur l'atterrissage de l'année (et sur le retraité) d'une variation d'une hypothèse, calculée seule : décalage d'une date en jours, variation d'un taux d'augmentation en points de %, variation d'un montant ou de coûts de sortie en %. Effet = atterrissage avec la variation − atterrissage avec l'hypothèse retenue. Aucune valeur de variation n'est proposée par défaut ; rien n'est enregistré.",
  },
  {
    id: "effectif",
    title: "Effectif et ETP projetés",
    text:
      "Contrats présents le dernier jour du mois, de natures comptées dans l'effectif (Paramètres › KPI) pour la base, ou déclarés « comptés » pour une embauche. ETP : celui du module KPI RH à la fin du mois de référence pour un contrat de la base (source PayFit : quotité à la date de lecture, non historisée), quotité saisie pour une embauche.",
  },
];
