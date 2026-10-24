import { PAYFIT_ARCHIVED_RETENTION_MONTHS } from "@/lib/rh/referential/build-payfit";
import type { GlossaryEntry } from "./types";

// Identifiants du glossaire vers lesquels renvoient les écrans Données, Paramètres, Membres et Reporting social (un test vérifie que
// chacun existe). Les termes évitent volontairement les mots « règle », « rôle » (donc « contrôle ») et « e-mail » : le lien « ? »
// porte un libellé accessible « Définition : <terme> » que les tests de bout en bout ne doivent pas confondre avec un champ de formulaire.
export const DONNEES_TERMS = {
  lecture: "donnees-lecture-apercu",
  sourceRetenue: "donnees-source-retenue",
  cleApi: "donnees-cle-api",
  periode: "donnees-periode-lecture",
  depotDsn: "donnees-depot-dsn",
  couvertureDsn: "donnees-couverture-dsn",
  depotFec: "donnees-depot-fec",
  extraits: "donnees-extraits",
  etapes: "donnees-etapes-pastilles",
  origine: "param-origine",
  effectif: "param-effectif",
  historique: "param-historique-payfit",
  kpi: "param-kpi",
  etp: "param-etp",
  turnover: "param-turnover",
  sortiesNonComptees: "param-sorties-non-comptees",
  absenceTypes: "param-absence-types",
  absenceStatuts: "param-absence-statuts",
  absenceBase: "param-absence-base",
  grille: "param-grille-comptes",
  axeService: "param-axe-service",
  prorata: "param-prorata",
  categories: "param-categories-contrat",
  profils: "membres-roles",
  invitation: "membres-invitation",
  journal: "membres-journal",
  bdese: "reporting-bdese",
} as const;

const FAMILY = "Données" as const;
const RETENTION = PAYFIT_ARCHIVED_RETENTION_MONTHS ?? "n.d.";

// Famille « Données » : ce que les écrans Données, Paramètres, Membres et Reporting social expliquaient sous leurs titres, leurs champs
// et leurs formulaires. Une entrée par notion ; les définitions des indicateurs (turnover, absentéisme, quotité, masse chargée…)
// restent dans leur famille et sont citées par leur nom, jamais recopiées.
export const GLOSSARY_DONNEES: GlossaryEntry[] = [
  // --- Données : sources, lectures, dépôts --------------------------------------------------------------------------------
  {
    id: DONNEES_TERMS.lecture,
    term: "Lecture, aperçu et application",
    family: FAMILY,
    definition: [
      "Rien n'est lu dans une source tant qu'une synchronisation n'est pas lancée : bouton « Synchroniser » pour une API, « Déposer » pour des fichiers. Les sources sont lues en lecture seule : Clair ne modifie jamais rien chez PayFit ni chez Pennylane.",
      "Chaque lecture passe par un aperçu avant d'être appliquée. L'aperçu montre ce qui a été lu (éléments, nouveaux, modifiés, retirés) sans rien changer. Appliquer rend la lecture active pour les modules du Studio RH ; abandonner jette l'aperçu, rien n'est modifié. Un contenu identique à la source active est reconnu à son empreinte : rien à appliquer, aucun doublon créé.",
      "Fichiers (DSN, FEC) : les dépôts s'additionnent. Appliquer fait compter ces fichiers dans la couverture de l'espace ; un fichier qui en remplace un autre est signalé dans l'aperçu. Une lecture remplacée par une application plus récente reste dans l'historique.",
    ].join("\n\n"),
  },
  {
    id: DONNEES_TERMS.sourceRetenue,
    term: "Source retenue par domaine",
    family: FAMILY,
    definition: [
      "Pour chaque domaine (ressources humaines, comptabilité), Clair retient une source pour les modules : l'API (PayFit pour les ressources humaines, Pennylane pour la comptabilité) ou les fichiers (DSN, FEC). La source retenue est rappelée sur chaque écran qui l'utilise.",
      "Mode automatique : l'API fait foi si elle est connectée et qu'une lecture est appliquée ; sinon les fichiers déposés font foi. Un administrateur peut forcer « API uniquement » ou « Fichiers uniquement » : sans lecture appliquée de la source forcée, la source retenue est n.d., avec sa raison.",
      "Sur la page Données, la carte de la source retenue porte un liseré bleu.",
    ].join("\n\n"),
  },
  {
    id: DONNEES_TERMS.cleApi,
    term: "Clé API : création, droits et stockage",
    family: FAMILY,
    definition: [
      "PayFit : créer dans PayFit (Intégrations, Accès API) une clé dédiée à Clair, en lecture seule, avec les droits accounting:read, collaborators:read, contracts:read, contracts:time-information:read et time:read.",
      "Pennylane : créer dans Pennylane (Paramètres, Connectivité, Développeurs) un jeton d'API dédié à Clair, en lecture seule sur la comptabilité. L'identifiant de société est facultatif : il n'est utile qu'avec un jeton donnant accès à plusieurs sociétés.",
      "La clé est vérifiée auprès du fournisseur, puis stockée chiffrée ; elle n'est plus jamais affichée. Remplacer la clé la vérifie de nouveau. Seul un administrateur connecte ou déconnecte une source ; déconnecter supprime la clé enregistrée.",
    ].join("\n\n"),
  },
  {
    id: DONNEES_TERMS.periode,
    term: "Période d'une lecture par API",
    family: FAMILY,
    definition: [
      "Une lecture porte sur une période de 24 mois au plus (du mois… au mois…, bornes incluses).",
      "PayFit : collaborateurs et contrats dans leur état actuel chez PayFit (les contrats archivés depuis plus d'un an ne sont pas fournis) ; temps, absences, statut de paie et journal comptable pour chaque mois de la période.",
      "Pennylane : plan comptable complet, puis lignes d'écritures des classes 6 et 7 et des comptes 421, 431 et 437, pour chaque mois de la période.",
      "Rien n'est modifié avant la validation de l'aperçu.",
    ].join("\n\n"),
  },
  {
    id: DONNEES_TERMS.depotDsn,
    term: "Dépôt de fichiers DSN",
    family: FAMILY,
    definition: [
      "Déclarations sociales nominatives mensuelles, déposées fichier par fichier (norme P25V01 ou P26V01 ; 24 fichiers et 4 Mo par fichier au plus).",
      "Chaque fichier est lu, contrôlé et présenté en aperçu avant d'être appliqué. Un fichier déjà déposé est reconnu à son empreinte et n'est pas importé deux fois. Le fichier d'origine est conservé chiffré ; le NIR n'est jamais stocké en clair.",
      "Les lectures appliquées s'additionnent. Pour chaque établissement et chaque mois, la déclaration qui fait foi est déterminée par les règles de la norme : numéro d'ordre, annule et remplace, fractions.",
    ].join("\n\n"),
  },
  {
    id: DONNEES_TERMS.couvertureDsn,
    term: "Couverture DSN",
    family: FAMILY,
    definition: [
      "Pour chaque mois et chaque établissement (SIRET), la couverture dit si les déclarations retenues sont complètes (toutes les fractions sont présentes), incomplètes ou bloquées (conflit de numéro d'ordre, par exemple). Elle liste les déclarations retenues, les déclarations écartées avec leur raison, et les constats. Avec une lecture DSN, l'effectif d'un mois incomplet ou bloqué est n.d., avec la raison de la couverture.",
      "La lecture est partielle : individus, contrats, rémunérations et activités. Les cotisations et les arrêts de travail ne sont pas extraits de la DSN.",
    ].join("\n\n"),
  },
  {
    id: DONNEES_TERMS.depotFec,
    term: "Dépôt de fichiers FEC",
    family: FAMILY,
    definition: [
      "Fichier des écritures comptables (article A47 A-1 du Livre des procédures fiscales), exporté depuis Pennylane ou tout autre logiciel comptable. Un fichier par exercice ; toutes les écritures sont conservées telles quelles, en centimes exacts. Les montants ne sont ni retraités ni interprétés.",
      "Format : 18 colonnes de la norme, séparées par une tabulation ou « | » ; 6 fichiers et 32 Mo par fichier au plus. Chaque fichier est lu, contrôlé (équilibre, dates, montants) et présenté en aperçu avant d'être appliqué. Un fichier déjà déposé est reconnu à son empreinte ; un FEC couvrant la même période que l'un déjà appliqué le remplace.",
      "Un exercice est « équilibré » quand son total débit égale son total crédit et que chacune de ses écritures l'est ; sinon le nombre d'écritures non équilibrées est indiqué.",
    ].join("\n\n"),
  },
  {
    id: DONNEES_TERMS.extraits,
    term: "Extraits lus et totaux du journal comptable",
    family: FAMILY,
    definition: [
      "Les extraits de collaborateurs et de contrats sont les dix premiers enregistrements lus, à titre de contrôle de la lecture : ce n'est pas la liste complète.",
      "Les totaux par mois et par compte du journal comptable sont les montants tels que lus à la source, sans retraitement. « — » signifie qu'aucune ligne ne porte de montant de ce côté du compte ; « n.d. » signifie qu'une ou plusieurs lignes n'ont pas de montant, leur nombre est indiqué.",
      "Pour un FEC, seules les classes 6 et 7 et les comptes 421, 431 et 437 sont affichés ; les autres classes sont conservées, mais ne sont pas affichées.",
    ].join("\n\n"),
  },
  {
    id: DONNEES_TERMS.etapes,
    term: "Étapes d'une source et pastilles d'état",
    family: FAMILY,
    definition: [
      "Une source passe par quatre étapes : connexion (clé vérifiée), lecture (au moins une lecture faite), aperçu (à valider, ou aucun en attente) et application (une lecture est active). L'état de chaque étape est déduit de la connexion et de l'historique des lectures, rien d'autre.",
      "Les pastilles d'état se lisent par leur libellé ; la teinte le renforce. Bleu plein : appliquée. Bleu cerné : aperçu à valider. Bleu clair : lecture en cours. Rouge : échec ou refus. Gris : sans effet (remplacée, abandonnée, aucun changement).",
    ].join("\n\n"),
  },

  // --- Paramètres : réglages de l'espace ----------------------------------------------------------------------------------
  {
    id: DONNEES_TERMS.origine,
    term: "Paramètres : origine d'un réglage et pastilles",
    family: FAMILY,
    definition: [
      "Les règles métier de l'espace sont écrites dans Paramètres et appliquées telles quelles ; aucune valeur n'est cachée. Seul un administrateur les modifie.",
      "Chaque réglage dit d'où vient sa valeur : « Valeur par défaut validée le JJ/MM/AAAA » (défaut validé), « Valeur par défaut proposée, à confirmer » (défaut proposé), « Modifié le… par un administrateur » (valeur enregistrée), ou « Valeur enregistrée illisible : à ré-enregistrer » (les KPI ne sont pas calculés d'ici là). Une carte dont tous les défauts sont validés le dit une seule fois ; seules les exceptions portent leur propre mention.",
      "Pastilles du volet « Sur cette page » : « Modifiée » (une valeur n'est plus le défaut), « À corriger » (valeur illisible), « À renseigner » (règle sans valeur par défaut, pas encore choisie : Clair refuse de calculer et le dit). Une règle laissée à son défaut ne porte aucune pastille.",
    ].join("\n\n"),
  },
  {
    id: DONNEES_TERMS.effectif,
    term: "Paramètre : natures de contrat comptées dans l'effectif",
    family: FAMILY,
    see: ["natures", "headcount-persons"],
    formula: "effectif à une date = personnes ayant au moins un contrat en cours à cette date, d'une nature comptée",
    definition: [
      "L'effectif à une date est le nombre de personnes ayant au moins un contrat en cours à cette date (début et fin inclus), parmi les natures de contrat choisies. Une personne avec plusieurs contrats compte une fois. Les contrats des autres natures sont affichés à part, dans « Hors effectif ».",
      "Valeur par défaut validée le 21/10/2026 : CDI et CDD. Un administrateur peut la modifier : les natures sont celles de la nomenclature DSN (codes de deux chiffres) ; le champ « Autres codes de nature » accepte d'autres codes, séparés par des virgules, et au moins une nature doit rester comptée.",
      "Les définitions « Natures de contrat comptées dans l'effectif » et « Effectif (personnes) à une date » précisent l'usage de ce réglage dans les écrans.",
    ].join("\n\n"),
  },
  {
    id: DONNEES_TERMS.historique,
    term: "Paramètre : historique PayFit, brut ou signalé",
    family: FAMILY,
    see: ["lower-bound"],
    definition: [
      `PayFit ne renvoie plus les contrats archivés depuis plus de ${RETENTION} mois. Pour les mois antérieurs à la date de lecture moins ${RETENTION} mois, les chiffres calculés sur ce que l'API renvoie ne comptent pas ces salariés : les effectifs, l'ETP et les sorties peuvent être sous-estimés ; les entrées, le turnover et l'absentéisme peuvent être faussés dans un sens ou dans l'autre (un contrat qui fait suite à un contrat non renvoyé compte comme une entrée, et les dénominateurs sont réduits).`,
      "Brut (défaut validé le 22/10/2026) : chiffres tels que l'API PayFit les renvoie, avec une mention unique en tête d'écran sur la limite de conservation.",
      "Signalé : les mois antérieurs à la limite sont affichés « ≥ » (effectifs, entrées) ou n.d. (sorties, turnover, absentéisme).",
      "La définition « Historique PayFit et borne basse » donne le détail de la règle.",
    ].join("\n\n"),
  },
  {
    id: DONNEES_TERMS.kpi,
    term: "Paramètres : définitions des KPI",
    family: FAMILY,
    see: ["kpi-parametres"],
    definition: [
      "Règles appliquées par Studio RH › KPI RH. Elles sont recalculées à chaque affichage, sans reconstruire le référentiel. Les natures comptées sont celles du réglage « Définition de l'effectif ».",
      "Chaque règle porte son origine (voir « Paramètres : origine d'un réglage et pastilles »). Aucun KPI n'est calculé avec une valeur illisible remplacée en silence : l'écran refuse de calculer et le dit. La définition « Paramètres en vigueur » (KPI RH) décrit leur usage dans les écrans.",
    ].join("\n\n"),
  },
  {
    id: DONNEES_TERMS.etp,
    term: "Paramètres : ETP contractuel",
    family: FAMILY,
    see: ["etp-contract"],
    definition: [
      "Quatre réglages fixent la quotité (ETP) d'un contrat ; voir la définition « Quotité (ETP) d'un contrat ».",
      "Temps plein : un contrat à temps plein vaut 1 ETP quelle que soit sa durée (39 h = 1 ; forfait jours à temps plein = 1). PayFit : indicateur « temps plein » ; DSN : modalité S21.G00.40.014 = 10.",
      "Plafond : un contrat ne vaut jamais plus de 1 ETP ; un rapport supérieur à 1 est ramené à 1 et signalé.",
      "Forfait jours (PayFit) : un contrat au forfait jours sans quotité ni indicateur « temps plein » renseignés vaut 1 ETP, signalé dans le détail. Un indicateur « temps plein » à non reste n.d.",
      "Décimales : la quotité de chaque contrat est arrondie à 2, 3 ou 4 décimales avant d'être additionnée.",
    ].join("\n\n"),
  },
  {
    id: DONNEES_TERMS.turnover,
    term: "Paramètres : formule du turnover et contrats continus",
    family: FAMILY,
    see: ["turnover"],
    definition: [
      "Formule : soit ((entrées + sorties) ÷ 2) ÷ effectif moyen de la période, soit sorties ÷ effectif (personnes) au premier jour de la période. La définition « Turnover » donne le calcul complet.",
      "Contrats continus neutralisés : un contrat qui se termine le jour J et un nouveau contrat de la même personne qui commence le jour J+1 (par exemple CDD puis CDI), les deux de natures comptées, ne produisent ni sortie ni entrée. Le détail (une sortie ne neutralise qu'une entrée, jour voisin connu dans tous les établissements) est dans « Turnover ».",
    ].join("\n\n"),
  },
  {
    id: DONNEES_TERMS.sortiesNonComptees,
    term: "Paramètre : sorties non comptées au turnover",
    family: FAMILY,
    definition:
      "Natures de contrat (code DSN) dont les sorties ne comptent pas au turnover. Le motif de fin de la DSN n'est pas utilisé : PayFit ne le fournit pas. Aucune nature cochée : toutes les sorties comptent.",
  },
  {
    id: DONNEES_TERMS.absenceTypes,
    term: "Paramètre : types d'absence comptés",
    family: FAMILY,
    see: ["kpi-types-absence", "absenteeism"],
    definition: [
      "Types d'absence PayFit dont les jours entrent dans l'absentéisme. Les types proposés sont ceux de la dernière lecture PayFit appliquée, avec leur nombre d'absences ; un type compté mais absent de la lecture est signalé « sans effet ». Un type sans libellé français est affiché tel que reçu de PayFit, avec son code.",
      "Type compté par défaut : maladie ordinaire (fr_maladie_ordinaire). Aucun type choisi : l'absentéisme est n.d. Aucune lecture PayFit appliquée : les types ne peuvent pas encore être choisis ; en DSN, les arrêts ne sont pas extraits.",
    ].join("\n\n"),
  },
  {
    id: DONNEES_TERMS.absenceStatuts,
    term: "Paramètre : statuts d'absence comptés",
    family: FAMILY,
    see: ["absenteeism"],
    definition:
      "Statuts PayFit qu'une absence doit porter pour être comptée (par défaut : approuvée). Une absence sans statut n'est jamais comptée : le taux d'absentéisme devient alors « ≥ x ».",
  },
  {
    id: DONNEES_TERMS.absenceBase,
    term: "Paramètre : base de comptage des jours d'absence",
    family: FAMILY,
    see: ["absenteeism"],
    definition:
      "Jours calendaires, ou jours du lundi au vendredi. La base s'applique aux jours théoriques (dénominateur) comme aux jours d'absence (numérateur). Aucun jour férié n'est connu de l'application, dans l'un comme dans l'autre mode.",
  },
  {
    id: DONNEES_TERMS.grille,
    term: "Paramètre : grille de comptes de la masse salariale",
    family: FAMILY,
    see: ["grille"],
    definition: [
      "Studio RH › Masse salariale lit le journal comptable de paie renvoyé par PayFit. Chaque compte est classé dans la rubrique dont un préfixe est le plus long. La masse salariale chargée est la somme des rubriques « brut » et « cotisations patronales ». Les comptes 63 et 64 sans rubrique sont signalés « non classés ».",
      "Valeur par défaut validée le 22/10/2026 : 641 brut (dont primes 6413, gratifications de stage 64137, indemnités et avantages 6414 et 6417), cotisations 645 et taxes 63 ; provisions 6412 et 6485 et autres charges 646 à 648 hors masse.",
      "Un administrateur modifie les préfixes de chaque rubrique : de 2 à 10 chiffres, séparés par des virgules, chacun dans une seule rubrique. Le rôle de chaque rubrique (brut, cotisations, hors masse) est fixe. Voir aussi la définition « Grille de comptes ».",
    ].join("\n\n"),
  },
  {
    id: DONNEES_TERMS.axeService,
    term: "Paramètre : axe analytique du service",
    family: FAMILY,
    see: ["service"],
    definition:
      "Axe analytique du journal PayFit qui porte le service. Par défaut, c'est le seul axe présent dans le journal ; avec plusieurs axes, aucun n'est retenu tant qu'un administrateur n'en a pas choisi un. « Aucun » désactive la ventilation par service. La définition « Service et coût par personne-mois » décrit l'usage de l'axe.",
  },
  {
    id: DONNEES_TERMS.prorata,
    term: "Paramètre : prorata des entrées et sorties en cours de mois",
    family: FAMILY,
    see: ["prorata"],
    definition: [
      "Studio RH › Hypothèses budgétaires projette chaque contrat mois par mois. La règle de prorata des entrées et sorties en cours de mois n'a pas de valeur par défaut : tant qu'elle n'est pas choisie, aucun scénario ne peut être créé. Elle est copiée dans chaque scénario à sa création ; la modifier ne change pas les scénarios existants.",
      "Jours calendaires : jours payés du mois ÷ nombre de jours du mois. Jours ouvrés : jours ouvrés payés ÷ jours ouvrés du mois (lundi à vendredi hors jours fériés légaux français, calculés pour toute année). Aucun prorata : un mois commencé ou terminé compte entier. La définition « Prorata d'entrée et de sortie » donne le détail.",
    ].join("\n\n"),
  },
  {
    id: DONNEES_TERMS.categories,
    term: "Paramètre : catégories de contrat et corrections",
    family: FAMILY,
    see: ["categories"],
    definition: [
      "La catégorie d'un contrat (CDI, CDD, apprenti, stagiaire) est proposée d'après son code de nature DSN. Valeur proposée : 01 CDI, 02 CDD, 29 convention de stage ; un administrateur peut la modifier (codes de deux chiffres, séparés par des virgules, pour chaque catégorie). Un contrat dont la nature n'est dans aucune catégorie est « non classé ». Quand aucun code n'est rattaché à « apprenti », l'écran le signale : PayFit code certains apprentis en CDD, qui sont alors à corriger contrat par contrat.",
      "Correction contrat par contrat : pour les cas que la nature ne distingue pas (une apprentie codée CDD, par exemple), un administrateur choisit la catégorie retenue d'un contrat en cours ; « Selon la nature » rétablit la catégorie proposée. Une correction est utilisée par les KPI RH et par les scénarios créés ensuite. Sont listés les contrats sans date de fin ou dont la fin n'est pas antérieure à la date de référence.",
      "La définition « Catégories CDI, CDD, apprenti, stagiaire » décrit l'usage des catégories dans la projection.",
    ].join("\n\n"),
  },

  // --- Membres et accès, Reporting social ---------------------------------------------------------------------------------
  {
    id: DONNEES_TERMS.profils,
    term: "Profils d'accès : administrateur, éditeur, lecteur",
    family: FAMILY,
    definition: [
      "Trois profils par espace ; chaque action est contrôlée côté serveur, quel que soit l'écran.",
      "Administrateur : gère l'espace, ses membres, les sources connectées et les règles de l'espace (Paramètres).",
      "Éditeur : lance les lectures des sources, dépose les fichiers et saisit les hypothèses.",
      "Lecteur : consulte les écrans de l'espace, sans rien modifier.",
      "Renommer l'espace est réservé aux administrateurs ; le nom est affiché dans le menu et en tête de chaque écran.",
    ].join("\n\n"),
  },
  {
    id: DONNEES_TERMS.invitation,
    term: "Invitation d'un membre",
    family: FAMILY,
    definition:
      "Aucun message n'est envoyé : le lien d'invitation est affiché, à copier et à transmettre à la personne. Il expire au bout de 7 jours. Seul un administrateur invite, change le profil d'un membre, retire un membre ou annule une invitation.",
  },
  {
    id: DONNEES_TERMS.journal,
    term: "Journal de l'espace",
    family: FAMILY,
    definition:
      "Les 30 derniers événements de l'espace, du plus récent au plus ancien, avec leur auteur : espace créé ou renommé, membres, sources connectées, synchronisations, paramètres modifiés, référentiel reconstruit, scénarios et hypothèses budgétaires. Réservé aux administrateurs. Un auteur qui a quitté l'espace est « ancien membre » ; un auteur non enregistré est « n.d. ».",
  },
  {
    id: DONNEES_TERMS.bdese,
    term: "BDESE : aperçu du catalogue de chapitres",
    family: FAMILY,
    definition: [
      "La base de données économiques, sociales et environnementales n'existe pas encore dans Clair. L'aperçu présente un catalogue de huit chapitres (00 à 07), listés par leur seul numéro et leur nom, et deux outils : la saisie de la BDESE et le gestionnaire de fichiers.",
      "Ni nombre d'indicateurs, ni contenu, ni obligation n'en sont déduits : la présence de ces cartes ne valide aucune obligation légale.",
      "L'intitulé du chapitre 07 est abrégé : son intitulé complet n'est pas lisible dans la source consultée ; il reste à confirmer d'après le texte officiel de la BDESE.",
    ].join("\n\n"),
  },
];
