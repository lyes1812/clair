import { PAYROLL_DEFINITIONS } from "@/lib/payroll/definitions";
import type { GlossaryEntry } from "./types";

// Identifiants du glossaire vers lesquels renvoient les écrans de la Masse salariale (un test vérifie que chacun existe).
export const MASSE_TERMS = {
  masse: "masse",
  brut: "brut",
  cotisations: "cotisations",
  evolution: "evolution",
  coutEtp: "cout-etp",
  mois: "mois",
  grille: "grille",
  fixeVariable: "fixe-variable",
  primes: "primes",
  stages: "gratifications-stage",
  horsMasse: "hors-masse",
  provision: "provision",
  rapprochement: "rapprochement",
  ratio: "ratio-produits",
  service: "service",
  montants: "montants-journal",
  graphiques: "ms-graphiques",
  nd: "ms-nd",
  tendances: "ms-tendances",
  controleDsn: "controle-dsn",
  brutDsn: "brut-dsn",
  masseDsn: "masse-dsn",
  moisDsn: "mois-dsn",
} as const;

// Famille « Masse salariale » : les définitions déjà écrites dans l'application (reprises avec leurs identifiants d'ancre), puis
// tout ce que les écrans expliquaient sous les tuiles, les graphiques et les tableaux. Une entrée par notion ; les écrans n'affichent
// plus que le chiffre et un « ? » vers l'entrée.
const FAMILY = "Masse salariale" as const;

// Formules d'une ligne, ajoutées aux définitions existantes (sans en changer le texte).
const FORMULAS: Record<string, string> = {
  masse: "masse chargée = brut + cotisations patronales",
  brut: "brut = salaires + primes + gratifications de stage + indemnités et avantages",
  cotisations: "taux = cotisations patronales ÷ brut",
  evolution: "écart = N − N-1 ; écart (%) = (N − N-1) ÷ N-1",
  "cout-etp": "masse chargée de la période ÷ somme des ETP de fin de mois",
  "fixe-variable": "fixe + variable + gratifications de stage = brut",
  provision: "provision = congés payés + charges sociales",
  rapprochement: "écart = journal de paie − comptabilité",
  service: "coût par personne-mois = coût du service ÷ contrats portant une ligne de brut",
};

// Paragraphes ajoutés à une définition existante : le texte qui était écrit sous les tuiles, les graphiques et les tableaux.
const MORE: Record<string, string> = {
  evolution:
    "Un écart de montant s'écrit en rouge quand le coût augmente et en vert quand il baisse (voir « Tendances financières »). Avec un N-1 nul, l'écart en euros reste affiché et le pourcentage est n.d.",
  "cout-etp":
    "Les limites des ETP utilisés (quotités PayFit non historisées, historique brut) sont rappelées sous les tuiles quand elles s'appliquent. Colonne « Coût / ETP » du tableau Mois par mois : masse chargée du mois ÷ ETP de fin de mois.",
  grille:
    "La grille en vigueur de l'espace (rubriques, rôle brut, cotisations ou hors masse, et comptes) est listée dans les détails de la lecture, en haut de l'écran. Une valeur par défaut validée est proposée ; un administrateur peut la modifier dans Paramètres.",
  "fixe-variable":
    "Le fixe regroupe la rubrique « Salaires et appointements » (salaires et congés payés). Le variable regroupe les rubriques « Primes » et « Indemnités et avantages ». Les gratifications de stage sont une rubrique à part, comptée dans le brut. « dont primes » est une part de la colonne Variable.\n\nLes tuiles et le tableau par mois portent sur l'entreprise entière : ils ne sont jamais masqués. Le brut par libellé de paie et les primes par famille suivent le seuil de confidentialité (voir « Primes et familles de prime » et « Seuil de confidentialité ») ; sous le filtre Service, l'écran du service est n.d. quand sa ligne du tableau Services est masquée.",
  provision:
    "Congés payés + charges sociales = provision du mois. Une part sans ligne de dotation reconnue est n.d. et rend le total n.d. ; sa raison est donnée sous le tableau. L'écart est la provision de fin de mois moins celle de la même fin de mois un an plus tôt (N-1).\n\nPar service, la provision d'une fin de mois décrit les personnes distinctes dont un contrat porte une ligne de dotation « Mois courant » : sous le seuil de confidentialité, la ligne est n.d., avec masquage secondaire dans le mois vers la provision de l'entreprise, qui reste affichée ; sous le filtre Service, la provision du service retenu est n.d. quand sa ligne l'est (voir « Seuil de confidentialité »).",
  rapprochement:
    "L'écart est calculé par rubrique et par mois ; les libellés complets des rubriques sont dans l'infobulle du graphique. Avec le filtre Service, le rapprochement n'est pas calculé : la comptabilité ne porte pas le code analytique du journal de paie.",
  service:
    "Le coût d'un service est sa masse chargée (brut + cotisations patronales). Le coût par personne-mois compte les contrats rémunérés (portant une ligne de brut) chaque mois : ce n'est pas un coût par ETP. Un service n.d. n'est pas compté dans le « Total affiché » de l'infobulle. Le filtre Service ne s'applique pas aux graphiques par service : tous les services y sont montrés, comme dans le tableau Services. L'anneau ne montre que les services au coût positif ; les parts sont calculées sur les services tracés et un service sans coût positif est nommé sous l'anneau, son montant restant dans le tableau. Au-delà de huit services au coût positif, l'anneau est remplacé par des barres horizontales classées ; au-delà de huit services, l'empilement par mois n'est pas tracé : les montants sont dans l'affichage Tableau. Cliquer le nom d'un service dans le tableau filtre l'écran sur ce service.\n\nChaque ligne de service (période, N-1, chaque mois) décrit les personnes distinctes reliées aux contrats qui portent ses lignes de masse : une ligne qui en compte moins que le seuil de confidentialité est n.d., avec masquage secondaire dans chaque colonne et vers la période de la ligne ; son évolution est n.d. ; le total de l'entreprise reste affiché. Sous le filtre Service, un service dont la ligne est masquée sans filtre, au masquage principal ou secondaire, rend tout l'écran du service n.d. (« — service retenu par le filtre »), avec l'action « Retirer le filtre Service » ; sans seuil défini, de même, avec le lien vers les Paramètres (voir « Seuil de confidentialité »).",
};

// Entrées voisines (« Voir aussi ») des définitions reprises du code : la règle de confidentialité de l'application est écrite une fois.
const SEE: Record<string, string[]> = {
  service: ["confidentialite", "cout-etp"],
  provision: ["confidentialite", "hors-masse"],
  "fixe-variable": ["primes", "confidentialite"],
};

const FROM_CODE: GlossaryEntry[] = PAYROLL_DEFINITIONS.map((d) => ({
  id: d.id,
  term: d.title,
  family: FAMILY,
  definition: MORE[d.id] ? `${d.text}\n\n${MORE[d.id]}` : d.text,
  ...(FORMULAS[d.id] ? { formula: FORMULAS[d.id] } : {}),
  ...(SEE[d.id] ? { see: SEE[d.id] } : {}),
}));

const MOVED: GlossaryEntry[] = [
  {
    id: "primes",
    term: "Primes et familles de prime",
    family: FAMILY,
    see: ["fixe-variable", "confidentialite"],
    formula: "hors primes = brut − primes",
    definition: [
      "Les primes sont le solde de la rubrique « Primes » de la grille de comptes (par défaut, comptes 6413 hors gratifications de stage 64137). « Hors primes » est le brut moins les primes.",
      "Une famille de prime est un libellé de ligne de prime du journal PayFit (par exemple « Primes sur objectif », « Primes de vacances »), regroupé par la rubrique de la grille : la somme des familles est le total des primes du mois.",
      "Dans le graphique mensuel, un mois sans colonne n'a aucune prime (0,00 €) : il n'est pas absent. Au-delà de huit familles, le graphique n'est pas tracé : les montants de chaque famille, mois par mois, sont dans le tableau « Primes par famille et par mois ».",
      "Les éléments non récurrents (indemnités de rupture conventionnelle, indemnités compensatrices de congés payés) ne sont pas distingués par le journal PayFit, qui les passe avec les autres lignes du compte 6414 « Indemnités et avantages divers » : ils restent dans la rubrique « Indemnités et avantages ».",
      "Chaque famille de prime, par mois et sur la période, et chaque libellé du tableau « Brut par libellé de paie » décrivent les personnes distinctes reliées aux contrats qui portent leurs lignes : une cellule qui en compte moins que le seuil de confidentialité est n.d., son écart aussi, avec masquage secondaire dans chaque mois, sur la période et vers la cellule de période de la famille ; les totaux (primes du mois, brut de la période et de N-1) restent affichés. Sans seuil défini, ces répartitions sont n.d. (voir « Seuil de confidentialité »).",
      "Dans « Éléments non récurrents du réel », on peut désigner un licenciement, une rupture conventionnelle ou un tuilage passé, avec son mois et ses contrats, puis fournir le montant chargé et sa source. La paie reste inchangée ; une lecture analytique séparée soustrait les seuls coûts identifiés. Un montant non renseigné rend ce retraitement n.d. ; ni le compte 6414 entier ni un prorata de tuilage ne sont présumés.",
    ].join("\n\n"),
  },
  {
    id: "gratifications-stage",
    term: "Gratifications de stage",
    family: FAMILY,
    definition:
      "Rubrique à part de la grille de comptes (par défaut, compte 64137), comptée dans le brut. Sans aucune ligne dans le journal sur la période, la tuile l'indique : le montant nul n'est alors pas une valeur lue.",
  },
  {
    id: "hors-masse",
    term: "Postes comptés à part ou hors de la masse chargée",
    family: FAMILY,
    definition: [
      "Quatre postes du journal de paie sont lus mais traités à part. Les taxes et contributions sur les salaires (comptes 63 : formation, apprentissage, dialogue social) sont comptées avec les cotisations patronales. Les gratifications de stage sont comptées dans le brut.",
      "Les provisions de congés payés et les autres charges de personnel (titres-restaurant, par exemple) sont affichées à part et ne sont pas dans la masse chargée.",
      "Un compte de classe 63 ou 64 sans rubrique est signalé « non classé » et reste hors de la masse tant qu'il n'est pas classé dans Paramètres.",
    ].join("\n\n"),
  },
  {
    id: "montants-journal",
    term: "Montants du journal de paie et détail par compte",
    family: FAMILY,
    definition: [
      "Les montants sont ceux du journal comptable de paie renvoyé par l'API PayFit, soldés débit − crédit, en centimes. Aucun montant n'est recalculé ni reconstitué.",
      "Le détail par compte d'un mois (cliquer le mois dans « Mois par mois ») liste les comptes de charges de personnel du journal avec leur rubrique, leur débit, leur crédit et leur solde ; les contreparties (comptes de tiers, produits) sont ignorées. Le total du détail est la masse chargée du mois.",
    ].join("\n\n"),
  },
  {
    id: "ratio-produits",
    term: "Masse salariale ÷ produits d'exploitation",
    family: FAMILY,
    formula: "masse chargée du journal ÷ solde créditeur des comptes 70 à 75",
    definition:
      "Poids de la masse salariale chargée du journal de paie dans les produits d'exploitation de la comptabilité retenue dans Données (comptes 70 à 75), sur les mêmes mois. Le ratio est n.d. si le journal de paie ou la comptabilité d'un des mois n'est pas lu, ou s'il n'y a aucun produit d'exploitation sur la période. Il n'est pas calculé avec le filtre Service.",
  },
  {
    id: "ms-graphiques",
    term: "Lecture des graphiques de la Masse salariale",
    family: FAMILY,
    definition: [
      "Un graphique est une lecture : le tableau correspondant, exact à l'euro près, fait foi. Chaque graphique reprend les valeurs du tableau, sans calcul supplémentaire. Le bouton « Empiler » superpose les séries (la hauteur est leur somme, rappelée par « Total affiché » dans l'infobulle) ; « Désempiler » les place côte à côte ; la disposition ne change aucune valeur.",
      "Un mois n.d. est une colonne hachurée (aucune série n'a de valeur) ou une valeur non tracée ; une courbe s'interrompt à ce mois. Un n.d. n'est jamais dessiné comme zéro : sa raison est dans l'infobulle et sous le tableau. Si aucune valeur n'est connue sur la période, le graphique n'est pas tracé.",
      "Un mois dont la paie n'est pas clôturée à la lecture est provisoire (montants susceptibles de changer) : il est signalé dans la ligne de période de l'écran, dans l'infobulle des graphiques et dans le tableau Mois par mois.",
      "Les teintes sont celles de la charte (bleus, gris-bleus et noir). Une même notion garde sa teinte d'un graphique à l'autre (N en bleu, N-1 en gris-bleu, brut en bleu nuit, cotisations patronales en bleu moyen) et la légende nomme chaque série : la teinte ne porte jamais seule l'information. Au-delà de quatre services (ou de cinq familles de prime), une teinte est reprise d'une autre notion de l'écran ; au-delà de huit services, une même teinte sert à deux services : la légende de chaque graphique et la liste des parts, avec le nom et le montant, font foi.",
      "Brut + cotisations patronales = masse chargée du mois. Le coût par ETP d'un mois est la masse chargée du mois ÷ ETP de fin de mois (KPI RH), arrondi au centime. Fixe + variable + gratifications de stage = brut du mois. Congés payés + charges sociales = provision du mois. L'écart de rapprochement est journal de paie − comptabilité.",
      "L'axe des colonnes part toujours de zéro. L'axe d'une courbe (coût par ETP, total de la provision) est ajusté aux valeurs et ne part pas de zéro : sa plage est écrite sous la courbe, et les valeurs de l'infobulle font foi.",
    ].join("\n\n"),
  },
  {
    id: "ms-nd",
    term: "n.d. dans la Masse salariale",
    family: FAMILY,
    definition:
      "Une donnée absente de la source s'écrit « n.d. », avec sa raison sous le tableau ou au survol ; elle n'est jamais remplacée par zéro. Dans un graphique, une colonne hachurée est un mois n.d. ; une valeur n.d. d'une série n'est pas tracée et une courbe s'interrompt à ce mois. Un total qui dépend d'une valeur n.d. est n.d. aussi.",
  },
  {
    id: "ms-tendances",
    term: "Tendances financières (rouge et vert)",
    family: FAMILY,
    definition: [
      "Le rouge et le vert servent uniquement à lire l'évolution d'un montant de coût. Pour un coût (masse salariale, brut, cotisations, primes, indemnités, provision, coût par ETP), une hausse est une tendance défavorable (rouge) et une baisse une tendance favorable (verte) ; un écart nul ou n.d. reste neutre. Le signe + ou − et une flèche accompagnent toujours la couleur.",
      "Sont colorés : l'évolution face à N-1, les colonnes Écart et Écart (%) des montants, et les écarts de rapprochement. Un écart de rapprochement (journal de paie − comptabilité, journal − DSN) est coloré selon son signe : rouge si le journal est supérieur, vert s'il est inférieur ; un écart nul est neutre.",
      "Les effectifs, les ETP, les entrées et les sorties ne sont jamais colorés : ce ne sont pas des montants.",
    ].join("\n\n"),
  },
  {
    id: "controle-dsn",
    term: "Contrôle DSN du brut",
    family: FAMILY,
    formula: "écart = brut du journal − brut déclaré en DSN",
    definition: [
      "Les colonnes « Brut DSN (001) » et « Écart journal − DSN » du tableau Mois par mois comparent le brut du journal de paie au brut déclaré en DSN. Elles sont disponibles sur le total entreprise (la DSN ne porte pas le code analytique du journal : pas de contrôle avec le filtre Service) et lorsqu'au moins une DSN est déposée pour les mois affichés.",
      "Le brut déclaré est la somme des rémunérations S21.G00.51 de type 001 (brut non plafonné) des déclarations qui font foi, tous établissements. Le signe ⚠ marque un mois DSN incomplet ou bloqué. Un écart s'explique ligne par ligne dans le détail du mois.",
    ].join("\n\n"),
  },
  {
    id: "brut-dsn",
    term: "Brut déclaré (DSN)",
    family: FAMILY,
    formula: "Σ rémunérations S21.G00.51 de type 001 des déclarations qui font foi",
    definition:
      "Somme des rémunérations S21.G00.51 de type 001 (rémunération brute non plafonnée) des déclarations qui font foi pour chaque mois, tous établissements (sélection du module Données : numéro d'ordre, annule et remplace, fractions). Les autres types de rémunération sont listés sans être additionnés.",
  },
  {
    id: "masse-dsn",
    term: "Masse chargée en source DSN",
    family: FAMILY,
    definition:
      "n.d. en source DSN : les cotisations patronales ne sont pas portées salarié par salarié par la DSN (blocs S21.G00.81 et S21.G00.23 non extraits). Pour la masse chargée, utiliser l'API PayFit (journal de paie). Clair ne l'estime jamais.",
  },
  {
    id: "mois-dsn",
    term: "Mois incomplet, bloqué ou non déposé (DSN)",
    family: FAMILY,
    definition:
      "Incomplet : un établissement connu n'a pas déclaré ce mois ; le brut ne couvre que les établissements déclarés, ce qui est signalé par ⚠. Bloqué, non déposé ou sans rémunération de type 001 : le mois est n.d., jamais zéro ; dans le graphique, c'est une colonne hachurée.",
  },
];

export const GLOSSARY_MASSE: GlossaryEntry[] = [...FROM_CODE, ...MOVED];
