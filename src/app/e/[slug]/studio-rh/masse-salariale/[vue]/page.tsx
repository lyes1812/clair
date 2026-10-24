import "@/styles/ecart.css";
import { notFound } from "next/navigation";
import { Prevu, type PrevuLink } from "@/components/Prevu";
import { STUDIO_RH_ITEMS } from "@/lib/nav";
import { requireWorkspace } from "@/lib/workspace";
import { MS_PREVU, MsHeader, MsTabs, type MsTab } from "../EcartParts";

export const dynamic = "force-dynamic";
const ITEM = STUDIO_RH_ITEMS.find((i) => i.path === "studio-rh/masse-salariale")!;

type Content = { lead: React.ReactNode; existing: PrevuLink[]; open: string[] };

// Entrées de la famille Masse salariale pas encore construites : une phrase d'état (« Non réalisé » ou « Non disponible avec les
// données lues »), ce qui existe déjà et ce qui reste à préciser.
export default async function MsPrevuPage({ params }: { params: Promise<{ slug: string; vue: string }> }) {
  const { slug, vue } = await params;
  const tab = MS_PREVU.find((t) => t.key === vue);
  if (!tab) notFound();
  await requireWorkspace(slug);
  const ms = `/e/${slug}/studio-rh/masse-salariale`;
  const hyp = `/e/${slug}/studio-rh/hypotheses`;
  const content: Record<string, Content> = {
    croisee: {
      lead: "Non réalisé : le rapport de synthèse croisé en plusieurs chapitres n'existe pas encore dans Clair.",
      existing: [
        { href: ms, title: "Synthèse", text: "Masse salariale par mois, par service et par rubrique." },
        { href: `${ms}?vue=fixe-variable`, title: "Fixe & variable", text: "Part fixe et part variable, brut par libellé de paie, primes par famille et par mois." },
        { href: `${ms}?vue=paie-compta`, title: "Paie & comptabilité", text: "Congés payés dus, rapprochement avec la comptabilité (comptes 63 et 64)." },
      ],
      open: ["Les chapitres à croiser et leurs filtres restent à définir avant toute réalisation."],
    },
    organisation: {
      lead: "Non réalisé : la masse salariale par organisation (direction, établissement, société) n'existe pas encore dans Clair.",
      existing: [
        { href: ms, title: "Synthèse", text: "Répartition par service (code analytique du journal de paie)." },
        { href: `/e/${slug}/studio-rh/kpi?vue=effectifs`, title: "KPI RH › Effectifs mensuels", text: "Masse par catégorie, nature de contrat, établissement et statut." },
      ],
      open: ["Direction et société ne figurent pas dans les données lues (une seule société par espace) : l'axe d'organisation à retenir reste à définir."],
    },
    reel: {
      lead: "Non disponible avec les données lues : l'écart entre deux périodes de réel, par rubrique de bulletin, ne peut pas être calculé, car l'API PayFit ne renvoie pas de rubrique de bulletin.",
      existing: [
        { href: `${ms}/ecart`, title: "Écart budgétaire", text: "Choisir deux versions « Réel PayFit » pour lire l'écart du réel d'une année à l'autre." },
        { href: `${ms}/analyse`, title: "Analyse des écarts", text: "Décomposition de cet écart (cascade d'ETP, contributions par rubrique, pont volume / coût moyen)." },
      ],
      open: ["Le niveau de détail à proposer pour l'écart réel, tant que les données lues ne contiennent pas de rubrique de bulletin."],
    },
    suivi: {
      lead: "Non réalisé : un suivi mensuel du réel face au budget, indépendant d'un scénario, n'existe pas encore ; la comparaison est disponible aujourd'hui dans un scénario.",
      existing: [
        { href: hyp, title: "Hypothèses budgétaires", text: "Dans un scénario : Résultat › Comparaison, mois par mois, avec le budget saisi, le réel courant et N-1." },
        { href: `${ms}/ecart`, title: "Écart budgétaire", text: "Tableau par rubrique entre versions (réel, scénario, budget saisi)." },
      ],
      open: ["Le budget de référence et le mois de clôture d'un suivi autonome, hors scénario, restent à préciser."],
    },
  };
  // Titre de la page : l'abréviation « MS » de l'onglet est écrite en toutes lettres.
  const title = tab.key === "organisation" ? "Masse salariale par organisation" : tab.label;
  return (
    <>
      <MsHeader title={ITEM.label} summary={ITEM.summary} />
      <MsTabs slug={slug} current={tab.key as MsTab} />
      <Prevu title={title} {...content[tab.key]} />
    </>
  );
}
