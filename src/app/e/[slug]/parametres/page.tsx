import { and, eq } from "drizzle-orm";
import { workspaceSetting } from "@/db/schema";
import { withWorkspace } from "@/db/workspace-scope";
import { dateTimeFmt } from "@/lib/connectors/labels";
import { getHeadcountNatures, HEADCOUNT_NATURES_KEY, natureChoices } from "@/lib/rh-settings";
import { requireWorkspace } from "@/lib/workspace";
import { HeadcountForm } from "./HeadcountForm";

export const dynamic = "force-dynamic";

export default async function ParametresPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { workspace } = await requireWorkspace(slug);
  const isAdmin = workspace.role === "admin";
  const [natures, [row]] = await Promise.all([
    getHeadcountNatures(workspace.id),
    withWorkspace(workspace.id, (tx) =>
      tx.select({ updatedAt: workspaceSetting.updatedAt }).from(workspaceSetting).where(and(eq(workspaceSetting.workspaceId, workspace.id), eq(workspaceSetting.key, HEADCOUNT_NATURES_KEY))),
    ),
  ]);

  return (
    <>
      <div style={{ display: "grid", gap: 8 }}>
        <span className="label">Espace</span>
        <h1>Paramètres</h1>
        <p className="desc">Règles métier de l'espace. Chaque règle est écrite ici et appliquée telle quelle ; aucune valeur n'est cachée.</p>
      </div>

      <section className="panel" data-testid="setting-headcount">
        <h2>Définition de l'effectif</h2>
        <p>
          <strong>Effectif à une date</strong> = nombre de personnes ayant au moins un contrat en cours à cette date (début et fin inclus), parmi les natures
          de contrat ci-dessous. Une personne avec plusieurs contrats compte une fois. Les contrats des autres natures sont affichés à part.
        </p>
        <p className="desc" data-testid="setting-headcount-origin">
          {natures.origin === "default"
            ? "Valeur par défaut validée le 21/10/2026 : CDI et CDD. Modifiable par un administrateur."
            : `Modifié le ${row ? dateTimeFmt.format(row.updatedAt) : "n.d."} par un administrateur.`}
        </p>
        <HeadcountForm slug={slug} choices={natureChoices()} selected={natures.codes} disabled={!isAdmin} />
      </section>
    </>
  );
}
