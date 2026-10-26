import { FamilyTabs } from "@/components/FamilyTabs";
import { GlossaryLink } from "@/components/GlossaryLink";
import { CROISEE_TERMS } from "@/lib/glossary/croisee";
import type { ChapterId } from "@/lib/viz/croisee";
import { CHAPTER_TOTAL, CHAPTERS, neighbours, type ChapterDef } from "./chapitres";

// Navigation entre les chapitres : onglets (liens, aria-current, pas de tablist), en-tête du chapitre courant (« NN / 10 », titre,
// question) et pied « précédent / suivant ». Composants serveur ; `hrefOf` est appelé ici, côté serveur, jamais transmis au client.
type HrefOf = (id: ChapterId, hash?: string) => string;

export function ChapterTabs({ current, hrefOf }: { current: ChapterId; hrefOf: HrefOf }) {
  return (
    <div className="cx-tabs">
      <FamilyTabs label="Chapitres" testid="cx-chapter-tabs" current={current} tabs={CHAPTERS.map((c) => ({ key: c.id, label: c.title, href: hrefOf(c.id), soon: c.statut === "prevu" }))} />
    </div>
  );
}

export function ChapterHead({ chapter, slug }: { chapter: ChapterDef; slug: string }) {
  return (
    <header className="cx-chapter-head" id="cx-chapitre" data-testid="cx-chapter-head">
      <p className="label cx-chapter-num">
        {chapter.num} / {CHAPTER_TOTAL}
      </p>
      <div className="cx-chapter-title">
        <h2 id="cx-chapitre-titre">{chapter.title}</h2>
        <GlossaryLink slug={slug} term={CROISEE_TERMS.vueEnsemble} label="Masse salariale croisée" />
      </div>
      <p className="desc cx-question">{chapter.question}</p>
    </header>
  );
}

// Pied de navigation : les liens portent le titre du chapitre voisin et mènent à son en-tête (#cx-chapitre) ; aux extrémités, le
// lien est remplacé par « Début du rapport » ou « Fin du rapport ».
export function ChapterPager({ chapter, hrefOf }: { chapter: ChapterDef; hrefOf: HrefOf }) {
  const { prev, next } = neighbours(chapter.id);
  return (
    <nav className="cx-pager" aria-label="Chapitre précédent et suivant" data-testid="cx-pager">
      {prev ? (
        <a className="cx-pager-prev" href={hrefOf(prev.id, "cx-chapitre")} rel="prev">
          <span className="cx-pager-dir"><span aria-hidden="true">← </span>Chapitre précédent</span>
          <span className="cx-pager-title">{prev.num} · {prev.title}</span>
        </a>
      ) : (
        <span className="cx-pager-prev cx-pager-end">Début du rapport</span>
      )}
      <span className="cx-pager-pos">
        {chapter.num} / {CHAPTER_TOTAL}
      </span>
      {next ? (
        <a className="cx-pager-next" href={hrefOf(next.id, "cx-chapitre")} rel="next">
          <span className="cx-pager-dir">Chapitre suivant<span aria-hidden="true"> →</span></span>
          <span className="cx-pager-title">{next.num} · {next.title}</span>
        </a>
      ) : (
        <span className="cx-pager-next cx-pager-end">Fin du rapport</span>
      )}
    </nav>
  );
}
