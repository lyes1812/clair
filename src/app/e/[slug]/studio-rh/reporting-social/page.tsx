import "@/styles/donnees.css";
import { FamilyTabs } from "@/components/FamilyTabs";
import { Prevu } from "@/components/Prevu";
import { STUDIO_RH_ITEMS } from "@/lib/nav";
import { PageHead } from "../../donnees/ui";
import { requireWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";
type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const ITEM = STUDIO_RH_ITEMS.find((i) => i.path === "studio-rh/reporting-social")!;
const VUES = [
  { key: "index", label: "Index égalité FH", soon: true },
  { key: "bdese", label: "BDESE", soon: true },
] as const;

// Chapitres cités par la capture du webinaire, listés par leur seul nom et leur numéro : ni nombre d'indicateurs, ni contenu,
// ni obligation n'en sont déduits. Toutes les cartes sont « Prévu ».
const CHAPITRES = [
  { no: "00", name: "Documents" },
  { no: "01", name: "Investissements" },
  { no: "02", name: "Égalité professionnelle" },
  { no: "03", name: "Fonds propres, endettement et impôts" },
  { no: "04", name: "Rémunération des salariés et dirigeants" },
  { no: "05", name: "Activités sociales et culturelles" },
  { no: "06", name: "Rémunération des financeurs" },
  { no: "07", name: "Flux financiers" },
] as const;
const OUTILS = ["Saisie de la BDESE", "Gestionnaire de fichiers"] as const;

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
      <PageHead kicker="Studio RH" title={ITEM.label}>
        <p className="desc">{ITEM.summary} Les deux entrées sont prévues : rien n'est encore calculé ni exporté.</p>
      </PageHead>
      <FamilyTabs label="Entrées Reporting social" testid="rs-tabs" current={vue} tabs={VUES.map((v) => ({ key: v.key, label: v.label, href: `${base}?vue=${v.key}`, soon: v.soon }))} />
      {vue === "index" ? (
        <Prevu title="Index égalité FH">
          <p>Entrée seulement nommée dans le menu de l'outil observé : aucun écran détaillé. Le calcul de l'index suppose le sexe, la catégorie et la rémunération individuelle, dont le sexe n'est pas lu dans le référentiel Collaborateurs actuel. Les règles applicables et le seuil d'effectif concerné restent à préciser (la recette juridique est distincte) ; rien n'est simulé ici.</p>
        </Prevu>
      ) : (
        <>
          <Prevu title="BDESE">
            <p>Le webinaire montre un catalogue de chapitres (listés ci-dessous par leur seul nom) et deux outils (saisie, gestionnaire de fichiers) ; leur contenu, les formulaires, les obligations applicables, les exports et le partage ne sont pas montrés. Le catalogue applicable à l'entreprise, chaque indicateur avec sa source, sa période et son statut, et la gestion des pièces sont à définir avant toute réalisation ; la présence de ces cartes ne valide aucune obligation légale.</p>
          </Prevu>
          <section className="panel" aria-labelledby="rs-chapitres" data-testid="bdese-catalogue">
            <div className="dn-section-head">
              <h2 id="rs-chapitres">Chapitres</h2>
              <p className="desc">Présentation observée sur la capture de référence. Aucune carte n'est construite : ni contenu, ni indicateur, ni chiffre.</p>
            </div>
            <div className="rs-layout">
              <div className="rs-tools">
                <h3>Outils</h3>
                <ul data-testid="bdese-tools">
                  {OUTILS.map((o) => (
                    <li key={o}>
                      <span>{o}</span>
                      <span className="tag">Prévu</span>
                    </li>
                  ))}
                </ul>
              </div>
              <ol className="rs-chapters" data-testid="bdese-chapters">
                {CHAPITRES.map((c) => (
                  <li key={c.no} className="rs-chapter" data-testid={`bdese-chapter-${c.no}`}>
                    <span className="rs-no" aria-hidden="true">{c.no}</span>
                    <span className="rs-body">
                      <span className="rs-kicker">Chapitre {c.no}</span>
                      <strong>{c.name}</strong>
                      <span className="tag">Prévu</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </section>
        </>
      )}
    </>
  );
}
