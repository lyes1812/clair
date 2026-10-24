import type { GlossaryEntry } from "./types";

// Famille « Lecture des écrans » : les conventions qui valent pour tous les écrans de chiffres (n.d., graphiques, versions, mois,
// tendances, unités, périmètre, état des entrées du menu, source). Les définitions propres à un indicateur restent dans leur
// famille : elles sont rappelées par « Voir aussi » (identifiants d'entrées voisines), jamais recopiées.
const FAMILY = "Lecture des écrans" as const;

export const GLOSSARY_ECRAN: GlossaryEntry[] = [
  {
    id: "lecture-nd",
    term: "n.d. et sa raison",
    family: FAMILY,
    definition: [
      "« n.d. » veut dire « non disponible » : Clair n'a pas la donnée, ou ne peut pas la calculer avec ce qui a été lu. La raison est toujours donnée : à côté de la valeur, au survol, dans l'infobulle d'un graphique ou sous le tableau.",
      "Un n.d. n'est jamais un zéro : zéro est une valeur connue, n.d. est une valeur inconnue. Il n'est jamais remplacé par une estimation ni par une répartition reconstituée. Un total, un écart, un taux ou une moyenne calculé à partir d'une valeur n.d. est n.d. à son tour, sauf exception écrite dans la définition de l'indicateur. Exemple d'exception : un chiffre précédé de « ≥ » est une borne basse, parce que des données manquent ; la valeur réelle est au moins égale à celle qui est affichée.",
      "Une raison qui commence par « sans objet » dit que la valeur n'existe pas pour ce mois ou cette ligne (par exemple un mois réel dans la série des mois projetés) : ce n'est pas une donnée manquante.",
      "Quand une règle de calcul requise n'est pas renseignée dans les Paramètres de l'espace, Clair refuse de calculer et dit laquelle manque : il n'applique aucune valeur par défaut cachée.",
    ].join("\n\n"),
    see: ["lecture-hachure", "lecture-prevu"],
  },
  {
    id: "lecture-hachure",
    term: "Colonne hachurée et courbe interrompue",
    family: FAMILY,
    definition: [
      "Dans un graphique, une valeur n.d. n'est jamais dessinée comme un zéro ni comblée par une valeur voisine.",
      "Colonnes : un mois (ou un groupe) pour lequel aucune série n'a de valeur est une colonne hachurée, marquée « n.d. ». Quand une seule série n'a pas de valeur, sa barre est simplement absente ce mois-là, sans hachure.",
      "Courbes : la ligne s'interrompt au mois n.d. ; aucun point n'est placé et rien n'est interpolé entre deux mois connus.",
      "Cascades : une contribution n.d. n'est jamais tracée comme un zéro ; la part de l'écart qu'elle absorbe est regroupée dans une barre « Rubriques n.d. ». Une cascade dont le départ ou l'arrivée est n.d. est remplacée par sa raison.",
      "Camemberts : une part n.d. n'est pas dessinée ; elle est listée avec « n.d. » et sa raison. Les pourcentages sont calculés sur le total des parts connues. Une part nulle n'a pas de secteur, et au-delà de huit parts l'anneau est remplacé par des barres horizontales classées.",
      "La raison se lit dans l'infobulle : au survol, ou au clavier avec les flèches gauche et droite une fois le graphique atteint. Quand aucune valeur n'est connue sur toute la période, le graphique est soit entièrement hachuré, soit remplacé par sa raison écrite à sa place.",
    ].join("\n\n"),
    see: ["lecture-nd", "lecture-tableau"],
  },
  {
    id: "lecture-axe",
    term: "Axe ajusté ou tronqué",
    family: FAMILY,
    definition: [
      "L'axe vertical d'un graphique ne part pas toujours de zéro.",
      "Colonnes : l'axe part de zéro, la hauteur d'une colonne est proportionnelle à sa valeur.",
      "Courbes : l'axe est ajusté aux valeurs affichées. Il ne part pas de zéro, sauf si les valeurs descendent jusqu'à zéro, et sa plage est alors écrite sous la courbe. Quand l'écran propose la case « Axe vertical à partir de zéro », la cocher rétablit l'échelle réelle.",
      "Cascades : l'axe est tronqué quand l'écart entre le niveau le plus bas et le niveau le plus haut de la cascade est inférieur à 30 % du niveau le plus haut. La mention « Axe tronqué à … », à côté du titre ou sous la cascade, dit où l'axe commence. La hauteur d'une barre de total n'est alors pas proportionnelle à sa valeur.",
      "Sur un axe ajusté ou tronqué, les écarts entre points ou entre barres paraissent plus grands qu'ils ne sont : les valeurs écrites sur le graphique, l'infobulle et le tableau donnent les montants exacts.",
    ].join("\n\n"),
    see: ["axe-ajuste", "lecture-tableau"],
  },
  {
    id: "lecture-tableau",
    term: "Graphique et tableau exact",
    family: FAMILY,
    definition: [
      "Un graphique est une lecture du tableau qui l'accompagne : le tableau reste la référence. Les montants y sont donnés au centime ; les ETP et les taux y sont affichés avec deux décimales (voir « Unités »). Le graphique ne montre que des valeurs déjà calculées, sans calcul supplémentaire.",
      "L'infobulle, au survol ou au clavier, donne le mois ou le groupe, puis pour chaque série son nom et sa valeur, dans la même unité que le tableau, ou « n.d. » avec sa raison. Sur un graphique à plusieurs séries, un clic sur un nom de la légende masque ou réaffiche la série.",
      "Au clavier, une tabulation place le focus sur le graphique ; les flèches gauche et droite (et les touches Début et Fin) passent d'une colonne à l'autre.",
    ].join("\n\n"),
    see: ["lecture-hachure", "lecture-empiler"],
  },
  {
    id: "lecture-empiler",
    term: "Empiler et Désempiler",
    family: FAMILY,
    definition: [
      "Sur un graphique en colonnes à plusieurs séries, « Empiler » superpose les séries : la hauteur d'une colonne est la somme des séries affichées. « Désempiler » les place côte à côte, chacune avec sa propre hauteur.",
      "La disposition ne change aucune valeur. L'infobulle d'une colonne empilée rappelle le « Total affiché ». Ce total ne compte que les séries visibles et les valeurs connues : une valeur n.d. n'est pas comptée comme zéro, et le total d'un mois où une série est n.d. ne couvre donc pas toutes les séries. Masquer une série dans la légende la retire du total affiché.",
    ].join("\n\n"),
    see: ["lecture-tableau", "lecture-nd"],
  },
  {
    id: "lecture-versions",
    term: "Versions : réel, scénario, budget saisi",
    family: FAMILY,
    definition: [
      "Une version est une série de chiffres mensuels que l'on lit ou que l'on compare. Il en existe trois sortes : le réel, lu dans la source de l'espace et figé à la date de la dernière lecture appliquée ; un scénario, qui part d'une base figée sur le mois précédant le premier mois projeté et applique des hypothèses saisies dans Clair sur un horizon de 24 mois au plus ; un budget saisi, le coût employeur mensuel d'une année, saisi dans Clair (un mois non saisi est n.d.).",
      "Dans les écrans de comparaison, les versions sont numérotées 1, 2 et 3 : la version 1 est le départ, la suivante l'arrivée. Chaque version se lit sur sa propre année ; un mois absent d'une version est n.d., jamais 0.",
      "Dans les courbes, le trait plein est la série principale de l'écran (le réel, la version 1 ou le scénario lu) et les pointillés sont les séries de comparaison (N-1, budget saisi, autres scénarios, versions suivantes) ; dans une projection par origine, les mois projetés sont en pointillés avec une zone teintée. La légende nomme toujours chaque série : le style du trait n'est jamais le seul repère.",
    ].join("\n\n"),
    see: ["versions", "origine-mois", "lecture-mois"],
  },
  {
    id: "lecture-mois",
    term: "Mois réalisés et mois projetés",
    family: FAMILY,
    definition: [
      "Un mois réalisé vient de la source lue (paie, DSN, comptabilité). Un mois projeté est calculé par un scénario à partir d'hypothèses saisies dans Clair. Un mois de budget saisi est un montant saisi. L'origine de chaque mois est écrite sous son montant dans les tableaux de projection.",
      "Un mois dont la paie n'est pas clôturée à la date de lecture n'est pas définitif. Dans la masse salariale (page Masse salariale et Synthèse du Studio RH), il est affiché « provisoire » : ses montants peuvent encore changer à la lecture suivante, et il est signalé dans la ligne de période, dans l'infobulle et dans le tableau. Dans les KPI RH et dans les hypothèses budgétaires, un tel mois n'est pas un mois clos : les chiffres qui en dépendent sont n.d., avec la raison « paie non clôturée à la lecture ».",
      "Le trait d'un scénario mêle donc des mois réels figés et des mois projetés ; un mois sans valeur coupe la plage.",
    ].join("\n\n"),
    see: ["origine-mois", "closed-period", "lecture-versions"],
  },
  {
    id: "lecture-tendances",
    term: "Tendances financières : rouge et vert",
    family: FAMILY,
    definition: [
      "Le rouge et le vert sont les deux seules couleurs hors de l'univers bleu, blanc et noir de Clair. Ils indiquent uniquement le sens d'une évolution de coût.",
      "Pour un coût (masse salariale, brut, charges, primes, indemnités, cotisations, coût par ETP), une hausse est une tendance défavorable, en rouge ; une baisse est une tendance favorable, en vert ; une variation nulle ou n.d. reste neutre, en noir.",
      "Sont colorés : toute évolution ou tout écart d'un montant de coût (face à N-1, face au budget, entre deux versions, effet d'une hypothèse ou d'une mesure, écart de rapprochement entre deux sources), y compris les colonnes Écart et Écart (%). Une économie, c'est-à-dire un coût évité, est une baisse de coût : elle est en vert.",
      "Cascades : celles qui décomposent un écart en euros (écart de masse salariale, pont d'écart) colorent leurs barres de hausse et de baisse de coût ; celles qui décomposent un total (atterrissage) ou des ETP restent bleues et grises.",
      "Les effectifs, les ETP, les entrées et les sorties ne sont jamais colorés en rouge ou en vert : ce ne sont pas des montants.",
      "La couleur n'est jamais seule : le signe + ou −, une flèche et la valeur écrite portent aussi le sens. Les messages d'erreur et les refus de calcul sont signalés à part, par un texte explicite ; ils ne sont pas des tendances.",
    ].join("\n\n"),
    see: ["ecart-couleurs", "ms-tendances"],
  },
  {
    id: "lecture-unites",
    term: "Unités : euros, ETP, personnes, pourcentages",
    family: FAMILY,
    definition: [
      "Euros : les montants sont conservés en centimes entiers avec leur devise (l'euro est la seule devise active) et affichés en euros avec deux décimales (1 234,56 €). Sur l'axe d'un graphique, ils sont abrégés en milliers (k€) ou en millions (M€) ; la valeur exacte est dans l'infobulle.",
      "ETP (équivalent temps plein) : somme des quotités des contrats, conservée au dix-millième d'ETP et affichée avec deux décimales. Sur l'écran KPI RH, la valeur au dix-millième se lit au survol et dans le détail du calcul.",
      "Personnes : un effectif de fin de mois est un nombre entier de personnes ; une moyenne d'effectif est affichée avec deux décimales.",
      "Pourcentages : un taux est affiché avec deux décimales (5,34 %) ; sur un graphique, l'étiquette d'une barre peut n'avoir qu'une décimale, l'infobulle donne les deux. L'écart entre deux taux est exprimé en points de pourcentage (pts), jamais en pourcentage d'un pourcentage.",
    ].join("\n\n"),
    see: ["rounding", "lecture-tendances"],
  },
  {
    id: "lecture-perimetre",
    term: "Périmètre et période",
    family: FAMILY,
    definition: [
      "Un écran de chiffres écrit, sur une ligne de contexte, la période et le périmètre auxquels ses chiffres se rapportent : mois, année civile ou 12 mois glissants ; version ou scénario ; établissement, nature de contrat ou service quand un filtre est actif.",
      "Deux chiffres ne se comparent que sur le même périmètre et la même période. Changer un filtre change les chiffres de l'écran, graphiques et tableaux ensemble.",
      "Les chiffres d'un espace ne se mélangent jamais avec ceux d'un autre espace.",
    ].join("\n\n"),
    see: ["closed-period", "rangs-de-mois"],
  },
  {
    id: "lecture-prevu",
    term: "Prévu, non réalisé, non disponible avec les données lues",
    family: FAMILY,
    definition: [
      "Une entrée de menu marquée « Prévu » est visible mais n'est pas encore construite. Sa page n'affiche aucun chiffre et ne simule aucun écran : elle dit où en est l'entrée, ce qui existe déjà ailleurs dans Clair et ce qui reste à préciser.",
      "« Non réalisé » : la fonction n'existe pas encore dans Clair. Ce n'est pas une donnée manquante.",
      "« Non disponible avec les données lues » : la fonction demande une donnée que les sources lues ne fournissent pas, par exemple une rubrique de bulletin que l'API PayFit ne renvoie pas ou un champ que le référentiel Collaborateurs ne lit pas. Clair ne l'estime pas et ne la remplace par aucune valeur.",
    ].join("\n\n"),
    see: ["lecture-nd"],
  },
  {
    id: "lecture-source",
    term: "Source et date de lecture",
    family: FAMILY,
    definition: [
      "Les chiffres viennent de la dernière lecture appliquée de la source retenue : API PayFit ou fichiers DSN pour les ressources humaines, API Pennylane ou fichiers FEC pour la comptabilité. La source retenue et la date de la lecture appliquée sont rappelées en tête des écrans de la Synthèse du Studio RH, des KPI RH, des Collaborateurs et de la Masse salariale.",
      "Les données sont lues à la demande (bouton « Synchroniser » ou dépôt de fichiers), stockées dans Clair, puis analysées : un changement fait dans PayFit n'apparaît dans Clair qu'après une nouvelle lecture appliquée. Les sources sont lues en lecture seule : Clair ne modifie rien chez le fournisseur.",
      "Sans lecture appliquée, la source retenue est n.d. et sa raison est écrite.",
    ].join("\n\n"),
    see: ["donnees-source-retenue", "donnees-lecture-apercu"],
  },
];
