import { FamilyTabs } from "@/components/FamilyTabs";
import { Prevu } from "@/components/Prevu";
import { STUDIO_RH_ITEMS } from "@/lib/nav";
import { requireWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";
type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const ITEM = STUDIO_RH_ITEMS.find((i) => i.path === "studio-rh/reporting-social")!;
const VUES = [
  { key: "index", label: "Index égalité FH", soon: true },
  { key: "bdese", label: "BDESE", soon: true },
] as const;

// Reporting social : entrées du cahier, toutes « Prévu ». Aucune obligation légale, seuil d'effectif ou nombre
// d'indicateurs n'est déduit des captures du webinaire.
export default async function ReportingSocialPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Search> }) {
  const { slug } = await params;
  const sp = await searchParams;
  await requireWorkspace(slug);
  const vue = VUES.some((v) => v.key === one(sp.vue)) ? one(sp.vue) : "index";
  const base = `/e/${slug}/studio-rh/reporting-social`;
  return (
    <>
      <div style={{ display: "grid", gap: 8 }}>
        <span className="label">Studio RH</span>
        <h1>{ITEM.label}</h1>
        <p className="desc">{ITEM.summary}</p>
      </div>
      <FamilyTabs label="Entrées Reporting social" testid="rs-tabs" current={vue} tabs={VUES.map((v) => ({ key: v.key, label: v.label, href: `${base}?vue=${v.key}`, soon: v.soon }))} />
      {vue === "index" ? (
        <Prevu title="Index égalité FH">
          <p>Entrée seulement nommée dans le menu de l'outil observé : aucun écran détaillé. Le calcul de l'index suppose le sexe, la catégorie et la rémunération individuelle, dont le sexe n'est pas lu dans le référentiel Collaborateurs actuel. Les règles applicables et le seuil d'effectif concerné restent à préciser avec toi (la recette juridique est distincte) ; rien n'est simulé ici.</p>
        </Prevu>
      ) : (
        <Prevu title="BDESE">
          <p>Le webinaire montre un catalogue de chapitres (documents, investissements, égalité professionnelle, fonds propres et impôts, rémunérations, activités sociales, financeurs, flux financiers) et deux outils (saisie, gestionnaire de fichiers) ; leur contenu, les formulaires, les obligations applicables, les exports et le partage ne sont pas montrés. Le catalogue applicable à l'entreprise, chaque indicateur avec sa source, sa période et son statut, et la gestion des pièces sont à définir avec toi avant toute réalisation ; la présence de ces cartes ne valide aucune obligation légale.</p>
        </Prevu>
      )}
    </>
  );
}
