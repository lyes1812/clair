import { ECART_DEFINITIONS } from "@/lib/budget/ecart-definitions";
import type { GlossaryEntry } from "./types";

// Identifiants du glossaire vers lesquels renvoient Écart budgétaire et Analyse des écarts (un test vérifie que chacun existe).
export const ECART_TERMS = {
  versions: "versions",
  rangsDeMois: "rangs-de-mois",
  rubriques: "rubriques",
  effectifs: "effectifs",
  ecart: "ecart",
  ecartPourcentage: "ecart-pourcentage",
  poids: "poids-ecarts",
  zoom: "zoom",
  analyse: "analyse-ecarts",
  cascade: "cascade",
  residuel: "residuel",
  contributions: "contributions",
  pont: "pont-volume-cout",
  courbes: "ecart-courbes",
  cascades: "ecart-cascades",
  axeAjuste: "axe-ajuste",
  couleurs: "ecart-couleurs",
} as const;

// Un « ? » par palier de la cascade d'ETP : l'explication qui était écrite en commentaire de chaque ligne.
export const STEP_TERMS = {
  "entrees-new": "cascade-entree-nouvelle",
  "entrees-report": "cascade-effet-report",
  sorties: "cascade-sortie",
  "sorties-deport": "cascade-effet-deport",
  "etp-change": "cascade-changement-etp",
} as const;

const FAMILY = "Écarts" as const;

// Termes réécrits : les définitions d'origine parlaient de « A » et de « B » ou regroupaient plusieurs notions.
const TERMS: Record<string, string> = { ecart: "Écart" };

// Textes réécrits : même sens, vocabulaire des écrans (version 1 = départ, version 2 = arrivée), une notion par entrée.
const REWRITTEN: Record<string, string> = {
  ecart: [
    "Écart = valeur de la version suivante − valeur de la version précédente, à périmètre et période comparables, calculé exactement (centimes ou dix-millièmes d'ETP). Le signe + ou − est écrit devant chaque écart non nul et une flèche indique le sens.",
    "Un écart est n.d. dès que l'une des deux valeurs l'est. Une rubrique sans objet pour une version (par exemple les enveloppes pour le réel) s'affiche « — » et compte pour 0 dans les sommes.",
    "Pour un montant de coût, une hausse est affichée en rouge et une baisse en vert ; les effectifs, les ETP, les entrées et les sorties restent neutres (voir « Couleurs des écarts »).",
  ].join("\n\n"),
  cascade: [
    "Entre la version 1 et la version 2, sur la même période, l'ETP moyen de la version 1 devient celui de la version 2 par les contributions de chaque salarié, regroupées en cinq paliers : entrées nouvelles, effet report des entrées, sorties, effet déport des sorties et changement d'ETP (chaque palier a sa définition).",
    "Le départ est la moyenne des ETP de fin de mois de la version 1 sur les mois de la période ; l'arrivée est celle de la version 2. Les contributions s'additionnent exactement à l'écart : chaque palier cumulé est arrondi une seule fois au dix-millième d'ETP, le résiduel d'arrondi est donc nul.",
    "Un mois n.d. d'une version rend l'analyse n.d. : aucune composition n'est supposée. Les congés non payés laissent le salarié dans l'effectif (pas de suspension) ; un changement de service ne change pas l'ETP total.",
  ].join("\n\n"),
  contributions: [
    "L'écart de masse salariale chargée entre deux versions est la somme des écarts de ses rubriques : rémunération de base, primes, indemnités, autres rubriques, charges, non ventilé. Chaque ligne donne l'écart de la rubrique, son poids dans l'écart total et son écart en pourcentage (écart de la rubrique ÷ sa valeur dans la version 1).",
    "Si une rubrique est n.d. pour une version, elle est listée avec sa raison (au survol et dans la liste « Rubriques n.d. ») et le résiduel est la part de l'écart qu'elle absorbe ; il est nul lorsque toutes les rubriques sont connues. Départ + contributions + résiduel = arrivée.",
  ].join("\n\n"),
};

// Paragraphes ajoutés à une définition existante : le texte qui était écrit sous les chiffres.
const MORE: Record<string, string> = {
  versions:
    "Les versions sont numérotées 1, 2 et 3 dans l'ordre des champs de choix : la version 1 est le départ de la première comparaison, la version 2 son arrivée. La raison d'une valeur n.d. s'affiche au survol de la valeur et dans la liste « Données absentes » sous le tableau.",
  zoom:
    "Dans le tableau d'écart, un écart souligné en pointillés et suivi d'un chevron (›) ouvre ce détail. Il n'existe que pour la masse salariale chargée, le total brut, la rémunération de base, les primes, les indemnités et les charges patronales.",
  cascade:
    "Chaque palier décrit les personnes distinctes de ses contrats : un palier de 1 à (seuil de confidentialité − 1) personnes est n.d., avec masquage secondaire puisque l'écart total est publié ; un contrat sans personne rattachée est non relié et ne protège jamais (un palier qui en compte sans atteindre le seuil en personnes reliées est non vérifiable) ; un palier porté seulement par des embauches prévues est affiché, ne protège personne et n'est masqué qu'avec toute la cascade. Un palier n.d. empêche de tracer la cascade ; départ, arrivée, écart total et résiduel restent affichés. Sans seuil défini, tous les paliers sont n.d., avec un lien vers les Paramètres (voir « Seuil de confidentialité »).",
};

// Formules d'une ligne, ajoutées aux définitions existantes.
const FORMULAS: Record<string, string> = {
  ecart: "écart = version suivante − version précédente",
  contributions: "départ + contributions + résiduel = arrivée",
};

// Définitions déjà écrites dans l'application, reprises avec leurs identifiants d'ancre (#def-<id>) ; seules celles qui parlaient
// de « A » et de « B » ou regroupaient deux notions sont réécrites ci-dessus.
const FROM_CODE: GlossaryEntry[] = ECART_DEFINITIONS.map((d) => {
  const text = REWRITTEN[d.id] ?? d.text;
  return {
    id: d.id,
    term: TERMS[d.id] ?? d.title,
    family: FAMILY,
    definition: MORE[d.id] ? `${text}\n\n${MORE[d.id]}` : text,
    ...(FORMULAS[d.id] ? { formula: FORMULAS[d.id] } : {}),
  };
});

// Explications retirées des écrans : une entrée par notion, chaque écran y renvoie par un « ? ».
const MOVED: GlossaryEntry[] = [
  {
    id: "rangs-de-mois",
    term: "Rangs de mois",
    family: FAMILY,
    definition: [
      "La période se choisit en rangs de mois : « premier mois » et « dernier mois » désignent des rangs de 1 (janvier) à 12 (décembre), appliqués à l'année de chaque version. Comparer de janvier à septembre met en regard janvier à septembre de l'année de la version 1 et janvier à septembre de l'année de la version 2, mois à mois.",
      "Dans une courbe, le point de rang i de chaque version est tracé à la même position, quelle que soit l'année de la version. Une période inversée (premier mois après le dernier) n'est pas retenue : l'année entière est alors utilisée et l'écran le signale.",
    ].join("\n\n"),
  },
  {
    id: "ecart-pourcentage",
    term: "Écart en pourcentage",
    family: FAMILY,
    definition: [
      "Écart en pourcentage = écart ÷ valeur de la version précédente (en valeur absolue), arrondi au centième de point à l'affichage. Il est n.d. quand cette valeur est nulle : le pourcentage n'est pas défini, l'écart absolu reste donné.",
      "Dans l'analyse des écarts, il est donné pour l'écart total et pour chaque rubrique de masse salariale (écart de la rubrique ÷ sa valeur dans la version 1). Une contribution d'ETP n'a pas de valeur de départ propre : elle n'a pas de pourcentage.",
    ].join("\n\n"),
    formula: "écart en % = écart ÷ |valeur de la version précédente|",
  },
  {
    id: "poids-ecarts",
    term: "Poids des écarts",
    family: FAMILY,
    definition: [
      "Poids d'une contribution = contribution ÷ écart total, calculé exactement et arrondi au centième de point à l'affichage. Le signe + veut dire que la contribution va dans le sens de l'écart total, le signe − qu'elle va en sens inverse ; la somme des poids signés vaut 100 % avant arrondi quand le résiduel est nul.",
      "Une contribution nulle s'affiche « — ». Le poids est n.d. quand l'écart total est nul (la division n'est pas définie) ou quand la contribution elle-même est n.d. ; il n'est jamais reconstitué.",
    ].join("\n\n"),
    formula: "poids = contribution ÷ écart total",
  },
  {
    id: "analyse-ecarts",
    term: "Analyse des écarts",
    family: FAMILY,
    definition: [
      "L'analyse décompose l'écart entre deux versions de même période et de même service : la version 1 est le départ, la version 2 l'arrivée. Trois lectures, chacune rapprochée de l'écart du tableau d'écart budgétaire : la cascade d'ETP (qui entre, qui sort, quelles quotités changent), les contributions de chaque rubrique à l'écart de masse salariale chargée et le pont volume / coût moyen.",
      "Chaque graphique est une lecture : les valeurs exactes de chaque contribution sont dans les tableaux et les tuiles de l'affichage « Tableau », qui restent la référence. Le détail nominatif des salariés derrière chaque contribution est réservé aux administrateurs et aux éditeurs.",
      "La ligne « Confidentialité : seuil de N personnes » rappelle le seuil de l'espace, qui s'applique aux paliers de la cascade d'ETP et au service retenu par le filtre (voir « Seuil de confidentialité »).",
    ].join("\n\n"),
  },
  {
    id: "cascade-entree-nouvelle",
    term: "Entrées nouvelles (cascade d'ETP)",
    family: FAMILY,
    definition: "Salariés présents dans la version 2 et jamais présents dans la version 1 sur la période. Leur contribution est leur ETP cumulé sur les mois de présence de la version 2, divisé par le nombre de mois de la période.",
    formula: "ETP-mois de la version 2 ÷ nombre de mois",
  },
  {
    id: "cascade-effet-report",
    term: "Entrées : effet report (cascade d'ETP)",
    family: FAMILY,
    definition: "Salariés présents dans les deux versions, avec plus de mois de présence dans la version 2 que dans la version 1 : effet en année pleine d'une entrée survenue pendant la période de la version 1. L'ETP moyen du salarié quand il est présent dans la version 1 est multiplié par l'écart de mois de présence, divisé par le nombre de mois.",
    formula: "ETP moyen version 1 × (mois présents v2 − mois présents v1) ÷ nombre de mois",
  },
  {
    id: "cascade-sortie",
    term: "Sorties (cascade d'ETP)",
    family: FAMILY,
    definition: "Salariés présents dans la version 1 et jamais présents dans la version 2 sur la période. Leur contribution est négative : leur ETP cumulé sur les mois de présence de la version 1, divisé par le nombre de mois de la période.",
    formula: "−ETP-mois de la version 1 ÷ nombre de mois",
  },
  {
    id: "cascade-effet-deport",
    term: "Sorties : effet déport (cascade d'ETP)",
    family: FAMILY,
    definition: "Salariés présents dans les deux versions, avec moins de mois de présence dans la version 2 que dans la version 1 : sortie survenue pendant la période de la version 2. Même calcul que l'effet report, de signe négatif.",
    formula: "ETP moyen version 1 × (mois présents v2 − mois présents v1) ÷ nombre de mois",
  },
  {
    id: "cascade-changement-etp",
    term: "Changement d'ETP (cascade d'ETP)",
    family: FAMILY,
    definition: "Salariés présents dans les deux versions dont la quotité moyenne diffère : écart de quotité moyenne entre les deux versions, pondéré par la présence du salarié dans la version 2.",
    formula: "(ETP moyen version 2 − ETP moyen version 1) × mois présents v2 ÷ nombre de mois",
  },
  {
    id: "residuel",
    term: "Résiduel d'une cascade",
    family: FAMILY,
    definition: [
      "Écart total moins la somme des contributions. Dans la cascade d'ETP, c'est un résiduel d'arrondi, nul par construction : chaque palier cumulé est arrondi une seule fois au dix-millième d'ETP. Dans la cascade de masse salariale, c'est la part de l'écart portée par les rubriques n.d., nulle quand toutes les rubriques sont connues.",
      "Le résiduel n'est jamais réparti entre les contributions connues.",
    ].join("\n\n"),
  },
  {
    id: "pont-volume-cout",
    term: "Pont volume / coût moyen",
    family: FAMILY,
    definition: [
      "Le pont décompose l'écart de masse salariale chargée entre deux versions en deux effets : l'effet volume, qui mesure ce que coûte l'écart d'ETP-mois au coût par ETP-mois de la version 1, et l'effet coût moyen, qui est le reste. L'effet volume est arrondi au centime : la somme des deux effets égale exactement l'écart. L'écart d'ETP-mois est la différence des cumuls d'ETP de fin de mois de la période.",
      "L'effet de structure (mélange de statuts et de rémunérations) n'est pas calculé : il est compris dans l'effet coût moyen.",
      "Sans filtre de service, le pont porte sur toute l'entreprise et n'est jamais masqué. Sous un filtre, les chiffres du service (pont, cascade d'ETP, contributions de masse) sont n.d. dès qu'un de ses mois est masqué, en principal ou en secondaire. Un mois réel est jugé dans la colonne des masses des services du mois ; un mois projeté d'un scénario, dans trois colonnes de services dont le total du scénario est publié sans filtre : la masse, l'effectif et l'ETP de fin de mois (masqués ensemble), les entrées. Le service est aussi n.d. s'il n'est pas dénombré ; sans seuil défini, ils sont n.d. avec un lien vers les Paramètres (voir « Seuil de confidentialité »).",
    ].join("\n\n"),
    formula: "effet volume = (ETP-mois v2 − ETP-mois v1) × coût par ETP-mois v1 ; effet coût moyen = écart − effet volume",
  },
  {
    id: "ecart-courbes",
    term: "Courbes par version",
    family: FAMILY,
    definition: [
      "Une courbe par version pour la rubrique choisie, mois par mois. Trait plein : version 1 ; pointillés : versions suivantes ; zone teintée sous un scénario (seulement quand l'axe part de zéro). La couleur n'est pas le seul repère : le numéro de version est écrit dans la légende et dans l'infobulle, et un clic sur une version de la légende la masque ou la réaffiche.",
      "Chaque point est la valeur du mois (ETP de fin de mois, inscrits en fin de mois, entrées du mois, sorties du mois, montant du mois), chaque version étant lue sur sa propre année à rang de mois égal. Le tableau donne la valeur de la période : moyenne des ETP de fin de mois, effectif inscrit en fin de période, somme des entrées, des sorties et des montants.",
      "Un mois n.d. ou sans objet interrompt la courbe : jamais un point à zéro, jamais une valeur interpolée ; sa raison est dans l'infobulle. Une version sans aucune valeur sur la rubrique n'a pas de courbe : sa raison est écrite sous le graphique.",
    ].join("\n\n"),
  },
  {
    id: "ecart-cascades",
    term: "Lecture d'une cascade",
    family: FAMILY,
    definition: [
      "Une cascade part de la valeur de la version 1, ajoute une barre par contribution signée et arrive à la valeur de la version 2 : départ + contributions (+ résiduel) = arrivée. Chaque barre reprend une ligne du tableau d'analyse (ou une tuile du pont), avec la même valeur et la même unité. Les barres noires sont les totaux ; la valeur signée est écrite sur chaque barre.",
      "Cascade d'ETP : hausse en bleu, baisse en gris, sans jugement. Cascade en euros (masse salariale, pont) : hausse de coût en rouge, baisse de coût en vert.",
      "Dans la cascade de masse salariale, une rubrique n.d. n'est pas tracée : la part de l'écart qu'elle porte forme la barre « Rubriques n.d. » (le résiduel), jamais répartie entre les rubriques. Une cascade n.d. affiche sa raison.",
      "Sous 720 px de large, le tracé garde une largeur minimale par barre et défile horizontalement ; le titre reste fixe.",
    ].join("\n\n"),
  },
  {
    id: "axe-ajuste",
    term: "Lecture d'un graphique à axe ajusté",
    family: FAMILY,
    definition: [
      "Sur une courbe, l'axe vertical est par défaut ajusté aux valeurs affichées : il ne part pas de zéro, ce que la graduation et la mention sous le graphique disent. Les écarts entre les points paraissent alors plus grands qu'ils ne sont ; la case « Axe vertical à partir de zéro » rétablit l'échelle réelle, et la zone teintée sous un scénario n'est tracée que dans ce cas.",
      "Dans une cascade, l'axe est tronqué quand l'écart entre le niveau le plus bas et le niveau le plus haut de la cascade est inférieur à 30 % du niveau le plus haut : le badge « Axe tronqué à … » à côté du titre dit où l'axe commence. La hauteur d'une barre de total n'est alors pas proportionnelle à sa valeur ; les valeurs écrites sur chaque barre et le tableau donnent les montants exacts.",
    ].join("\n\n"),
  },
  {
    id: "ecart-couleurs",
    term: "Couleurs des écarts : coût en hausse, coût en baisse",
    family: FAMILY,
    definition: [
      "Le rouge et le vert sont les deux seules couleurs hors de l'univers bleu, blanc et noir de Clair, et ne servent qu'à indiquer le sens d'un écart de coût.",
      "Pour un coût (masse salariale chargée, total brut, rémunération de base, primes, indemnités, charges patronales, autres rubriques, coûts non ventilés), une hausse est une tendance défavorable, en rouge ; une baisse est une tendance favorable, en vert ; un écart nul ou n.d. reste noir. Dans les cascades en euros, les barres de hausse de coût sont rouges et les barres de baisse de coût vertes.",
      "Les effectifs, les ETP, les entrées et les sorties ne sont pas des montants : leurs écarts ne portent ni rouge ni vert, et la cascade d'ETP reste bleue et grise.",
      "La couleur n'est jamais seule : le signe + ou −, la flèche et, dans les graphiques, la valeur écrite portent aussi le sens.",
    ].join("\n\n"),
  },
];

// Entrées voisines (« Voir aussi ») : les définitions que les écrans n'ouvrent plus d'un clic depuis un graphique ou un tableau
// restent à un clic dans le glossaire.
const SEE: Record<string, string[]> = {
  versions: ["rangs-de-mois", "ecart", "rubriques", "effectifs"],
  ecart: ["ecart-pourcentage", "ecart-couleurs"],
  "ecart-pourcentage": ["ecart", "poids-ecarts"],
  "poids-ecarts": ["ecart", "residuel"],
  rubriques: ["contributions"],
  effectifs: ["cascade"],
  zoom: ["ecart"],
  cascade: [...Object.values(STEP_TERMS), "residuel", "ecart-cascades", "confidentialite"],
  contributions: ["rubriques", "residuel", "poids-ecarts", "ecart-pourcentage"],
  "analyse-ecarts": ["cascade", "contributions", "pont-volume-cout", "ecart-cascades", "confidentialite"],
  "ecart-courbes": ["rubriques", "effectifs", "rangs-de-mois", "axe-ajuste"],
  "ecart-cascades": ["axe-ajuste", "ecart-couleurs", "residuel"],
  "axe-ajuste": ["ecart-courbes", "ecart-cascades"],
  "pont-volume-cout": ["contributions", "confidentialite"],
  residuel: ["cascade", "contributions"],
  "ecart-couleurs": ["ecart"],
  "rangs-de-mois": ["versions"],
  ...Object.fromEntries(Object.values(STEP_TERMS).map((id) => [id, ["cascade"]])),
};

export const GLOSSARY_ECART: GlossaryEntry[] = [...FROM_CODE, ...MOVED].map((e) => (SEE[e.id] ? { ...e, see: SEE[e.id] } : e));
