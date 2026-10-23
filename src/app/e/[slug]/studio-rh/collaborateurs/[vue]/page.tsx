import "@/styles/collaborateurs.css";
import { notFound } from "next/navigation";
import { Prevu } from "@/components/Prevu";
import { loadCollabContext } from "@/lib/rh/view";
import { CollabHeader, TABS, type TabId } from "../components";

export const dynamic = "force-dynamic";

// Entrées du cahier dont le comportement n'est pas établi : on le dit, avec la raison, sans simuler.
const TEXT: Record<string, string> = {
  tree: "Vue hiérarchique (organisation, managers, équipes) : le référentiel Collaborateurs lu ne porte ni hiérarchie ni manager ; seule l'équipe d'une personne (PayFit) est lue. Le niveau de hiérarchie à représenter reste à préciser avec toi avant toute réalisation.",
  rubrique: "Collaborateurs par rubrique de paie : l'API PayFit ne renvoie pas de rubrique de bulletin (bulletins en PDF) ; le journal comptable de paie par compte et par contrat se lit dans Masse salariale › Paie & comptabilité. Un rattachement des montants par collaborateur et rubrique reste à préciser avec toi.",
  pointage: "Pointage des collaborateurs : entrée seulement nommée dans le menu de l'outil observé, comportement non établi (cahier, 12.12). Les absences lues dans PayFit sont utilisées par l'absentéisme dans KPI RH. À préciser avec toi avant toute réalisation.",
  pivot: "Liste mensuelle en tableau croisé : non réalisée. Les croisements par axe (catégorie, contrat, établissement, statut) existent pour les effectifs dans KPI RH › Effectifs mensuels. Les croisements nominatifs exigent des règles d'anonymat à préciser avec toi.",
};

export default async function CollabPrevuPage({ params }: { params: Promise<{ slug: string; vue: string }> }) {
  const { slug, vue } = await params;
  if (!(vue in TEXT)) notFound();
  const ctx = await loadCollabContext(slug);
  const tab = TABS.find((t) => t.id === (vue as TabId))!;
  return (
    <CollabHeader ctx={ctx} tab={tab.id}>
      <Prevu title={tab.label}><p>{TEXT[vue]}</p></Prevu>
    </CollabHeader>
  );
}
