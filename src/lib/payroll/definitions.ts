// Définitions écrites dans l'app (règle 6 de CLAUDE.md), accessibles depuis chaque chiffre de l'écran Masse salariale.
export const PAYROLL_DEFINITIONS: { id: string; title: string; text: string }[] = [
  {
    id: "masse",
    title: "Masse salariale chargée",
    text:
      "Brut + cotisations patronales, lus dans le journal comptable de paie renvoyé par l'API PayFit pour chaque mois (lecture appliquée dans Données). Chaque compte est soldé débit − crédit, en centimes, sans arrondi intermédiaire. Les comptes sont classés par la grille de comptes de l'espace (Paramètres). Les taxes et contributions sur les salaires (63 : formation, apprentissage, dialogue social) sont comptées avec les cotisations patronales ; les provisions de congés payés et les autres charges de personnel (titres-restaurant…) sont affichées à part et ne sont pas dans la masse chargée. Les contreparties (comptes de tiers 42/43, produits) sont ignorées.",
  },
  {
    id: "brut",
    title: "Brut",
    text: "Solde des rubriques « Salaires et appointements », « Primes », « Gratifications de stage » et « Indemnités et avantages » de la grille de comptes. Les primes sont le solde de leur rubrique (par défaut, comptes 6413 hors gratifications de stage 64137) ; « hors primes » = brut − primes.",
  },
  {
    id: "cotisations",
    title: "Cotisations patronales",
    text: "Soldes des rubriques « Cotisations patronales » (par défaut, comptes 645) et « Taxes et contributions sur les salaires » (par défaut, comptes 63). Le taux affiché est cotisations ÷ brut de la même période.",
  },
  {
    id: "evolution",
    title: "Évolution N / N-1",
    text: "Même période, mêmes mois, un an plus tôt, même grille de comptes : écart = N − N-1, en euros et en % de N-1. Si un mois de l'une des deux périodes est n.d., l'évolution est n.d. et le mois est nommé.",
  },
  {
    id: "cout-etp",
    title: "Coût par ETP-mois",
    text: "Masse salariale chargée de la période ÷ somme des ETP contractuels de fin de mois de la même période (module KPI RH, mêmes paramètres). Un mois sans ETP exact rend le coût n.d. Ce n'est pas un coût par personne.",
  },
  {
    id: "mois",
    title: "Mois, mois provisoire et mois n.d.",
    text: "Un mois est celui demandé à PayFit pour le journal. Un mois dont la paie n'est pas clôturée à la lecture est affiché « provisoire ». Un mois hors de la lecture, sans journal renvoyé, ou avec une ligne sans montant est n.d. : jamais zéro.",
  },
  {
    id: "grille",
    title: "Grille de comptes",
    text: "Paramètre de l'espace (Paramètres › Masse salariale). Un compte est classé dans la rubrique dont un préfixe est le plus long. Un compte de classe 63 ou 64 sans rubrique est signalé « non classé » et n'entre pas dans la masse.",
  },
  {
    id: "service",
    title: "Service et coût par personne-mois",
    text:
      "Le service d'une ligne du journal PayFit est son code analytique de l'axe choisi dans Paramètres (par défaut, le seul axe présent dans le journal). Les lignes sans code de cet axe sont « non ventilé » : la somme des services égale toujours le total. Coût par personne-mois = coût du service ÷ nombre de contrats portant une ligne de brut, mois par mois. Avec le filtre Service, le coût par ETP-mois utilise les ETP des contrats dont les lignes du mois portent ce service.",
  },
];
