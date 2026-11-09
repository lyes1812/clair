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
// données lues »), ce qui existe déjà et ce qui reste à préciser, en quelques mots (gabarit commun de Prevu).
export default async function MsPrevuPage({ params }: { params: Promise<{ slug: string; vue: string }> }) {
  const { slug, vue } = await params;
  // Seules les entrées encore « Prévu » ont leur page ici (« Masse salariale croisée » a sa propre page, croisee/).
  const tab = MS_PREVU.filter((t) => t.soon).find((t) => t.key === vue);
  if (!tab) notFound();
  await requireWorkspace(slug);
  const ms = `/e/${slug}/studio-rh/masse-salariale`;
  const content: Record<string, Content> = {
    organisation: {
      lead: "Non réalisé : la masse salariale par organisation (direction, établissement, société) n'existe pas encore dans Clair.",
      existing: [
        { href: ms, title: "Synthèse", text: "Répartition par service." },
        { href: `/e/${slug}/studio-rh/kpi?vue=effectifs`, title: "KPI RH › Effectifs mensuels", text: "Masse par catégorie, contrat, établissement et statut." },
      ],
      open: ["Direction et société ne figurent pas dans les données lues : l'axe d'organisation reste à définir."],
    },
    reel: {
      lead: "Non disponible avec les données lues : l'API PayFit ne renvoie pas de rubrique de bulletin, donc l'écart de réel par rubrique n'est pas calculable.",
      existing: [
        { href: `${ms}/ecart`, title: "Écart budgétaire", text: "Écart du réel d'une année à l'autre (deux versions « Réel PayFit »)." },
        { href: `${ms}/analyse`, title: "Analyse des écarts", text: "Cascade d'ETP, contributions, pont volume / coût moyen." },
      ],
      open: ["Niveau de détail de l'écart de réel à définir."],
    },
  };
  // Titre de la page : l'abréviation « MS » de l'onglet est écrite en toutes lettres.
  const title = tab.key === "organisation" ? "Masse salariale par organisation" : tab.label;
  return (
    <>
      <MsHeader title={ITEM.label} />
      <MsTabs slug={slug} current={tab.key as MsTab} />
      <Prevu title={title} {...content[tab.key]} />
    </>
  );
}
