import type { PrevuLink } from "@/components/Prevu";
import { CROISEE_TERMS as T } from "@/lib/glossary/croisee";
import type { ChapterId } from "@/lib/viz/croisee";

// Les dix chapitres de la Masse salariale croisée, dans l'ordre du sommaire. Navigation interne à la page (sommaire, onglets de
// chapitres, précédent / suivant) : ce ne sont pas des entrées du menu général.
// statut : cible de la première version (« prevu » : chapitre sans chiffre, avec la raison). filtres : la période, le service, le
// budget et le scénario s'appliquent (le tiroir de filtres est affiché et les sources sont lues). graphiques : le chapitre propose
// le choix d'affichage (tout, graphiques, tableaux).
export type ChapterLink = { path: string; title: string; text: string }; // path : relatif à /e/<slug>/
export type ChapterDef = {
  id: ChapterId;
  num: string; // « 01 »
  title: string;
  question: string; // une ligne
  description: string; // une ligne, dans le sommaire
  statut: "vivant" | "prevu";
  filtres: boolean;
  graphiques: boolean;
  terms: string[];
  liens: ChapterLink[]; // écrans existants qui couvrent déjà une partie du chapitre
};

// Raison commune des chapitres pas encore construits dans cette version (coquilles de la vague 0).
export const EN_CONSTRUCTION = "Chapitre en cours de construction.";

const MS = "studio-rh/masse-salariale";
const DEFS: Omit<ChapterDef, "num">[] = [
  {
    id: "synthese",
    title: "Synthèse",
    question: "Où en est la masse salariale face au budget, et où finit l'année ?",
    description: "Cartes clés, points à surveiller, masse par mois.",
    statut: "vivant",
    filtres: true,
    graphiques: true,
    terms: [T.alertes, T.ecartBudget, T.atterrissage, T.impression],
    liens: [
      { path: "studio-rh", title: "Synthèse du Studio RH", text: "Effectifs, masse chargée et atterrissage." },
      { path: MS, title: "Masse salariale › Synthèse", text: "Masse par mois, par service et par rubrique." },
    ],
  },
  {
    id: "effectifs",
    title: "Effectifs & mouvements",
    question: "Qui est présent, qui entre, qui sort ?",
    description: "Effectif, ETP, entrées et sorties, structure.",
    statut: "vivant",
    filtres: true,
    graphiques: true,
    terms: [T.etpProratise, T.structureEffectif, T.journalMouvements, T.echeancesContrat, T.seuilsEffectif],
    liens: [
      { path: "studio-rh/kpi?vue=effectifs", title: "KPI RH › Effectifs mensuels", text: "Effectif et ETP par mois et par axe." },
      { path: "studio-rh/collaborateurs/mouvements", title: "Collaborateurs › Mouvements", text: "Entrées et sorties datées." },
    ],
  },
  {
    id: "absences",
    title: "Absences & congés",
    question: "Où se concentrent les absences, et quels congés sont pris ?",
    description: "Absentéisme par mois et par motif, congés.",
    statut: "vivant",
    filtres: true,
    graphiques: true,
    terms: [T.congesPris, T.arrets, T.confidentialite],
    liens: [{ path: "studio-rh/kpi?vue=absenteisme", title: "KPI RH › Absentéisme", text: "Taux par mois et par motif." }],
  },
  {
    id: "fixe-variable",
    title: "Fixe & variable",
    question: "Quelle part de la rémunération est fixe, et quelles primes sont versées ?",
    description: "Fixe, variable, primes, éléments non récurrents.",
    statut: "vivant",
    filtres: true,
    graphiques: true,
    terms: [T.rigidite, T.nonRecurrents, T.calendrierPrimes],
    liens: [{ path: `${MS}?vue=fixe-variable`, title: "Masse salariale › Fixe & variable", text: "Fixe, variable, primes par libellé." }],
  },
  {
    id: "services",
    title: "Services",
    question: "Combien coûte chaque service, et quelle part de l'écart porte-t-il ?",
    description: "Coût et écart par service.",
    statut: "vivant",
    filtres: true,
    graphiques: true,
    terms: ["service", T.contributionServices],
    liens: [{ path: MS, title: "Masse salariale › Synthèse", text: "Tableau par service, N et N-1." }],
  },
  {
    id: "budget",
    title: "Budget & prévisions",
    question: "Du réalisé à l'atterrissage : où se situe l'année face au budget ?",
    description: "Écart au budget, atterrissage, personnes observées.",
    statut: "vivant",
    filtres: true,
    graphiques: true,
    terms: [T.ecartBudget, T.atterrissage, T.personnesObservees],
    liens: [
      { path: "studio-rh/hypotheses", title: "Hypothèses budgétaires", text: "Résultat › Comparaison et atterrissage." },
      { path: `${MS}/ecart`, title: "Masse salariale › Écart budgétaire", text: "Écart par rubrique entre versions." },
    ],
  },
  {
    id: "paie-compta",
    title: "Paie & comptabilité",
    question: "Le journal de paie concorde-t-il avec la comptabilité et les déclarations ?",
    description: "Journal, comptabilité, provision de congés payés.",
    statut: "vivant",
    filtres: true,
    graphiques: true,
    terms: [T.chargesPersonnel, T.decaissements, "provision", "rapprochement"],
    liens: [{ path: `${MS}?vue=paie-compta`, title: "Masse salariale › Paie & comptabilité", text: "Rapprochement, provision de congés payés." }],
  },
  {
    id: "effets",
    title: "Effets d'évolution",
    question: "D'où vient l'écart de masse entre les deux années ?",
    description: "Volume et coût moyen, effets des augmentations.",
    statut: "vivant",
    filtres: true,
    graphiques: true,
    terms: ["pont-volume-cout", T.effetsMasseNiveauReport, T.tuilage],
    liens: [{ path: `${MS}/analyse`, title: "Masse salariale › Analyse des écarts", text: "Cascade d'ETP, pont volume / coût moyen." }],
  },
  {
    id: "restructuration",
    title: "Restructuration",
    question: "Quels coûts et quel retour pour un projet de restructuration ?",
    description: "Coûts et retour d'un projet.",
    statut: "prevu",
    filtres: false,
    graphiques: false,
    terms: [T.prevu],
    liens: [{ path: "studio-rh/hypotheses", title: "Hypothèses budgétaires", text: "Départs, coûts de sortie et économies par scénario." }],
  },
  {
    id: "juridique",
    title: "Bibliothèque juridique",
    question: "Où retrouver les textes et conventions de référence ?",
    description: "Textes et conventions de référence.",
    statut: "prevu",
    filtres: false,
    graphiques: false,
    terms: [T.prevu],
    liens: [{ path: "glossaire", title: "Glossaire", text: "Définitions des indicateurs de Clair." }],
  },
];

export const CHAPTERS: ChapterDef[] = DEFS.map((d, i) => ({ ...d, num: String(i + 1).padStart(2, "0") }));
export const CHAPTER_TOTAL = String(CHAPTERS.length).padStart(2, "0");

// Les identifiants de la liste et ceux du contrat d'adresse (src/lib/viz/croisee.ts) sont les mêmes, dans le même ordre (test).
export const chapterDef = (id: ChapterId): ChapterDef => CHAPTERS.find((c) => c.id === id) ?? CHAPTERS[0];

export function neighbours(id: ChapterId): { prev: ChapterDef | null; next: ChapterDef | null } {
  const i = CHAPTERS.findIndex((c) => c.id === id);
  return { prev: i > 0 ? CHAPTERS[i - 1] : null, next: i >= 0 && i < CHAPTERS.length - 1 ? CHAPTERS[i + 1] : null };
}

// Liens « Ce qui existe déjà » d'un chapitre, en adresses de l'espace.
export const chapterLinks = (slug: string, c: ChapterDef): PrevuLink[] => c.liens.map((l) => ({ href: `/e/${slug}/${l.path}`, title: l.title, text: l.text }));
