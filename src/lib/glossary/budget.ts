import { BUDGET_DEFINITIONS } from "@/lib/budget/definitions";
import type { GlossaryEntry } from "./types";

// Identifiants du glossaire vers lesquels renvoient les écrans de saisie et de contrôle des hypothèses budgétaires (un test vérifie que
// chacun existe). Les entrées sans préfixe sont les définitions du moteur de projection ; celles en « hs- » ont été écrites pour la saisie.
export const BUDGET_TERMS = {
  base: "base",
  baseContrat: "base-contrat",
  augmentation: "augmentation",
  prorata: "prorata",
  absence: "absence",
  categories: "categories",
  contribution: "contribution",
  entrant: "entrant",
  embauchePostes: "embauche-postes",
  saisieMasse: "saisie-masse",
  globales: "globales",
  enveloppe: "enveloppe",
  changement: "changement",
  controles: "controles",
  recopie: "recopie",
  budgetSaisi: "budget-saisi",
  derivee: "derivee",
  scenario: "hs-scenario",
  scenarioStatut: "hs-scenario-statut",
  postes: "hs-modifications-postes",
  evenement: "hs-evenement",
  saisieMontant: "hs-saisie-montant",
  bases: "hs-bases-individuelles",
  ponctuels: "hs-ponctuels",
  priorites: "hs-priorite-augmentations",
  constantes: "hs-constantes",
  grilles: "hs-grilles",
  controleBase: "hs-controle-base",
  controlesEffectifs: "hs-controles-effectifs",
  controlesChangements: "hs-controles-changements",
} as const;

const FAMILY = "Hypothèses budgétaires" as const;

// Formules d'une ligne, ajoutées aux définitions du moteur (sans en changer le texte).
const FORMULAS: Record<string, string> = {
  "base-contrat": "charges du contrat = salaire de référence × (cotisations ÷ brut total de ses lignes)",
  augmentation: "salaire après = salaire avant × (1 + taux)",
  prorata: "jours calendaires : jours payés ÷ jours du mois ; jours ouvrés : jours ouvrés payés ÷ jours ouvrés du mois",
  entrant: "base du contrat = salaire du mois de référence ÷ part de présence",
  changement: "salaire après = salaire × nouvelle quotité ÷ quotité de la base",
  controles: "effectif de fin = effectif de début + entrées − sorties",
  atterrissage: "atterrissage = réel figé + mois projetés des scénarios parents + mois projetés du scénario",
  retraite: "atterrissage retraité = atterrissage − éléments non récurrents",
  pont: "écart = effet volume + effet coût moyen",
};

// Paragraphes ajoutés à une définition du moteur : ce que les écrans de saisie expliquaient sous leurs titres, leurs champs et leurs tableaux.
const MORE: Record<string, string> = {
  base:
    "Le coût mensuel de la base additionne, pour chaque contrat présent à la fin du mois de référence, son coût de référence (salaire et gratifications de stage, plus charges au taux observé du contrat). Il est n.d. dès qu'une base de contrat est n.d. La masse salariale réelle du mois de référence peut être plus élevée : l'écart « hors base » regroupe les primes, les indemnités, les contrats sortis dans le mois et les lignes sans contrat. Quand la base est dérivée d'un autre scénario, le coût que ce scénario projetait pour le mois de référence est comparé à la base : « égal à la base dérivée », ou la liste de ce qui n'est pas repris (éléments ponctuels du dernier mois, par exemple) ; cet écart est n.d. si la base de l'un des contrats l'est.",
  absence:
    "Saisie : libellé, période (du… au…, bornes incluses) et part du salaire payée en pourcentage. 100 % maintient le salaire en entier, 0 % supprime tout salaire, une valeur intermédiaire est un maintien partiel. Un congé se crée sur la fiche d'un contrat de la base.",
  "embauche-postes":
    "Le profil de départ est facultatif : il reprend le service, la catégorie, le brut, la quotité, les charges et le compte dans l'effectif d'un salarié ou d'une embauche ; chaque valeur reste modifiable et une valeur indisponible reste à saisir. Saisie : l'intitulé du poste est repris dans les contrôles et la projection ; le nombre de postes va de 1 à 50 (autant d'embauches indépendantes, numérotées) ; le centre de coûts est un service existant ou nouveau, et vide il laisse le poste non ventilé ; le dernier jour payé d'un CDD est facultatif, vide il signifie un poste sans fin prévue ; le brut mensuel est celui d'un temps plein et la quotité (entre 0 et 100 %) s'applique ensuite ; « Remplace » désigne un seul départ saisi dans ce scénario, sinon l'embauche est une création de poste ; un poste non compté (un stagiaire, par exemple) n'entre pas dans l'effectif. Le prorata du premier et du dernier mois suit la règle du scénario (voir « Prorata d'entrée et de sortie »).",
  "saisie-masse":
    "Départs : les coûts de sortie se saisissent en coût chargé, imputés au mois du départ (facultatif) ; pour les saisir en brut et taux de charges, utiliser la fiche du salarié. Augmentations : un mois d'effet commun à toutes les lignes, compris entre le premier et le dernier mois du scénario. Les salariés qui ont déjà un départ saisi ne sont plus proposés dans la liste des départs.",
  globales:
    "Le périmètre « Toute l'entreprise » exclut les embauches et les entrées après la base. Les augmentations ciblées sur un contrat ou une embauche ne sont pas dans la grille : elles sont listées sous le tableau et se saisissent dans Modifications de postes. Une ligne par statut n'apparaît que si le statut est renseigné pour au moins un contrat ; sinon la raison est écrite sous la grille : statut absent de la base d'un scénario créé avant sa conservation, champ non renseigné pour tous les contrats, ou contrats sans statut qui ne reçoivent aucune augmentation par statut. La priorité entre périmètres d'un même mois est détaillée dans « Augmentations : priorité entre périmètres ». Pour la saisie dans la grille, voir « Grilles de saisie mensuelles ».",
  enveloppe:
    "Saisie : une ligne par centre de coûts ou par rubrique, choisi dans la liste proposée ou saisi librement ; « Coût chargé » ou « Brut + charges » (avec le taux de charges de la ligne) ; une ligne se retire en cochant « Supprimer ». Les montants de la grille sont des euros par mois, chargés ou bruts selon le mode de saisie de la ligne. Pour la saisie dans la grille, voir « Grilles de saisie mensuelles ».",
  changement:
    "Saisie : libellé, mois d'effet (entre le premier et le dernier mois du scénario), nouveau service (existant ou nouveau), nouvelle quotité (entre 0 et 100 %) et poste (descriptif, sans effet sur le calcul). Renseigner le service, la quotité, ou les deux. Le changement se crée sur la fiche d'un salarié.",
  recopie:
    "Le scénario source se choisit parmi les autres scénarios de l'espace, figés ou brouillons ; la reprise est réservée aux éditeurs et aux administrateurs et ne s'applique qu'à un brouillon.",
  "budget-saisi":
    "Les budgets saisis servent de référence aux comparaisons des scénarios. Un budget se saisit par année : un nom, l'année et douze montants chargés, un par mois, en euros. Il se modifie depuis sa ligne de la liste et se supprime définitivement. Son total annuel est n.d. tant que l'un des douze mois n'est pas saisi, et la liste dit combien de mois manquent.",
  derivee:
    "Le simulateur N+1 n'est proposé qu'à partir d'un scénario figé. Le scénario dérivé reçoit un nom, un type et un dernier mois projeté (24 mois au plus, à partir du mois qui suit l'horizon du scénario source) ; sa projection commence le mois suivant le dernier mois du scénario source. Ce qui n'est pas repris est listé dans la base du nouveau scénario, à ressaisir si besoin.",
};

// Correction d'un fragment de définition du moteur (lecture seule) : la liste des types repris est celle de l'écran, en onze types.
export const TEXT_FIXES: Record<string, [from: string, to: string]> = {
  recopie: [
    "(départs, embauches, augmentations, congés, catégories, corrections de base, éléments ponctuels, non récurrents réalisés)",
    "(départs, embauches, augmentations, congés non payés, catégories, changements de service ou de quotité, corrections de base, éléments ponctuels, enveloppes, constantes de référence, non récurrents réalisés)",
  ],
};
export const engineText = (id: string, text: string): string => {
  const fix = TEXT_FIXES[id];
  return fix ? text.replace(fix[0], fix[1]) : text;
};

// Définitions du moteur, avec formule et paragraphes complémentaires.
const FROM_CODE: GlossaryEntry[] = BUDGET_DEFINITIONS.map((d) => ({
  id: d.id,
  term: d.title,
  family: FAMILY,
  definition: MORE[d.id] ? `${engineText(d.id, d.text)}\n\n${MORE[d.id]}` : engineText(d.id, d.text),
  ...(FORMULAS[d.id] ? { formula: FORMULAS[d.id] } : {}),
}));

// Entrées écrites pour les écrans de saisie et de contrôle : texte déplacé des titres de carte, des aides de champ et des blocs de règles.
const SAISIE: GlossaryEntry[] = [
  {
    id: "hs-scenario",
    term: "Scénario, type et horizon",
    family: FAMILY,
    definition: [
      "Un scénario est un jeu d'hypothèses datées appliqué à une base figée, sur un horizon de projection de 24 mois au plus. À la création, la base est figée sur le mois qui précède le premier mois projeté : le premier mois projeté suit un mois de paie clos de la lecture PayFit appliquée, le dernier mois est libre dans la limite de l'horizon.",
      "La règle de prorata est celle de Paramètres › Projection au moment de la création ; elle est copiée dans le scénario. Sans cette règle, Clair refuse de créer un scénario. Sans journal de paie PayFit lu, sans référentiel Collaborateurs ou sans mois de paie clos, la base ne peut pas être figée : l'écran l'indique avec sa raison.",
      "Le nom compte 120 caractères au plus. Le type (budget, révisé, simulation) sert à retrouver le scénario dans les listes ; il est sans effet sur le calcul. Les entrées du menu Hypothèses budgétaires ouvrent le brouillon le plus récent et, à défaut, le scénario le plus récent ; sans scénario, l'écran propose d'en créer un. Le bouton « Changer de scénario » permet de passer à un autre scénario sans quitter l'entrée en cours.",
    ].join("\n\n"),
  },
  {
    id: "hs-scenario-statut",
    term: "Brouillon et figé",
    family: FAMILY,
    definition: [
      "Un brouillon est modifiable : les saisies s'enregistrent à l'envoi de chaque formulaire et se retrouvent aussitôt dans la projection et dans les contrôles. Seuls les éditeurs et les administrateurs peuvent modifier ; pour un lecteur, un brouillon est en lecture seule.",
      "Figer un scénario verrouille ses hypothèses : plus aucune modification n'est possible. Un scénario figé se duplique en un brouillon indépendant portant les mêmes hypothèses (pour tester une variante) et peut servir de base au budget suivant (simulateur N+1, voir « Base dérivée »).",
      "La suppression d'un brouillon est définitive : elle emporte ses hypothèses. Un scénario figé ne se supprime pas.",
    ].join("\n\n"),
  },
  {
    id: "hs-modifications-postes",
    term: "Modifications de postes : lecture du tableau",
    family: FAMILY,
    definition: [
      "Une ligne par contrat de la base figée et par embauche saisie. La recherche porte sur toutes les colonnes (nom, service, motif, dates…) ; le filtre par service propose aussi « Non ventilé ». Le nom ouvre la fiche du salarié, où se créent ses événements.",
      "Catégorie : proposée depuis la nature du contrat (Paramètres › Projection), corrigée ici si besoin (par exemple une apprentie codée CDD par PayFit) ; une catégorie corrigée est marquée « hypothèse ». Fin connue : fin de contrat lue dans PayFit, ou dernier jour payé d'une embauche à durée déterminée. ETP et coût mensuel de base : ceux de la base figée ; n.d. avec leur raison au survol quand la source ne les donne pas, jamais zéro. Le coût mensuel de base est le salaire de base augmenté des charges au taux observé du contrat.",
      "Les colonnes « hypothèse », sur fond bleu, montrent ce que ce scénario saisit pour le salarié : départ (dernier jour payé et motif), augmentations saisies sur ce contrat seul (celles d'un service ou de toute l'entreprise sont dans Hypothèses globales), changements de service, de quotité ou de poste. « — » : aucune hypothèse, la projection reconduit la base du salarié. « Événements » compte les hypothèses du salarié.",
      "Un taux d'augmentation s'écrit en rouge quand il augmente le coût et en vert quand il le diminue (convention « Tendances financières »), toujours avec son signe : la couleur n'est jamais seule.",
      "Règles apparentées : augmentation, congé non payé, changement de service ou de quotité, prorata d'entrée et de sortie, catégories.",
    ].join("\n\n"),
  },
  {
    id: "hs-evenement",
    term: "Événement d'un salarié",
    family: FAMILY,
    definition: [
      "Un événement est une hypothèse datée qui concerne un seul salarié (contrat de la base ou embauche) : augmentation de salaire, départ, congé non payé ou partiellement payé, base du salarié, prime ou élément ponctuel, changement de service ou de quotité, catégorie. Chaque événement est enregistré directement dans le brouillon ; il apparaît ensuite dans la projection et dans les contrôles des changements, et se supprime depuis la fiche.",
      "Augmentation : effet au 1er du mois choisi, en pourcentage du salaire déjà augmenté (2,5 pour +2,5 %) ; un taux nul est refusé. Départ : dernier jour rémunéré (inclus) et motif facultatif, au choix parmi des suggestions ou en saisie libre ; les coûts de sortie sont facultatifs et imputés au mois du départ, en brut et taux de charges ou en coût chargé (« Aucun » : pas de coût de sortie). Congé : période et part du salaire payée (voir « Congé non payé »). Base du salarié : proposée seulement quand la base est n.d. ; la projection est n.d. pour ce contrat tant qu'elle n'est pas saisie. Élément ponctuel : voir « Éléments ponctuels et non récurrents réalisés ». Changement : voir « Changement de service ou de quotité ». Catégorie : correction de la catégorie proposée depuis la nature du contrat.",
      "Départ, congé non payé et base du salarié ne se créent que pour un contrat de la base, pas pour une embauche prévisionnelle.",
      "Coût mensuel projeté : la fiche détaille, mois par mois, les contributions de la projection rattachées au salarié. Un mois n.d. est écrit avec sa raison ; si la projection est refusée, la fiche donne la raison du refus.",
    ].join("\n\n"),
  },
  {
    id: "hs-saisie-montant",
    term: "Saisie d'un montant : brut et taux, ou coût chargé",
    family: FAMILY,
    definition:
      "Un montant se saisit de deux façons. « Brut + taux de charges » : le brut et le taux de charges sont renseignés et les charges valent brut × taux (le taux s'écrit en pourcentage, par exemple 42,5). « Coût chargé (non ventilé) » : le montant est pris tel quel, sans ventilation entre brut et charges ; brut et charges du mois restent alors n.d. dans la projection, le coût employeur restant exact. Seuls les champs du mode choisi sont lus. Pour des coûts de sortie, « Aucun » signifie qu'il n'y en a pas.",
    formula: "charges = brut × taux de charges",
  },
  {
    id: "hs-bases-individuelles",
    term: "Bases individuelles et corrections de base",
    family: FAMILY,
    definition: [
      "Une ligne par contrat de la base figée : service, statut (cadre dirigeant ou non, d'après le référentiel Collaborateurs), dates, ETP, salaire de référence, taux de charges observé et coût mensuel, tels que figés à la création du scénario. La colonne « État » dit si la base est figée, corrigée par une hypothèse, ou n.d. avec sa raison.",
      "La correction d'une base se saisit à droite du tableau : le salaire mensuel de base et le taux de charges vont ensemble, 0 € étant possible pour un contrat non payé. Les deux champs vides : pas de correction, et une correction existante est retirée. Un contrat sans base reste n.d. dans la projection tant qu'une correction n'est pas saisie ; l'écran compte ces contrats.",
      "Une base dérivée d'un autre scénario affiche son origine (scénario source et mois) et ce qui n'a pas été repris, à ressaisir si besoin ; voir « Base dérivée (simulateur N+1) ». Les limites de la source (ETP non historisés, service non ventilé et sa raison) sont écrites sous le tableau.",
    ].join("\n\n"),
  },
  {
    id: "hs-ponctuels",
    term: "Éléments ponctuels et non récurrents réalisés",
    family: FAMILY,
    definition: [
      "Un élément ponctuel est un montant ajouté à la projection à un mois précis du scénario (prime, régularisation…), pour un centre de coûts (existant ou nouveau) ou, si le centre de coûts est vide, pour toute l'entreprise. Il se saisit en brut + taux ou en coût chargé, et peut être marqué non récurrent : il est alors retiré de l'atterrissage retraité.",
      "Un non récurrent réalisé est un élément déjà passé en comptabilité (rupture, solde de congés…) : le journal PayFit ne le distingue pas, il est dans le brut. Il se saisit avec une catégorie libre (par exemple rupture ou solde de congés), son mois (au plus le mois de la base) et son montant chargé, positif ou nul. Il sert uniquement à l'atterrissage retraité et ne change pas la projection.",
    ].join("\n\n"),
  },
  {
    id: "hs-priorite-augmentations",
    term: "Augmentations : priorité entre périmètres",
    family: FAMILY,
    definition: [
      "Sur un même mois, pour un même salarié, une seule augmentation s'applique : la plus ciblée. L'augmentation d'un contrat prime sur celle d'un service ou d'un statut (cadres dirigeants, hors cadres dirigeants), qui prime sur celle de toute l'entreprise. Un service et un statut sont au même niveau : deux augmentations de ces niveaux le même mois pour un même salarié sont refusées avec leur raison, tout comme deux augmentations de même niveau le même mois.",
      "L'augmentation d'un contrat se saisit dans Modifications de postes ; celles d'un service, d'un statut ou de toute l'entreprise, dans la grille des Hypothèses globales. Les taux de mois différents se composent : chacun s'applique au salaire déjà augmenté. Les embauches et les contrats entrés après le mois de référence ne reçoivent que les augmentations qui les visent directement.",
    ].join("\n\n"),
  },
  {
    id: "hs-constantes",
    term: "Constantes de référence",
    family: FAMILY,
    definition: [
      "Valeurs saisies par mois, dans l'unité de la ligne (euros, pourcentage ou nombre), avec leur source : taux légaux, plafonds, horaire théorique, taux de change… Clair ne fournit aucune valeur : chaque constante doit porter sa source, sans quoi la saisie est refusée. Les constantes sont conservées avec le scénario et rappelées dans les contrôles des changements, mais aucune règle de calcul ne les lit : la masse salariale ne change pas. Une ligne se retire en cochant « Supprimer ».",
      "Limites : multidevise différé (euros seulement) ; taux par statut cadre / non-cadre de la classification : PayFit ne fournit à Clair que l'indicateur « cadre dirigeant » (disponible dans la grille des taux d'augmentation), le statut cadre / non-cadre demande une autre source ; taux par société : un espace ne compte qu'une société.",
    ].join("\n\n"),
  },
  {
    id: "hs-grilles",
    term: "Grilles de saisie mensuelles : outils",
    family: FAMILY,
    definition: [
      "Les grilles (taux d'augmentation, constantes, enveloppes, corrections de base) se remplissent comme un tableur. Rien n'est enregistré avant « Enregistrer » ; le compteur dit combien de cellules sont modifiées et signale les valeurs illisibles (cellule modifiée : fond bleu et barre à gauche ; valeur illisible : rouge). « Réinitialiser » annule toute saisie non enregistrée, report compris. Clair ne propose aucune valeur : une cellule vide reste vide. Un nombre s'écrit à la française : 2,5 ou 1 200,00.",
      "Outils : « Copier vers la droite » et « Copier vers le bas » recopient la valeur de la cellule active sur les cellules suivantes de sa ligne ou de sa colonne ; « Remplir la ligne » écrit la valeur saisie sur toute la ligne de la cellule active ; « Reporter → » (à droite de chaque ligne) reporte la première valeur renseignée de la ligne sur les mois suivants. Il faut d'abord cliquer dans une cellule : elle sert de point de départ. « Télécharger (CSV) » exporte la grille en fichier, tous les mois compris.",
      "Quand la grille couvre deux années, une seule est affichée à la fois (onglets d'année, avec le nombre de cellules renseignées) ; les outils ne s'appliquent qu'à l'année affichée et l'autre année est enregistrée avec le reste.",
      "Clavier : Entrée ou flèche bas passent à la cellule du dessous, Maj+Entrée ou flèche haut à celle du dessus (Entrée n'envoie donc pas la grille).",
    ].join("\n\n"),
  },
  {
    id: "hs-controle-base",
    term: "Contrôle de la base",
    family: FAMILY,
    definition:
      "Compare l'effectif compté de la base figée au réel du mois de référence (effectif de fin de mois de la paie lue). « Conforme » : les deux nombres sont égaux. « Écart de n » : les contrats comptés de la base sont plus nombreux (+) ou moins nombreux (−) que l'effectif réel ; l'écart vient d'un contrat présent à la date de lecture mais pas à la fin du mois de référence (ou l'inverse), ou d'une nature de contrat non comptée dans l'effectif (Paramètres › KPI). Sans effectif réel du mois de référence, le contrôle est n.d. avec sa raison. L'écart est rouge parce qu'il signale une anomalie, non une tendance de coût.",
  },
  {
    id: "hs-controles-effectifs",
    term: "Contrôles effectifs : lecture du tableau",
    family: FAMILY,
    formula: "effectif de fin = effectif de début + entrées − sorties",
    definition: [
      "À chaque mois projeté : effectif de début + entrées − sorties = effectif de fin, le premier mois partant de l'effectif de la base. Les entrées et les sorties sont les salariés comptés présents le dernier jour du mois et non présents le mois précédent, ou l'inverse ; la liste « Qui entre, qui sort » les nomme. Le contrôle est « Conforme : égalité vérifiée » quand l'égalité tient et que l'effectif de fin est celui de la projection ; sinon, « Écart ».",
      "Compté présent en fin de mois : contrat dont la nature est comptée dans l'effectif (ou embauche déclarée « comptée »), commencé et non terminé le dernier jour du mois. Un salarié en congé non payé reste dans l'effectif. Un contrat dont l'ETP est n.d. rend l'ETP du mois n.d. ; un mois n.d. est écrit avec sa raison.",
      "L'effectif, l'ETP, les entrées et les sorties ne sont jamais écrits en rouge ou en vert : ce ne sont pas des montants.",
    ].join("\n\n"),
  },
  {
    id: "hs-controles-changements",
    term: "Contrôles des changements : coût attribué",
    family: FAMILY,
    definition: [
      "Liste de toutes les hypothèses du scénario, avec le coût que la projection leur attribue sur l'horizon : la somme, sur les mois projetés, des lignes de la projection rattachées à l'hypothèse (pour un départ : la réduction de paie et les coûts de sortie ; pour une enveloppe ou un élément ponctuel : leur montant). Les éléments « réalisés » et les constantes n'entrent pas dans la projection : leur coût attribué est « — ». Sans hypothèse, la projection reconduit la base figée avec les fins de contrat connues.",
      "Les mois projetés n.d. ne sont pas comptés dans la colonne « Coût attribué sur l'horizon » ; leur nombre est indiqué au-dessus du tableau. Une projection refusée n'attribue aucun coût : la colonne est n.d. et les raisons du refus sont listées.",
      "Le coût attribué s'écrit en rouge quand l'hypothèse ajoute du coût, en vert quand elle en retire (convention « Tendances financières »), avec son signe (+ ou −) et une flèche : la couleur n'est jamais seule. La correction d'une base fait exception : son coût attribué est celui du contrat qu'elle porte, non un écart, et n'est pas coloré. La recherche porte sur le type, le libellé et le détail ; le filtre par type n'apparaît qu'au-delà d'une douzaine d'hypothèses. Supprimer une hypothèse la retire de la projection.",
    ].join("\n\n"),
  },
];

// Famille « Hypothèses budgétaires » (saisie et contrôles) : définitions du moteur, puis entrées de saisie. L'ordre final est fixé par l'index.
export const GLOSSARY_BUDGET: GlossaryEntry[] = [...FROM_CODE, ...SAISIE];
