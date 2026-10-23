import { notFound } from "next/navigation";
import { Prevu } from "@/components/Prevu";
import { STUDIO_RH_ITEMS } from "@/lib/nav";
import { requireWorkspace } from "@/lib/workspace";
import { MS_PREVU, MsHeader, MsTabs, type MsTab } from "../EcartParts";

export const dynamic = "force-dynamic";
const ITEM = STUDIO_RH_ITEMS.find((i) => i.path === "studio-rh/masse-salariale")!;

// Entrées du cahier de la famille Masse salariale dont le comportement n'est pas établi : on le dit, avec ce qui existe déjà
// et ce qui reste à préciser, sans simuler.
export default async function MsPrevuPage({ params }: { params: Promise<{ slug: string; vue: string }> }) {
  const { slug, vue } = await params;
  const tab = MS_PREVU.find((t) => t.key === vue);
  if (!tab) notFound();
  await requireWorkspace(slug);
  const ms = `/e/${slug}/studio-rh/masse-salariale`;
  const hyp = `/e/${slug}/studio-rh/hypotheses`;
  const text: Record<string, React.ReactNode> = {
    croisee: <p>Rapport de synthèse croisé en plusieurs chapitres : non réalisé. La lecture de la masse salariale par mois, par service et par rubrique existe dans <a href={ms}>Synthèse</a>, <a href={`${ms}?vue=fixe-variable`}>Fixe & variable</a> et <a href={`${ms}?vue=paie-compta`}>Paie & comptabilité</a>. Les chapitres à croiser et leurs filtres restent à préciser avec toi avant toute réalisation ; rien n'est simulé ici.</p>,
    organisation: <p>Masse salariale par organisation (direction, établissement, société) : non réalisée. La répartition par service (code analytique du journal de paie) existe dans <a href={ms}>Synthèse</a> ; la masse par catégorie, nature de contrat, établissement et statut se lit dans <a href={`/e/${slug}/studio-rh/kpi?vue=effectifs`}>KPI RH › Effectifs mensuels</a>. Direction et société ne sont pas dans les données lues (une seule société par espace).</p>,
    reel: <p>Écart entre deux périodes de réel : l'écart du réel d'une année à une autre se lit dans <a href={`${ms}/ecart`}>Écart budgétaire</a> en choisissant deux versions « Réel PayFit », et sa décomposition dans <a href={`${ms}/analyse`}>Analyse des écarts</a>. Un écran dédié (par rubrique de paie du bulletin) n'est pas possible : l'API PayFit ne renvoie pas de rubrique de bulletin. À préciser avec toi.</p>,
    suivi: <p>Suivi mensuel du réel face au budget : la comparaison mois par mois d'un scénario avec le budget saisi, le réel courant et N-1 existe dans <a href={`${hyp}`}>Hypothèses budgétaires</a> (un scénario › Résultat › Comparaison), et le tableau par rubrique dans <a href={`${ms}/ecart`}>Écart budgétaire</a>. Un suivi mensuel autonome, hors scénario, reste à préciser avec toi (budget de référence, mois de clôture).</p>,
  };
  return (
    <>
      <MsHeader title={ITEM.label} summary={ITEM.summary} />
      <MsTabs slug={slug} current={tab.key as MsTab} />
      <Prevu title={tab.label}>{text[vue]}</Prevu>
    </>
  );
}
