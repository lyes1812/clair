import { PAYFIT_ARCHIVED_RETENTION_MONTHS } from "./referential/build-payfit";

// Définitions écrites dans l'app (règle 6 de CLAUDE.md), accessibles depuis chaque chiffre du module Collaborateurs.
const RETENTION = PAYFIT_ARCHIVED_RETENTION_MONTHS;
export const RH_DEFINITIONS: { id: string; title: string; text: string }[] = [
  {
    id: "presence",
    title: "Présence d'un contrat à une date",
    text:
      "Un contrat est présent à la date D si sa date de début est inférieure ou égale à D et s'il n'a pas de date de fin, ou si sa date de fin est supérieure ou égale à D. Les bornes sont incluses : le jour du départ, la personne est présente ; la veille de l'entrée, non. Un contrat sans date de début n'est jamais présent. Le statut PayFit (actif, archivé, en attente) n'intervient jamais. Source DSN : le contrat doit en plus figurer dans une déclaration retenue du mois de D pour son établissement, et ce mois doit être complet.",
  },
  {
    id: "headcount-persons",
    title: "Effectif (personnes) à une date",
    text:
      "Nombre d'identifiants de personne distincts ayant au moins un contrat présent à la date, dont la nature fait partie des natures comptées (Paramètres de l'espace ; défaut validé : CDI et CDD). Une personne qui a deux contrats compte une fois. Un contrat sans personne n'y entre pas ; il est affiché à part.",
  },
  {
    id: "headcount-contracts",
    title: "Effectif (contrats) à une date",
    text: "Nombre de contrats présents à la date, dont la nature fait partie des natures comptées. Toujours affiché à côté de l'effectif en personnes.",
  },
  {
    id: "all-contracts",
    title: "Contrats présents, toutes natures ; hors effectif",
    text:
      "Contrats présents à la date quelle que soit leur nature, ventilés par nature (code DSN et libellé). « Hors effectif » regroupe les natures non comptées, les contrats sans personne, les contrats non positionnables (sans date de début) et les personnes sans contrat.",
  },
  {
    id: "month-end",
    title: "Effectif fin de mois ; présents au moins un jour",
    text: "L'effectif fin de mois est l'effectif au dernier jour du mois. « Présents au moins un jour » compte les contrats dont l'intervalle recouvre au moins un jour du mois (et, en DSN, déclarés ce mois). Les deux grandeurs sont nommées distinctement.",
  },
  {
    id: "movements",
    title: "Entrées et sorties d'un mois",
    text:
      "Les entrées d'un mois sont les contrats dont la date de début est dans le mois ; les sorties, les contrats dont la date de fin est dans le mois. Elles ne sont jamais déduites d'une différence entre deux mois. Chaque ligne porte ses drapeaux : à venir, en attente, contrat continu (même personne), réembauche, renumérotation, mois provisoire.",
  },
  {
    id: "reference-date",
    title: "Date de référence",
    text:
      "PayFit : la date de la lecture appliquée (les collaborateurs et contrats sont une photographie à cette date). DSN : le dernier jour du dernier mois complet. L'horloge du jour n'est jamais utilisée. Au-delà de la date de référence, l'effectif est « n.d. » ; les entrées et sorties futures connues sont listées dans Mouvements › À venir.",
  },
  {
    id: "lower-bound",
    title: "Historique PayFit et borne basse",
    text:
      RETENTION === null
        ? "PayFit renvoie tous les contrats, archivés compris : aucune borne basse n'est appliquée."
        : `PayFit ne renvoie plus les contrats archivés depuis plus de ${RETENTION} mois (constaté sur le compte pilote le 22/10/2026 : contrats terminés depuis 12 à 14 mois encore renvoyés, aucun au-delà ; à vérifier pour chaque espace). Un contrat présent à une date D n'a pu disparaître que s'il a pris fin plus de ${RETENTION} mois avant la lecture : l'effectif à D est donc exact si D est postérieure ou égale à la date de lecture moins ${RETENTION} mois, et affiché « ≥ n (borne basse) » avant. Les entrées et sorties d'un mois qui commence avant cette date restent incomplètes. Paramètre de l'espace « Historique PayFit » : en mode brut (défaut validé le 22/10/2026), ces mois sont calculés sur ce que l'API renvoie, sans « ≥ » ni « n.d. », et la limite est dite une fois en tête d'écran (les chiffres peuvent être sous-estimés) ; en mode signalé, l'effectif y est affiché « ≥ n (borne basse) », les entrées « ≥ n » et les sorties « n.d. ».`,
  },
  {
    id: "identity",
    title: "Identité des personnes",
    text:
      "Une personne est identifiée uniquement par un identifiant stable (identifiant collaborateur PayFit ; empreinte du NIR ou de l'identifiant temporaire en DSN). Le nom, le prénom et le matricule sont des libellés d'affichage et ne servent jamais à rapprocher deux personnes. Un doute (identifiant temporaire puis NIR, contrat renuméroté) est signalé, jamais fusionné. Une réembauche créée comme nouveau collaborateur dans PayFit donne deux fiches.",
  },
];
