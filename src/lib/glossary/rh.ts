import { RH_DEFINITIONS } from "@/lib/rh/definitions";
import type { GlossaryEntry } from "./types";

// Famille « Collaborateurs » : les définitions déjà écrites dans l'application (reprises avec leurs identifiants d'ancre), puis les
// explications retirées des écrans — une entrée par notion, chaque écran y renvoie par un lien « ? ».
const FAMILY = "Collaborateurs" as const;

// Formules d'une ligne, ajoutées aux définitions existantes (sans en changer le texte).
const FORMULAS: Record<string, string> = {
  presence: "présent à la date D si début ≤ D et (aucune fin ou fin ≥ D)",
  "headcount-persons": "personnes distinctes ayant au moins un contrat présent à la date, d'une nature comptée",
  "headcount-contracts": "contrats présents à la date, d'une nature comptée",
  "month-end": "effectif fin de mois = effectif au dernier jour du mois",
  movements: "entrées du mois = contrats dont le début est dans le mois ; sorties = contrats dont la fin est dans le mois",
};

// Paragraphes ajoutés à une définition existante : le texte qui était écrit sous les chiffres.
const MORE: Record<string, string> = {
  movements:
    "Dans les écrans Collaborateurs, les contrats continus d'une même personne ne sont pas neutralisés : chaque contrat compte sa propre entrée et sa propre sortie, même s'il fait suite à un contrat de la même personne. Le turnover du KPI RH applique la règle choisie dans les Paramètres.",
};

// « Voir aussi » : les notions voisines (identifiants d'entrées existantes, vérifiés par le test de la famille).
const SEE: Record<string, string[]> = {
  presence: ["month-states", "natures"],
  "headcount-persons": ["headcount-contracts", "natures", "all-contracts"],
  "headcount-contracts": ["headcount-persons", "natures"],
  "all-contracts": ["natures", "headcount-persons"],
  "month-end": ["presence", "headcount-persons"],
  movements: ["movements-chart", "presence"],
  "reference-date": ["collab-covered-months", "collab-nd-raisons"],
  "lower-bound": ["collab-nd-raisons", "lecture-nd"],
  identity: ["fiche-collaborateur"],
};

// Le texte existant est repris tel quel ; deux retouches de rédaction seulement : la mention d'un compte d'essai devient un constat
// sur un compte PayFit, et le texte long est coupé en paragraphes (une idée par paragraphe).
const polish = (text: string): string =>
  text
    .replace(/\(constaté sur le compte pilote le [0-9/]+ :/, "(constat sur un compte PayFit :")
    .replace(" Les entrées et sorties d'un mois qui commence", "\n\nLes entrées et sorties d'un mois qui commence")
    .replace(" Paramètre de l'espace « Historique PayFit » :", "\n\nParamètre de l'espace « Historique PayFit » :");

const FROM_CODE: GlossaryEntry[] = RH_DEFINITIONS.map((d) => ({
  id: d.id,
  term: d.title,
  family: FAMILY,
  definition: MORE[d.id] ? `${polish(d.text)}\n\n${MORE[d.id]}` : polish(d.text),
  ...(FORMULAS[d.id] ? { formula: FORMULAS[d.id] } : {}),
  ...(SEE[d.id] ? { see: SEE[d.id] } : {}),
}));

const MOVED: GlossaryEntry[] = [
  {
    id: "natures",
    term: "Natures de contrat comptées dans l'effectif",
    family: FAMILY,
    definition:
      "Les natures de contrat comptées dans l'effectif sont un paramètre de l'espace (Paramètres). Valeur par défaut validée : CDI et CDD ; un administrateur peut la modifier.\n\nLes contrats d'une autre nature ne sont pas dans l'effectif : ils sont listés dans « Hors effectif », par nature.",
    see: ["headcount-persons", "all-contracts"],
  },
  {
    id: "month-states",
    term: "État en fin de mois",
    family: FAMILY,
    definition:
      "L'état d'un contrat en fin de mois suit la définition de la présence d'un contrat à une date, avec les natures comptées de l'espace. Les états sont : présent, entré dans le mois (avec sa date), sorti dans le mois (avec sa date), entré et sorti dans le mois, absent en fin de mois, non déclaré ce mois, hors effectif (nature non comptée).\n\nDeux cas sont signalés en plus : un contrat déclaré après sa fin, et un contrat déclaré avant son début. Ils ne sont pas tranchés : ils apparaissent aussi dans les constats.",
    see: ["presence", "natures", "collab-findings"],
  },
  {
    id: "collab-covered-months",
    term: "Mois couverts",
    family: FAMILY,
    definition:
      "Un mois est couvert lorsque son dernier jour est antérieur ou égal à la date de référence et qu'une lecture appliquée (PayFit) ou des déclarations complètes (DSN) le couvrent. Pour un mois non couvert, l'effectif de fin de mois est « n.d. » avec sa raison ; rien n'est reconstitué entre deux mois.\n\nLes totaux annuels d'entrées et de sorties sont alors « au moins n » : seuls les mois couverts sont comptés.",
    formula: "mois couverts / 12",
    see: ["reference-date", "collab-nd-raisons"],
  },
  {
    id: "strip-presence",
    term: "Frise de présence et mois présents",
    family: FAMILY,
    definition:
      "La colonne « Fin de mois » de la liste annuelle montre un carré par mois, regroupés par trimestre. Bleu : la personne est présente en fin de mois. Blanc : absente. Hachuré : n.d. ; la raison de chaque mois est donnée au survol et aux lecteurs d'écran. La présence suit la définition de la présence d'un contrat à une date.\n\n« Mois présents » compte les mois où la personne est présente, sur les seuls mois couverts (les mois n.d. ne sont pas comptés).",
    formula: "mois présents sur mois couverts",
    see: ["presence", "collab-covered-months", "lecture-hachure"],
  },
  {
    id: "quota-and-time",
    term: "Quotité, temps payé et temps travaillé",
    family: FAMILY,
    definition:
      "PayFit : la quotité (ETP du contrat) est la valeur à la date de lecture ; PayFit ne l'historise pas, elle n'est pas reconstituée mois par mois. DSN : quotité du contrat et quotité de référence, dans l'unité déclarée, pour le mois concerné.\n\nTemps payé et temps travaillé sont ceux du mois, dans l'unité de la source. « 0 — sous contrat, aucun temps payé » est un zéro réel ; une valeur absente de la source s'affiche « n.d. », jamais zéro.",
    see: ["contract-read-attributes", "lecture-nd"],
  },
  {
    id: "contract-read-attributes",
    term: "Attributs du contrat à la date de lecture (PayFit)",
    family: FAMILY,
    definition:
      "Le statut PayFit, l'ETP contractuel, les heures hebdomadaires, le temps plein, la modalité et le cadre dirigeant sont les valeurs renvoyées par PayFit à la date de lecture. PayFit ne les historise pas : ils ne servent pas à reconstituer les mois passés, et la nature et la quotité de chaque mois sont n.d. pour PayFit.\n\nLe statut PayFit (actif, archivé, en attente) n'est jamais utilisé pour compter : la présence se calcule sur les dates du contrat.",
    see: ["quota-and-time", "presence"],
  },
  {
    id: "movements-chart",
    term: "Graphique des entrées et sorties par mois",
    family: FAMILY,
    definition:
      "Le graphique compte des contrats (pas des personnes), sur les natures comptées de l'espace, pour chaque mois de la période choisie. Les entrées sont les contrats dont la date de début tombe dans le mois, les sorties ceux dont la date de fin tombe dans le mois.\n\nUn mois n.d. ou en borne basse n'est pas tracé : ses valeurs et sa raison sont dans le tableau voisin et dans la liste des mois non exacts. Le tableau fait foi ; le graphique en est une lecture.\n\nLes contrats continus d'une même personne ne sont pas neutralisés.",
    see: ["movements", "lecture-hachure", "lecture-tableau"],
  },
  {
    id: "fiche-collaborateur",
    term: "Fiche collaborateur",
    family: FAMILY,
    definition:
      "Une fiche regroupe les contrats d'une même personne, identifiée par son identifiant stable. La recherche porte sur toutes les colonnes affichées : nom, matricule, identifiant, contrat, nature, dates.\n\nLes droits d'accès aux données individuelles restent ceux de l'espace.",
    see: ["identity", "person-contracts-read"],
  },
  {
    id: "person-contracts-read",
    term: "Contrats lus (fiche)",
    family: FAMILY,
    definition: "Nombre de contrats rattachés à la personne dans la lecture appliquée, toutes natures et toutes dates confondues. Ce n'est pas un effectif : l'effectif compte les contrats présents à une date, d'une nature comptée.",
    see: ["headcount-contracts"],
  },
  {
    id: "person-oldest-start",
    term: "Début du plus ancien contrat lu",
    family: FAMILY,
    definition: "Date de début la plus basse parmi les contrats lus de la personne dont la date est connue. Les contrats sans date de début sont comptés à part, jamais ramenés à une date ; s'il n'y en a aucune, la valeur est « n.d. ».",
  },
  {
    id: "collab-findings",
    term: "Constats",
    family: FAMILY,
    definition:
      "Un constat signale un cas limite repéré dans les données lues : réembauche, contrats simultanés, contrat sans date de début, contrat absent des déclarations suivantes, même contrat sous deux identifiants… Un cas limite n'est jamais tranché en silence : il est affiché, avec les personnes et les contrats concernés.\n\nDeux niveaux : « à vérifier » (le cas appelle une vérification dans la source) et « information » (le cas est signalé par transparence).",
    see: ["identity", "month-states"],
  },
  {
    id: "collab-nd-raisons",
    term: "Pourquoi une valeur est « n.d. »",
    family: FAMILY,
    definition:
      "Dans les écrans Collaborateurs, une valeur « n.d. » porte l'une de ces raisons.\n\nPériode postérieure à la date de référence : l'effectif n'est jamais projeté ; les entrées et sorties futures connues sont listées dans Mouvements › À venir.\n\nPériode non couverte : aucune lecture ni déclaration appliquée pour ce mois ; rien n'est reconstitué entre deux mois.\n\nMois DSN incomplet ou bloqué : fractions manquantes ou conflit de numéro d'ordre ; les faits sont lus, l'effectif du mois est n.d.\n\nBorne basse (PayFit) : avec l'historique PayFit en mode « signalé » (Paramètres), pour les mois antérieurs à la fenêtre de conservation des contrats archivés, les effectifs et les entrées s'affichent « au moins n » et les sorties sont n.d. En mode « brut » (défaut), ces mois sont calculés sur ce que l'API renvoie et la limite est dite une fois en tête d'écran.\n\nChamp non porté par la source : motif de fin et temps travaillé (DSN), nom d'usage, équipe ou versements (PayFit) : n.d., jamais devinés.\n\nChamp non renseigné : valeur nulle dans la source (temps, matricule, nature) : n.d., jamais zéro.\n\nDroit non accordé : collection ou champ refusé par la clé API : n.d., avec le droit manquant.",
    see: ["lecture-nd", "lower-bound", "reference-date"],
  },
];

export const GLOSSARY_RH: GlossaryEntry[] = [...FROM_CODE, ...MOVED];
