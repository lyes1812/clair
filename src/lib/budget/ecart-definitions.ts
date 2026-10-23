// Définitions affichées sous l'écart budgétaire et l'analyse des écarts (règle 6 : accessibles depuis chaque indicateur).
export const ECART_DEFINITIONS: { id: string; title: string; text: string }[] = [
  {
    id: "versions",
    title: "Versions comparées",
    text:
      "Une version est le réel PayFit d'une année, un scénario d'une année (réel figé de sa base jusqu'au mois de référence, mois projetés du scénario parent le cas échéant, puis sa projection) ou un budget saisi. La période est choisie en rangs de mois (par exemple janvier à septembre) et appliquée à l'année de chaque version, de sorte que les versions se comparent mois à mois. Un mois absent d'une version est n.d. avec sa raison, jamais 0 ; un total est n.d. dès qu'un de ses mois l'est.",
  },
  {
    id: "rubriques",
    title: "Rubriques de l'écart",
    text:
      "Masse salariale chargée = total brut + charges patronales. Total brut = rémunération de base + primes et éléments variables + indemnités et avantages + autres rubriques saisies. Pour le réel : rémunération de base = comptes Salaires et Gratifications de stage, primes = Primes, indemnités = Indemnités et avantages, charges = cotisations et taxes (grille de comptes de Paramètres). Pour une projection : rémunération de base = base figée et ses mouvements (augmentations, entrées, départs, congés, changements de quotité, embauches), primes = éléments ponctuels, indemnités = coûts de sortie, autres = enveloppes ; une enveloppe « par rubrique » dont le nom reprend le libellé d'une rubrique PayFit est comptée dans cette rubrique. Un coût saisi en chargé sans brut ni charges est « non ventilé » : le total brut et les charges du mois sont alors n.d. La ventilation du réel figé d'un scénario n'est donnée que si le journal courant redonne exactement le même total ; sinon elle est n.d.",
  },
  {
    id: "effectifs",
    title: "Effectifs et ETP de l'écart",
    text:
      "ETP : moyenne des ETP de fin de mois sur les mois de la période (la somme de douze ETP mensuels n'est pas un effectif annuel). Inscrit fin de période : effectif compté le dernier jour du dernier mois. Entrées et sorties : sommes sur la période des salariés comptés présents en fin de mois et non présents le mois précédent, ou l'inverse. Pour les mois réalisés, ces valeurs viennent du référentiel Collaborateurs courant (quotités PayFit à la date de lecture, non historisées) ; elles ne sont pas filtrables par service, sauf l'ETP.",
  },
  {
    id: "ecart",
    title: "Écart et pourcentage",
    text:
      "Écart = valeur de la version suivante − valeur de la version précédente, à périmètre et période comparables, calculé exactement (centimes ou dix-millièmes d'ETP). Pourcentage = écart ÷ valeur de la version précédente ; n.d. si celle-ci est nulle (valeur de départ nulle : pourcentage non défini, l'écart absolu reste donné). Une rubrique sans objet pour une version (par exemple les enveloppes pour le réel) s'affiche « — » et compte pour 0 dans les sommes.",
  },
  {
    id: "zoom",
    title: "Détail par salarié",
    text:
      "Pour une rubrique d'écart, la valeur de chaque salarié dans les deux versions et leur différence, les lignes sans salarié (enveloppes, lignes de journal sans contrat) étant regroupées. Le filtre « écart non nul » est actif par défaut ; la somme des écarts de toutes les lignes (hors filtre) est comparée à l'écart de la rubrique. Réservé aux administrateurs et éditeurs : un lecteur n'accède ni aux noms ni aux rémunérations individuelles, y compris dans les exports.",
  },
  {
    id: "cascade",
    title: "Cascade d'ETP",
    text:
      "Entre deux versions sur la même période, l'ETP moyen de A devient celui de B par les contributions de chaque salarié. Entrées nouvelles : présent en B, jamais présent en A (ETP-mois de B ÷ nombre de mois). Sorties : présent en A, jamais en B. Pour un salarié présent dans les deux : effet de présence = ETP moyen de A quand présent × (mois présents en B − mois présents en A) ÷ nombre de mois, classé en « entrées : effet report » s'il est positif (entré pendant la période A, pleinement compté en B) ou « sorties : effet déport » s'il est négatif ; changement d'ETP = écart de quotité moyenne pondéré par la présence en B. Les contributions s'additionnent exactement à l'écart ; chaque palier est arrondi une fois au dix-millième d'ETP, le résiduel est donc nul. Un mois n.d. d'une version rend l'analyse n.d. : aucune composition n'est supposée. Les congés non payés laissent le salarié dans l'effectif (pas de suspension) ; un changement de service ne change pas l'ETP total.",
  },
  {
    id: "contributions",
    title: "Contributions de la masse salariale",
    text:
      "L'écart de masse salariale chargée entre deux versions est la somme des écarts de ses rubriques (rémunération de base, primes, indemnités, autres rubriques, charges, non ventilé). Si une rubrique est n.d. pour une version, elle est listée avec sa raison et le résiduel est la part de l'écart qu'elle absorbe ; il est nul lorsque toutes les rubriques sont connues. Le pont volume / coût moyen décompose le même écart en effet volume (écart d'ETP-mois × coût par ETP-mois de la version précédente) et effet coût moyen (le reste).",
  },
];
