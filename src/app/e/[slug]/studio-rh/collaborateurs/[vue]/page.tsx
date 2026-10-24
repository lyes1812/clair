import "@/styles/collaborateurs.css";
import { notFound } from "next/navigation";
import { Prevu, type PrevuLink } from "@/components/Prevu";
import { loadCollabContext } from "@/lib/rh/view";
import { base, CollabHeader, TABS, type TabId } from "../components";

export const dynamic = "force-dynamic";

type Content = { lead: string; existing: PrevuLink[]; open: string[] };

// Entrées de la famille Collaborateurs pas encore construites : l'état en une phrase, ce qui existe déjà (avec un lien) et ce qui
// reste à préciser. Aucun écran n'est simulé.
function contentOf(slug: string): Record<string, Content> {
  const collab = base(slug);
  const kpi = `/e/${slug}/studio-rh/kpi`;
  const ms = `/e/${slug}/studio-rh/masse-salariale`;
  return {
    tree: {
      lead: "Vue en arbre de l'organisation (hiérarchie, managers, équipes) : non disponible avec les données lues, car le référentiel Collaborateurs ne porte ni hiérarchie ni manager ; seule l'équipe d'une personne est lue (PayFit).",
      existing: [
        { href: `${collab}/fiche`, title: "Fiche collaborateur", text: "Recherche d'un collaborateur, puis fiche individuelle avec ses contrats et ses périodes." },
        { href: collab, title: "Liste mensuelle des collaborateurs", text: "Contrats du mois et état de chacun en fin de mois." },
      ],
      open: ["Le niveau de hiérarchie à représenter (organisation, managers, équipes) et la source qui le porte."],
    },
    rubrique: {
      lead: "Montants de paie par collaborateur et par rubrique de bulletin : non disponible avec les données lues, car l'API PayFit ne renvoie pas les rubriques de bulletin (les bulletins sont en PDF).",
      existing: [
        { href: `${ms}?vue=paie-compta`, title: "Masse salariale › Paie & comptabilité", text: "Journal comptable de paie par compte et par contrat, rapproché de la comptabilité." },
        { href: `${ms}?vue=fixe-variable`, title: "Masse salariale › Fixe & variable", text: "Brut par libellé de paie et primes par famille et par mois." },
      ],
      open: ["Le rattachement des montants à chaque collaborateur et à chaque rubrique, et les droits d'accès aux données individuelles."],
    },
    pointage: {
      lead: "Pointage des collaborateurs : non réalisé, son contenu attendu n'est pas encore défini.",
      existing: [
        { href: `${kpi}?vue=absenteisme`, title: "KPI RH › Absentéisme", text: "Jours d'absence lus dans PayFit, par mois, avec la définition de l'indicateur." },
        { href: collab, title: "Liste mensuelle des collaborateurs", text: "Temps payé et temps travaillé par contrat et par mois, lorsque la source les porte." },
      ],
      open: ["Les données de pointage attendues (temps de présence, absences) et la source qui les porte."],
    },
    pivot: {
      lead: "Liste mensuelle en tableau croisé (collaborateurs selon un ou plusieurs axes) : non réalisée.",
      existing: [
        { href: `${kpi}?vue=effectifs`, title: "KPI RH › Effectifs mensuels", text: "Effectifs par mois croisés par catégorie, nature de contrat, établissement ou statut." },
        { href: collab, title: "Liste mensuelle des collaborateurs", text: "Une ligne par contrat et par mois, avec recherche sur toutes les colonnes." },
      ],
      open: ["Les croisements nominatifs exigent des règles d'anonymat et de droits d'accès à définir."],
    },
  };
}

export default async function CollabPrevuPage({ params }: { params: Promise<{ slug: string; vue: string }> }) {
  const { slug, vue } = await params;
  const content = contentOf(slug);
  if (!(vue in content)) notFound();
  const ctx = await loadCollabContext(slug);
  const tab = TABS.find((t) => t.id === (vue as TabId))!;
  return (
    <CollabHeader ctx={ctx} tab={tab.id} prevu>
      <Prevu title={tab.label} {...content[vue]} />
    </CollabHeader>
  );
}
