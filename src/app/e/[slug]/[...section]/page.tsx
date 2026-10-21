import { notFound } from "next/navigation";
import { ALL_ITEMS, DATA_ITEM } from "@/lib/nav";

export default async function SectionPage({ params }: { params: Promise<{ slug: string; section: string[] }> }) {
  const { section } = await params;
  const item = ALL_ITEMS.find((i) => i.path === section.join("/"));
  if (!item) notFound();
  return (
    <>
      <div style={{ display: "grid", gap: 8 }}>
        <span className="label">{item === DATA_ITEM ? "Données" : "Studio RH"}</span>
        <h1>{item.label}</h1>
        <p className="desc">{item.summary}</p>
      </div>
      <section className="placeholder" data-testid="placeholder">
        <h3>À venir : module {item.module}</h3>
        <p className="muted">Ce module n'est pas encore livré. Aucune donnée n'est affichée tant qu'il ne l'est pas.</p>
      </section>
    </>
  );
}
