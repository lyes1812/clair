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

// Chapitres du catalogue de la BDESE, listés par leur seul numéro et leur nom : ni nombre d'indicateurs, ni contenu, ni obligation
// n'en sont déduits. Le chapitre 07 est abrégé : son intitulé complet n'est pas lisible dans la source consultée (voir la note sous la grille).
const CHAPITRES = [
  { no: "00", name: "Documents" },
  { no: "01", name: "Investissements" },
  { no: "02", name: "Égalité professionnelle" },
  { no: "03", name: "Fonds propres, endettement et impôts" },
  { no: "04", name: "Rémunération des salariés et dirigeants" },
  { no: "05", name: "Activités sociales et culturelles et Représentation du personnel" },
  { no: "06", name: "Rémunération des financeurs" },
  { no: "07", name: "Flux financiers" },
] as const;
const OUTILS = ["Saisie de la BDESE", "Gestionnaire de fichiers"] as const;

// Reporting social : deux entrées, toutes deux « Prévu ». Aucune obligation légale, seuil d'effectif ou nombre d'indicateurs n'est
// affirmé ici : l'aperçu du catalogue BDESE ne construit rien.
export default async function ReportingSocialPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Search> }) {
  const { slug } = await params;
  const sp = await searchParams;
  await requireWorkspace(slug);
  const vue = VUES.some((v) => v.key === one(sp.vue)) ? one(sp.vue) : "index";
  const base = `/e/${slug}/studio-rh/reporting-social`;
  const studio = `/e/${slug}/studio-rh`;
  return (
    <>
      <PageHead kicker="Studio RH" title={ITEM.label}>
        <p className="desc">{ITEM.summary}</p>
      </PageHead>
      <FamilyTabs label="Entrées Reporting social" testid="rs-tabs" current={vue} tabs={VUES.map((v) => ({ key: v.key, label: v.label, href: `${base}?vue=${v.key}`, soon: v.soon }))} />
      {vue === "index" ? (
        <Prevu
          title="Index égalité FH"
          lead="Non disponible avec les données lues : le calcul de l'index demande le sexe, la catégorie et la rémunération individuelle de chaque collaborateur, et le sexe n'est pas lu aujourd'hui dans le référentiel Collaborateurs."
          existing={[
            { href: `${studio}/collaborateurs`, title: "Collaborateurs", text: "Personnes et contrats lus dans le référentiel, avec la provenance de chaque donnée." },
            { href: `${studio}/masse-salariale`, title: "Masse salariale", text: "Brut, charges et coût chargé, rapprochés des comptes de paie." },
            { href: `/e/${slug}/donnees`, title: "Données", text: "Sources lues, date et statut de la dernière synchronisation." },
          ]}
          open={[
            "La source qui porte le sexe de chaque collaborateur (PayFit ou DSN), et son traitement dans le référentiel Collaborateurs.",
            "Les règles de calcul applicables et le seuil d'effectif concerné, à établir avant toute réalisation.",
          ]}
        />
      ) : (
        <>
          <Prevu
            title="BDESE"
            lead="Non réalisé : la base de données économiques, sociales et environnementales n'existe pas encore dans Clair. Cette entrée présentera un catalogue de chapitres et deux outils, la saisie et le gestionnaire de fichiers. La présence de ces cartes ne valide aucune obligation légale."
            existing={[
              { href: `${studio}/kpi`, title: "KPI RH", text: "ETP, effectif moyen, turnover et absentéisme, avec leurs définitions." },
              { href: `${studio}/masse-salariale`, title: "Masse salariale", text: "Brut, charges et coût chargé, rapprochés des comptes de paie." },
            ]}
            open={[
              "Le catalogue de chapitres applicable à l'entreprise et, pour chaque indicateur, sa source, sa période et son statut.",
              "Le contenu des formulaires de saisie, les exports et le partage.",
              "La gestion des pièces jointes.",
              "Les obligations applicables, à établir avant toute réalisation.",
            ]}
          />
          <section className="panel rs-preview" aria-labelledby="rs-chapitres" data-testid="bdese-catalogue">
            <h2 id="rs-chapitres">Chapitres</h2>
            <p className="rs-banner" role="note">Aperçu du catalogue : aucun contenu n'est encore construit.</p>
            <div className="rs-tools">
              <h3>Outils</h3>
              <ul data-testid="bdese-tools">
                {OUTILS.map((o) => (
                  <li key={o} aria-disabled="true">{o}</li>
                ))}
              </ul>
            </div>
            <ol className="rs-chapters" data-testid="bdese-chapters">
              {CHAPITRES.map((c) => (
                <li key={c.no} className="rs-chapter" aria-disabled="true" data-testid={`bdese-chapter-${c.no}`}>
                  <span className="rs-no" aria-hidden="true">{c.no}</span>
                  <span className="rs-body">
                    <span className="rs-kicker">Chapitre {c.no}</span>
                    <strong>{c.name}</strong>
                  </span>
                </li>
              ))}
            </ol>
            <p className="desc rs-note">L'intitulé du chapitre 07 est abrégé : il reste à confirmer d'après le texte officiel de la BDESE.</p>
          </section>
        </>
      )}
    </>
  );
}
