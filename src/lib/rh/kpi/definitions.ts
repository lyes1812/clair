import { PAYFIT_ARCHIVED_RETENTION_MONTHS } from "@/lib/rh/referential/build-payfit";

// Définitions des KPI écrites dans l'app (règle 6), ancres #def-<id> ; mêmes textes partout où un chiffre est affiché.
export const KPI_DEFINITIONS: { id: string; title: string; text: string }[] = [
  {
    id: "etp-contract",
    title: "Quotité (ETP) d'un contrat pour un mois",
    text:
      "Part d'un temps plein prévue au contrat, pour un contrat de nature comptée présent le dernier jour du mois. Source DSN : quotité du contrat (S21.G00.40.013) ÷ quotité de référence de l'établissement (S21.G00.40.012), déclarées pour ce mois, dans leur unité (S21.G00.40.011 : heures, journées, forfait jours, forfait heures). Source PayFit : indicateur « temps plein » (isFullTime) ou ETP de la fiche (fullTimeEquivalent), lus à la date de lecture ; PayFit n'historise pas les quotités : la même valeur sert pour tous les mois. Règles de l'espace (Paramètres) : un temps plein vaut 1 quelle que soit sa durée (39 h = 1, forfait jours à temps plein = 1 ; DSN : modalité S21.G00.40.014 = 10) ; un rapport supérieur à 1 est ramené à 1 et signalé ; la quotité est arrondie au nombre de décimales choisi avant d'être additionnée. Les absences ne sont pas déduites : c'est un ETP contractuel, ni payé ni travaillé. Quotité absente, référence nulle ou unité non interprétée : le contrat est n.d.",
  },
  {
    id: "etp-month-end",
    title: "ETP contractuel fin de mois",
    text:
      "Somme des quotités des contrats comptés présents le dernier jour du mois, soit les mêmes contrats que l'effectif fin de mois en contrats. Si un contrat présent a une quotité n.d., le total est une borne basse « ≥ x » et le contrat est listé ; si aucune quotité n'est lisible, le total est n.d. Date en borne basse (PayFit) : « ≥ x ». Mois non couvert, bloqué ou postérieur à la date de référence : n.d.",
  },
  {
    id: "etp-average",
    title: "ETP moyen sur une période",
    text:
      "Moyenne arithmétique des ETP contractuels fin de mois de la période (somme ÷ nombre de mois). Tous les mois doivent être exacts : un mois n.d. ou en borne basse rend la moyenne n.d., et les mois en cause sont nommés. Le prorata journalier des entrées et sorties en cours de mois n'est pas appliqué (prévu en V2).",
  },
  {
    id: "headcount-average",
    title: "Effectif moyen sur une période",
    text: "Moyenne arithmétique des effectifs fin de mois en personnes (définition « Effectif (personnes) à une date »), aux mêmes conditions que l'ETP moyen.",
  },
  {
    id: "turnover",
    title: "Turnover",
    text:
      "Sur 12 mois glissants ou une année civile close : ((entrées + sorties) ÷ 2) ÷ effectif moyen de la période. Variante (Paramètres) : sorties ÷ effectif en personnes au premier jour de la période. Entrées et sorties : définition « Entrées et sorties d'un mois », natures comptées, connues à la date de référence, jamais déduites d'une différence d'effectifs ; elles sont comptées en contrats, l'effectif en personnes. Options (Paramètres) : sorties non comptées pour certaines natures (ex. fins de CDD, nature 02 ; le motif DSN n'est pas utilisé, PayFit ne le fournissant pas) ; contrats continus neutralisés (fin le jour J et nouveau contrat de la même personne le jour J+1, les deux de natures comptées : ni sortie, ni entrée). Si un mois a des entrées ou des sorties non exactes (PayFit : sorties d'un mois commencé avant la limite de conservation), ou un effectif non exact, le turnover est n.d.",
  },
  {
    id: "absenteeism",
    title: "Absentéisme",
    text:
      "Jours d'absence ÷ jours théoriques, sur un mois ou sur une période. Sur une période, on divise la somme des jours d'absence par la somme des jours théoriques ; ce n'est jamais une moyenne de taux mensuels. Jours théoriques d'un contrat compté pour un mois : jours du mois compris entre son début et sa fin, bornes incluses, en jours calendaires ou du lundi au vendredi (Paramètres). Aucun jour férié n'est connu, au numérateur comme au dénominateur. La quotité n'intervient pas. Jours d'absence : absences PayFit des types choisis et des statuts retenus (Paramètres), bornées au mois et à la période du contrat, comptées par demi-journées. Un début « mi-journée » ne compte que l'après-midi du premier jour, une fin « mi-journée » que le matin du dernier. Une demi-journée couverte par deux absences du même contrat compte une fois. Quand une borne a un moment absent ou non interprétable, ou quand une absence n'a pas de statut, la partie incertaine n'est pas comptée et le taux devient « ≥ x ». Une absence sans date de début ou de fin, ou rattachée à un contrat inconnu, rend le mois n.d. Tant qu'aucun type n'est choisi : n.d. Source DSN : n.d., les arrêts de travail ne sont pas extraits. Mois hors des mois lus par la lecture PayFit, ou en borne basse : n.d. Un mois sans absence des types choisis vaut 0 % : c'est un fait de la lecture.",
  },
  {
    id: "closed-period",
    title: "Période close et fenêtres",
    text:
      "Un mois est clos si son dernier jour est antérieur ou égal à la date de référence (PayFit : jour de la lecture ; DSN : fin du dernier mois complet). « 12 mois glissants » : les 12 mois finissant au mois choisi (par défaut, le dernier mois clos). « Année civile » : janvier à décembre d'une année dont décembre est clos (par défaut, la dernière). Une période qui dépasse le dernier mois clos est n.d. L'horloge du jour n'est jamais utilisée.",
  },
  {
    id: "previous-period",
    title: "Comparaison N-1 et écart",
    text:
      "Même définition, mêmes paramètres, même référentiel, période décalée de 12 mois. L'écart vaut valeur − N-1, en ETP, en personnes ou en points de pourcentage ; ce n'est jamais un pourcentage de pourcentage. Si l'une des deux valeurs est n.d. ou en borne basse, l'écart est n.d. et la raison est affichée. Aucune comparaison entre PayFit et DSN : leurs identifiants sont distincts. PayFit : les quotités de N-1 sont celles de la date de lecture.",
  },
  {
    id: "rounding",
    title: "Arrondis",
    text:
      "Quotité de chaque contrat arrondie au nombre de décimales choisi (Paramètres) avant la somme. Sommes exactes en dix-millièmes d'ETP, jours en demi-journées. Moyennes, taux et écarts conservés en fraction exacte et affichés à deux décimales (au plus proche, demi vers le haut). La fraction exacte est visible au survol et dans le détail.",
  },
];

export const KPI_ND_EXPLANATIONS: [string, string][] = [
  ["Période non close", "la période dépasse le dernier mois clos à la date de référence : aucun KPI de période n'est calculé."],
  ["Mois postérieur à la date de référence", "aucun chiffre n'est projeté : c'est le rôle des Hypothèses budgétaires."],
  ["Mois non couvert, incomplet ou bloqué (DSN)", "le mois est n.d. ; toute moyenne, tout turnover et tout absentéisme d'une période qui le contient sont n.d."],
  [
    "Borne basse (PayFit)",
    `contrats archivés depuis plus de ${PAYFIT_ARCHIVED_RETENTION_MONTHS ?? "n.d."} mois non renvoyés : effectif et ETP « ≥ » avant la date de lecture moins ${PAYFIT_ARCHIVED_RETENTION_MONTHS ?? "n.d."} mois, entrées « ≥ », sorties n.d. et absentéisme n.d. pour les mois qui commencent avant cette date.`,
  ],
  ["Quotité n.d.", "le contrat est listé et l'ETP fin de mois devient « ≥ x » ; sans aucune quotité lisible, l'ETP est n.d., jamais « ≥ 0 »."],
  ["Absences", "DSN : arrêts non extraits ; PayFit : collection non lue, mois hors des mois lus, types non choisis, absence sans date ou d'un contrat inconnu : n.d. ; moment ou statut absent : « ≥ x »."],
  ["Écart N-1", "n.d. dès que l'une des deux valeurs n'est pas exacte ; les deux valeurs restent affichées."],
];

export const SOURCE_GAPS: [string, string, string][] = [
  ["Quotités", "à la date de lecture, non historisées", "déclarées pour chaque mois (S21.G00.40.012 / .013)"],
  ["Date de référence", "jour de la lecture", "fin du dernier mois complet"],
  ["Borne basse", "contrats archivés depuis plus de 12 mois non renvoyés", "aucune ; mois manquant, incomplet ou bloqué n.d."],
  ["Absences", "lues, par type et statut, avec moments", "arrêts non extraits : absentéisme n.d."],
  ["Présence", "par dates de contrat", "par déclaration du mois"],
  ["Établissement", "une société par espace", "SIRET déclarant, plusieurs possibles"],
  ["Motif de sortie", "non exposé", "S21.G00.62.002 (non utilisé par les KPI)"],
  ["Identifiants", "collaborateur PayFit", "empreinte du NIR ou NTT : aucun lien avec PayFit"],
];
