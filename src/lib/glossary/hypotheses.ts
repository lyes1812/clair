import type { GlossaryEntry } from "./types";

// Identifiants du glossaire vers lesquels renvoient les écrans de résultat des hypothèses budgétaires (projection, comparaison,
// atterrissage, embauches prévisionnelles) ; un test vérifie que chacun existe. Les entrées de budget.ts (définitions du moteur) et de
// masse.ts (tendances financières) sont citées ici, jamais recopiées.
export const HYP_TERMS = {
  projection: "projection",
  projectionGraphiques: "projection-graphiques",
  coutNature: "cout-nature",
  contributionsHorsBase: "contributions-hors-base",
  coutProjete: "cout-projete",
  origineMois: "origine-mois",
  comparaison: "comparaison",
  comparaisonGraphiques: "comparaison-graphiques",
  cascades: "atterrissage-cascades",
  mesuresLecture: "mesures-lecture",
  sensibilitesLecture: "sensibilites-lecture",
  embauchesCalendrier: "embauches-calendrier",
  // budget.ts
  atterrissage: "atterrissage",
  retraite: "retraite",
  mesures: "mesures",
  sensibilites: "sensibilites",
  pont: "pont",
  effectif: "effectif",
  contribution: "contribution",
  categories: "categories",
  embauchePostes: "embauche-postes",
  // masse.ts
  tendances: "ms-tendances",
} as const;

// Famille « Hypothèses budgétaires » : ce que les écrans de résultat expliquaient sous leurs titres, tuiles, graphiques et tableaux.
// Les définitions du moteur (base figée, contributions, atterrissage, pont, mesures, sensibilités…) sont dans budget.ts.
const FAMILY = "Hypothèses budgétaires" as const;

export const GLOSSARY_HYPOTHESES: GlossaryEntry[] = [
  {
    id: "projection",
    term: "Projection d'un scénario : réel figé, puis projeté",
    family: FAMILY,
    definition: [
      "La projection chiffre le coût employeur du scénario mois par mois : réel figé de la base jusqu'au mois de référence, puis mois projetés, du premier mois du scénario jusqu'à la fin de son horizon. Le tableau et les graphiques reprennent les mois réels de l'année du premier mois projeté, puis les mois projetés jusqu'à la fin de l'horizon. Chaque euro projeté remonte à la base figée ou à une hypothèse visible.",
      "Dans le tableau « Mois par mois », la colonne Nature donne l'origine de chaque mois (voir « Origine des mois »). Un clic sur un mois projeté ouvre son détail : chaque hypothèse (ou la base) avec le coût qu'elle apporte ; leur somme égale le coût du mois.",
      "Brut et charges sont n.d. sur un mois projeté dont un élément est saisi en coût chargé : cet élément n'est pas ventilé entre brut et charges, et le coût employeur reste exact. Sur un mois repris d'un scénario parent, brut et charges sont n.d. quand la base dérivée a été créée avant leur reprise.",
      "Un mois n.d. s'écrit « n.d. » avec sa raison (au survol de la cellule et sous le tableau) ; il n'est jamais remplacé par zéro et rend n.d. tout total qui le contient.",
    ].join("\n\n"),
  },
  {
    id: "projection-graphiques",
    term: "Lecture des graphiques de la projection",
    family: FAMILY,
    definition: [
      "Un graphique est une lecture : le tableau correspondant donne les montants exacts à l'euro près. Le coût employeur par mois est tracé en barres depuis zéro ; le réel (paie lue), le projeté par le scénario parent et le projeté sont nommés dans la légende et dans l'infobulle.",
      "L'effectif et les ETP de fin de mois sont tracés en courbes : trait plein pour les mois réels, pointillés pour les mois projetés. L'axe d'une courbe peut être ajusté aux valeurs : il ne part alors pas de zéro (la graduation le montre) et les valeurs de l'infobulle font foi. Quand l'ETP d'un mois est n.d., la courbe s'interrompt à ce mois ; la limite des ETP de la base (par exemple une quotité lue à la date de synchronisation, non historisée) est rappelée sous la tuile Effectif et ETP.",
      "Un mois n.d. est une colonne hachurée (aucune valeur n'est tracée) ou une courbe interrompue, avec sa raison au survol et sous les graphiques ; il n'est jamais dessiné comme zéro. Quand aucune valeur n'est connue, le graphique n'est pas tracé et les raisons sont écrites à sa place.",
    ].join("\n\n"),
  },
  {
    id: "cout-projete",
    term: "Coût projeté",
    family: FAMILY,
    formula: "coût projeté = somme du coût employeur des mois projetés",
    definition:
      "Somme du coût employeur des mois projetés, du premier mois du scénario à la fin de son horizon (nombre de mois indiqué sous le titre de la tuile). Il est n.d. dès qu'un mois projeté est n.d. ; les raisons sont écrites sous les tableaux. Il ne contient pas les mois réels : l'atterrissage de l'année les ajoute.",
  },
  {
    id: "cout-nature",
    term: "Coût projeté par nature de contribution",
    family: FAMILY,
    formula: "coût du mois = somme des contributions de chaque nature",
    definition: [
      "Chaque barre additionne, pour un mois projeté, les contributions du moteur de projection regroupées par nature : base (figée ou corrigée), augmentations, changements de quotité, embauches, éléments ponctuels, enveloppes, coûts de sortie, départs et fins de contrat connues, entrées après la base (prorata) et congés non payés. Le coût du mois est la somme de ces natures (« Total affiché » dans l'infobulle) ; la dernière ligne du tableau reprend le coût du mois donné par le moteur.",
      "Un montant négatif se retire du coût du mois (départ, congé non payé, prorata d'une entrée). Dans le tableau, « — » signifie qu'aucune contribution de cette nature n'existe ce mois-là (aucune hypothèse de ce type) : ce n'est pas un solde calculé à zéro. Un mois n.d. n'a aucune valeur ; sa raison est au survol.",
      "Le détail par hypothèse d'un mois s'ouvre depuis le tableau « Mois par mois ». Quand plus de huit natures sont présentes, certaines partagent une teinte : l'infobulle et le tableau nomment chaque nature.",
    ].join("\n\n"),
  },
  {
    id: "contributions-hors-base",
    term: "Contributions hors base",
    family: FAMILY,
    definition: [
      "Même graphique que le coût par nature de contribution, sans la base (figée ou corrigée) : la base, bien plus haute que chaque contribution, écraserait l'échelle. On ne voit que ce que les hypothèses ajoutent (au-dessus de l'axe) ou retirent (sous l'axe : départs, congés non payés, prorata d'une entrée), sur leur propre échelle.",
      "Mêmes séries, mêmes teintes et mêmes montants du moteur que le graphique complet ; les montants exacts sont dans le tableau « Coût projeté par nature de contribution ». Quand aucune contribution hors base n'a un montant non nul sur l'horizon, le graphique n'est pas tracé : le coût de chaque mois est celui de la base.",
    ].join("\n\n"),
  },
  {
    id: "origine-mois",
    term: "Origine des mois : réel, projeté, budget saisi",
    family: FAMILY,
    definition: [
      "Chaque mois d'une lecture a une origine, écrite sous son montant dans le tableau : réel (paie lue, figée dans la base du scénario), projeté par le scénario parent (mois projetés du scénario dont la base est dérivée, avant le premier mois du scénario), projeté (par ce scénario) ou budget saisi. L'origine d'un mois projeté par un scénario parent est nommée « projeté — scénario « X » », X étant le scénario dont ce budget est dérivé (directement ou par une dérivation antérieure).",
      "Le trait d'un scénario mêle donc des mois réels figés et des mois projetés ; par exemple « réel janv.–sept. ; projeté oct.–déc. ». Un mois sans valeur coupe la plage. Les lecteurs d'écran trouvent ce résumé dans l'étiquette du graphique.",
    ].join("\n\n"),
  },
  {
    id: "comparaison",
    term: "Comparaison de lectures et écarts",
    family: FAMILY,
    formula: "écart = coût du scénario − coût de la lecture comparée ; écart (%) = écart ÷ lecture comparée",
    definition: [
      "La comparaison met le coût employeur mensuel d'une année de ce scénario face à trois lectures au plus : le réel courant (paie lue), l'année précédente (N-1), les budgets saisis et les autres scénarios de l'espace. Les mois sont rapprochés un à un.",
      "Un écart positif signifie que le scénario est au-dessus de la lecture comparée (coût plus élevé). Un écart de coût s'écrit en rouge quand il est positif et en vert quand il est négatif (voir « Tendances financières »), toujours avec son signe et une flèche. Le pourcentage est l'écart ÷ la lecture comparée ; il est n.d. quand la référence est nulle.",
      "« Sur l'année » compare les douze mois ; « mêmes mois » compare seulement les mois déjà réalisés (de janvier au mois de référence de la base), pour ne pas opposer des mois réalisés à des mois à venir. Un total est n.d. dès qu'un de ses mois l'est ; la raison est au survol de la cellule.",
    ].join("\n\n"),
  },
  {
    id: "comparaison-graphiques",
    term: "Lecture des courbes et des écarts de la comparaison",
    family: FAMILY,
    definition: [
      "Courbes : le coût employeur de chaque mois, le scénario en trait plein bleu avec une aire teintée, le réel courant en trait plein plus sombre, les autres lectures (N-1, budgets saisis, autres scénarios) en pointillés. Le nom de la lecture, dans la légende et l'infobulle, porte l'information : la teinte ne la porte jamais seule, et un clic sur une lecture de la légende la masque ou la réaffiche. L'axe peut être ajusté aux valeurs : il ne part alors pas de zéro (la graduation le montre).",
      "Une courbe s'interrompt aux mois sans valeur (raison au survol et sur la ligne n.d. sous les graphiques) ; elle n'est jamais tracée à zéro ni interpolée.",
      "Barres d'écart : l'écart mensuel du scénario face à chaque lecture (scénario − lecture comparée), positif au-dessus de l'axe. Il n'y a pas de barre quand l'une des deux lectures est n.d. ce mois-là. Chaque barre garde la teinte de sa lecture : le rouge et le vert des écarts de coût sont réservés aux tuiles et aux tableaux.",
    ].join("\n\n"),
  },
  {
    id: "atterrissage-cascades",
    term: "Cascades de l'atterrissage",
    family: FAMILY,
    definition: [
      "Première cascade : chaque barre ajoute un ensemble de mois à la précédente (réel, puis mois projetés par le scénario parent le cas échéant, puis par ce scénario) jusqu'au total de l'année. Les montants sont ceux de la tuile et de son pied de tuile. Une année entièrement réelle ou entièrement projetée n'a pas de cascade : elle n'apporterait rien de plus que le total.",
      "Seconde cascade : de l'atterrissage à l'atterrissage retraité, en retirant les éléments non récurrents déjà comptabilisés puis ceux que les hypothèses prévoient. Sans élément non récurrent, le retraité égale l'atterrissage et la cascade n'est pas tracée.",
      "Ces deux cascades décomposent un total : elles ne sont pas colorées en rouge ou en vert, qui sont réservés aux écarts de coût (le pont d'écart de la comparaison, par exemple). Une cascade n.d. affiche sa raison.",
    ].join("\n\n"),
  },
  {
    id: "mesures-lecture",
    term: "Lecture des mesures de management",
    family: FAMILY,
    definition: [
      "Chaque départ du scénario est évalué seul : la projection est comparée avec et sans ce départ. Une économie nette positive est une économie (paie évitée supérieure aux coûts de sortie et au coût du remplaçant lié) ; négative, c'est un surcoût. Une économie s'écrit en vert quand elle est positive et en rouge quand elle est négative (voir « Tendances financières »).",
      "Un départ sans remplaçant lié n'a pas de barre « Coût du remplaçant » dans le graphique, et le tableau écrit « sans remplacement ». L'économie sur une année pleine est n.d., avec sa raison sous le tableau, quand décembre est hors de l'horizon ou que le remplaçant arrive après le 1er décembre.",
    ].join("\n\n"),
  },
  {
    id: "sensibilites-lecture",
    term: "Saisie et lecture des sensibilités",
    family: FAMILY,
    formula: "effet = atterrissage avec la variation − atterrissage retenu",
    definition: [
      "Chaque ligne du formulaire choisit une hypothèse et une variation ; l'unité de la valeur est écrite dans le libellé de la variation : un décalage en jours pour une date, des points de % pour un taux d'augmentation (par exemple 0,5), un % pour un montant ou pour des coûts de sortie. Chaque variation est calculée seule, sans être enregistrée ; aucune valeur n'est proposée par défaut.",
      "Les numéros du graphique sont ceux des variations, dans l'ordre du formulaire et du tableau. Un effet positif (coût en hausse) s'écrit en rouge, un effet négatif (coût en baisse) en vert (voir « Tendances financières »). Pas de barre quand la variation est n.d. (raison au survol et dans le tableau) ; l'effet sur le retraité est n.d. quand l'atterrissage retraité l'est.",
    ].join("\n\n"),
  },
  {
    id: "embauches-calendrier",
    term: "Embauches prévisionnelles : calendrier et regroupements",
    family: FAMILY,
    definition: [
      "Les embauches prévisionnelles sont les postes futurs du scénario : elles ne sont jamais confondues avec des collaborateurs réels. Un poste est compté le mois de son premier jour payé ; le tableau classe les postes par date d'arrivée. Le coût de chaque poste est calculé par la projection (prorata d'arrivée, augmentations ciblées, tuilage d'un remplacement).",
      "Le graphique regroupe les postes par catégorie de contrat, centre de coûts, métier ou motif d'embauche. Un regroupement dont aucun poste ne porte la valeur est n.d. avec sa raison : Clair ne reconstitue jamais une ventilation. Un poste dont le premier jour payé est hors des mois affichés n'est pas tracé mais reste compté dans la colonne Total du tableau.",
      "L'axe vertical du graphique compte des postes, en entiers depuis zéro. Au-delà de huit groupes, les teintes se répètent : l'infobulle et le tableau nomment chaque groupe.",
    ].join("\n\n"),
  },
];
