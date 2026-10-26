import { ChapterPrevu } from "./atomes/ChapterPrevu";
import { chapterLinks, EN_CONSTRUCTION } from "./chapitres";
import type { CroiseeContext } from "./context";

// Chapitre 08 · Effets d'évolution : coquille de la vague 0 (« Prévu », chapitre en cours de construction), remplacée par l'agent du chapitre.
export default function ChEffets({ ctx }: { ctx: CroiseeContext }) {
  return <ChapterPrevu slug={ctx.slug} id={ctx.chapter.id} reason={EN_CONSTRUCTION} links={chapterLinks(ctx.slug, ctx.chapter)} />;
}
