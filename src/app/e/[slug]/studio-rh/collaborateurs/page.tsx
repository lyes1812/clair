import { SourceBadge } from "@/components/SourceBadge";
import { STUDIO_RH_ITEMS } from "@/lib/nav";
import { resolveSource } from "@/lib/sources";
import { requireWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const ITEM = STUDIO_RH_ITEMS.find((i) => i.path === "studio-rh/collaborateurs")!;

export default async function CollaborateursPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { workspace } = await requireWorkspace(slug);
  const source = await resolveSource(workspace.id, "rh");

  return (
    <>
      <div style={{ display: "grid", gap: 8 }}>
        <span className="label">Studio RH</span>
        <h1>{ITEM.label}</h1>
        <p className="desc">{ITEM.summary}</p>
        <SourceBadge resolution={source} slug={slug} />
      </div>
      {!source.chosen && (
        <section className="placeholder" data-testid="collaborateurs-nd">
          <h3>n.d. — aucune source RH retenue</h3>
          <p className="muted">
            Connectez PayFit ou déposez des DSN dans <a href={`/e/${slug}/donnees`}>Données</a>, appliquez une lecture, puis revenez ici.
          </p>
        </section>
      )}
    </>
  );
}
