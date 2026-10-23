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
    id: "embauche-postes",
    title: "Embauches : nombre de postes et profil recopié",
    text:
      "Une embauche porte un centre de coûts (existant ou nouveau), une catégorie (CDI, CDD, apprenti, stagiaire), des dates, un brut mensuel temps plein, une quotité et un taux de charges. Avec un nombre de postes N, Clair crée N hypothèses d'embauche identiques numérotées (1/N) à (N/N), chacune modifiable ou supprimable seule ; un remplacement concerne un seul poste. Le profil d'un salarié peut être recopié dans le formulaire : service et catégorie de sa fiche, taux de charges observé, brut temps plein = salaire de référence ÷ ETP (laissé à saisir si l'ETP ou la base est n.d.). Les valeurs sont enregistrées telles que saisies ; le motif d'embauche et le métier sont descriptifs et n'entrent pas dans le calcul.",
  },
  {
    id: "saisie-masse",
    title: "Saisie en masse",
    text:
      "Un tableau avec une ligne par salarié de la base : dernier jour payé, motif et coûts de sortie chargés pour les départs ; taux pour les augmentations, avec un mois d'effet commun. Chaque ligne renseignée devient la même hypothèse que celle saisie salarié par salarié ; les lignes vides sont ignorées. Le lot est enregistré en entier ou pas du tout : si le moteur refuse une ligne (date hors horizon, deux augmentations le même mois…), rien n'est enregistré et chaque ligne refusée est nommée avec sa raison.",
  },
  {
    id: "globales",
    title: "Hypothèses globales",
    text:
      "Grille mensuelle des taux d'augmentation : une ligne par périmètre (toute l'entreprise, chaque service, cadres dirigeants, hors cadres dirigeants), une colonne par mois du scénario. Le statut est l'indicateur « cadre dirigeant » de PayFit (champ estCadreDirigeant, référentiel Collaborateurs) au moment de la création du scénario, conservé dans sa base figée : ce n'est pas le statut cadre / non-cadre de la classification conventionnelle ou de la retraite complémentaire, que PayFit ne fournit pas à Clair, et un cadre non dirigeant est donc « hors cadre dirigeant » ; un contrat dont le statut n'est pas renseigné ne reçoit aucune augmentation par statut. Chaque cellule renseignée est une hypothèse d'augmentation distincte (visible dans Contrôles des changements), appliquée au 1er du mois en pourcentage du salaire déjà augmenté ; les taux successifs se composent. Une cellule vide ou à 0 n'a pas d'hypothèse. Sur un même mois, la plus ciblée s'applique seule (contrat, puis service ou statut, puis toute l'entreprise) ; un service et un statut sont au même niveau : deux augmentations de ces niveaux le même mois pour un même salarié sont refusées avec leur raison. Clair ne propose aucune valeur : une cellule vide reste vide. Les constantes de référence (taux légaux, plafonds, horaire théorique, taux de change…) sont saisies par mois avec leur source ; elles sont conservées avec le scénario mais aucune règle de calcul ne les lit.",
  },
  {
    id: "enveloppe",
    title: "Enveloppes par service et par rubrique",
    text:
      "Montants saisis par mois sur l'horizon du scénario, pour un centre de coûts (existant ou nouveau) ou pour une rubrique de votre choix (primes, heures supplémentaires, indemnités…). Chaque mois renseigné ajoute une ligne à la projection, rattachée à l'enveloppe ; un mois vide n'a pas d'enveloppe (jamais compté pour 0). En « Brut + charges », les charges du mois sont le brut × le taux saisi (un arrondi par mois) ; en « Coût chargé », brut et charges du mois restent non ventilés. Une enveloppe peut être marquée non récurrente (retirée de l'atterrissage retraité). Une seule enveloppe par centre de coûts ou par rubrique : on la modifie dans sa ligne.",
  },
  {
    id: "changement",
    title: "Changement de service ou de quotité",
    text:
      "À compter du 1er jour d'un mois, un salarié (contrat de la base ou embauche) change de service — ses coûts sont attribués au nouveau service à partir de ce mois — et/ou de quotité : son salaire devient proportionnel à la nouvelle quotité (salaire × nouvelle quotité ÷ quotité de la base), au même taux de charges, et son ETP prend le nouveau niveau. Une ligne « changement de quotité » apparaît dans le détail du mois. Limites : effet au 1er du mois seulement ; la quotité actuelle du salarié doit être connue ; les augmentations ciblées par service suivent le service de la base figée.",
  },
  {
    id: "controles",
    title: "Contrôles effectifs et contrôles des changements",
    text:
      "Contrôles effectifs : à chaque mois projeté, effectif de début + entrées − sorties = effectif de fin. Les entrées et sorties sont les salariés comptés présents le dernier jour du mois (et non présents le mois précédent, ou l'inverse) ; la base est aussi comparée à l'effectif réel du mois de référence. Contrôles des changements : toutes les hypothèses du scénario, avec le coût que la projection leur attribue sur l'horizon (somme des lignes rattachées), pour repérer ce qui pèse et supprimer ce qui ne doit plus compter.",
  },
  {
    id: "recopie",
    title: "Reprise des hypothèses d'un autre scénario",
    text:
      "Copie sélective (départs, embauches, augmentations, congés, catégories, corrections de base, éléments ponctuels, non récurrents réalisés) des hypothèses d'un autre scénario de l'espace. Les copies reçoivent de nouveaux identifiants et les liens entre hypothèses (embauche qui remplace un départ, augmentation d'une embauche) sont conservés quand les deux sont repris. Chaque hypothèse est contrôlée contre la base et l'horizon du scénario cible : celles qui ne sont plus calculables ne sont pas reprises et sont listées avec leur raison. Un lien « remplace » vers un départ non repris est retiré.",
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
