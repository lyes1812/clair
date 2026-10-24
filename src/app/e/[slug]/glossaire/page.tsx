import "@/styles/glossaire.css";
import { GLOSSARY, normalizeQuery, searchGlossary } from "@/lib/glossary";
import { requireWorkspace } from "@/lib/workspace";
import { GlossaryView } from "./GlossaryView";

export const dynamic = "force-dynamic";

// Glossaire de l'espace : toutes les définitions en une page, filtrées côté serveur par le paramètre d'adresse « q ».
export default async function GlossairePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ q?: string | string[] }> }) {
  const { slug } = await params;
  await requireWorkspace(slug);
  const { q } = await searchParams;
  const query = normalizeQuery(q);
  return <GlossaryView slug={slug} query={query} entries={searchGlossary(query)} total={GLOSSARY.length} />;
}
