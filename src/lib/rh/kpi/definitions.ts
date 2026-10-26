import { PAYFIT_ARCHIVED_RETENTION_MONTHS } from "@/lib/rh/referential/build-payfit";

// Raisons des n.d. des KPI et écarts entre PayFit et DSN, rendus par le glossaire (entrées kpi-nd-raisons et
// kpi-ecarts-sources). Les définitions des indicateurs sont au glossaire (src/lib/glossary/kpi.ts), ancres #def-<id>.
export const KPI_ND_EXPLANATIONS: [string, string][] = [
  ["Période non close", "la période dépasse le dernier mois clos à la date de référence : aucun KPI de période n'est calculé."],
  ["Mois postérieur à la date de référence", "aucun chiffre n'est projeté : c'est le rôle des Hypothèses budgétaires."],
  ["Mois non couvert, incomplet ou bloqué (DSN)", "le mois est n.d. ; toute moyenne, tout turnover et tout absentéisme d'une période qui le contient sont n.d."],
  [
    "Borne basse (PayFit, mode signalé)",
    `historique PayFit en mode « signalé » (Paramètres) : contrats archivés depuis plus de ${PAYFIT_ARCHIVED_RETENTION_MONTHS ?? "n.d."} mois non renvoyés : effectif et ETP « ≥ » avant la date de lecture moins ${PAYFIT_ARCHIVED_RETENTION_MONTHS ?? "n.d."} mois, entrées « ≥ », sorties n.d. et absentéisme n.d. pour les mois qui commencent avant cette date. En mode « brut » (défaut), ces mois sont calculés sur ce que l'API renvoie et la limite est dite une fois en tête d'écran.`,
  ],
  ["Quotité n.d.", "le contrat est listé et l'ETP fin de mois devient « ≥ x » ; sans aucune quotité lisible, l'ETP est n.d., jamais « ≥ 0 »."],
  ["Absences", "DSN : arrêts non extraits ; PayFit : collection non lue, mois hors des mois lus, motifs non choisis, absence sans date ou d'un contrat inconnu : n.d. ; moment ou statut absent : « ≥ x »."],
  ["Contrat continu non vérifiable", "neutralisation active et veille d'une entrée ou lendemain d'une sortie hors de la couverture : mouvements du mois n.d. (désactiver la neutralisation dans Paramètres pour les compter)."],
  ["Écart N-1", "n.d. dès que l'une des deux valeurs n'est pas exacte ; les deux valeurs restent affichées."],
];

export const SOURCE_GAPS: [string, string, string][] = [
  ["Quotités", "à la date de lecture, non historisées", "déclarées pour chaque mois (S21.G00.40.012 / .013)"],
  ["Date de référence", "jour de la lecture", "fin du dernier mois complet"],
  ["Historique", "contrats archivés depuis plus de 12 mois non renvoyés : chiffres bruts et mention en tête d'écran (ou « ≥ » / n.d. en mode signalé)", "aucune limite ; mois manquant, incomplet ou bloqué n.d."],
  ["Absences", "lues, par motif et statut, avec moments", "arrêts non extraits : absentéisme n.d."],
  ["Présence", "par dates de contrat", "par déclaration du mois"],
  ["Établissement", "une société par espace", "SIRET déclarant, plusieurs possibles"],
  ["Motif de sortie", "non exposé", "S21.G00.62.002 (non utilisé par les KPI)"],
  ["Identifiants", "collaborateur PayFit", "empreinte du NIR ou NTT : aucun lien avec PayFit"],
];
