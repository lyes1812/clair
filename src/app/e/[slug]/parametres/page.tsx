import { and, eq } from "drizzle-orm";
import { workspaceSetting } from "@/db/schema";
import { withWorkspace } from "@/db/workspace-scope";
import { dateTimeFmt } from "@/lib/connectors/labels";
import { ABSENCE_STATUSES } from "@/lib/connectors/payfit/client";
import { getKpiSettings, kpiOriginText, type KpiSettingKey } from "@/lib/rh-kpi-settings";
import { getHeadcountNatures, getPayfitHistoryMode, HEADCOUNT_NATURES_KEY, natureChoices, PAYFIT_HISTORY_KEY } from "@/lib/rh-settings";
import { PAYFIT_ARCHIVED_RETENTION_MONTHS } from "@/lib/rh/referential/build-payfit";
import { ABSENCE_STATUS_LABELS } from "@/lib/rh/labels";
import { activePayFitSync, loadAbsenceTypes } from "@/lib/rh/referential/store";
import { KpiForm } from "./KpiForm";
import { requireWorkspace } from "@/lib/workspace";
import { HeadcountForm } from "./HeadcountForm";
import { PayfitHistoryForm } from "./PayfitHistoryForm";

export const dynamic = "force-dynamic";

export default async function ParametresPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { workspace } = await requireWorkspace(slug);
  const isAdmin = workspace.role === "admin";
  const [kpi, active] = await Promise.all([getKpiSettings(workspace.id), activePayFitSync(workspace.id)]);
  const readTypes = active ? await loadAbsenceTypes(workspace.id, active.id) : [];
  const typeRows = [...new Set([...readTypes.map((t) => t.type), ...kpi.values.absenceTypes])].sort().map((type) => {
    const t = readTypes.find((x) => x.type === type);
    return { type, count: t?.count ?? 0, inRead: Boolean(t) };
  });
  const origins = Object.fromEntries((Object.keys(kpi.origins) as KpiSettingKey[]).map((k) => [k, kpiOriginText(k, kpi.origins[k], (d) => dateTimeFmt.format(d))]));
  const updatedAt = (key: string) =>
    withWorkspace(workspace.id, (tx) =>
      tx.select({ updatedAt: workspaceSetting.updatedAt }).from(workspaceSetting).where(and(eq(workspaceSetting.workspaceId, workspace.id), eq(workspaceSetting.key, key))),
    ).then(([r]) => r?.updatedAt ?? null);
  const [natures, row, history, historyAt] = await Promise.all([getHeadcountNatures(workspace.id), updatedAt(HEADCOUNT_NATURES_KEY), getPayfitHistoryMode(workspace.id), updatedAt(PAYFIT_HISTORY_KEY)]);

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
            : `Modifié le ${row ? dateTimeFmt.format(row) : "n.d."} par un administrateur.`}
        </p>
        <HeadcountForm slug={slug} choices={natureChoices()} selected={natures.codes} disabled={!isAdmin} />
      </section>

      <section className="panel" data-testid="setting-payfit-history" id="payfit-historique">
        <h2>Historique PayFit</h2>
        <p>
          PayFit ne renvoie plus les contrats archivés depuis plus de {PAYFIT_ARCHIVED_RETENTION_MONTHS ?? "n.d."} mois. Pour les mois antérieurs à la date de
          lecture moins {PAYFIT_ARCHIVED_RETENTION_MONTHS ?? "n.d."} mois, les chiffres calculés sur ce que l'API renvoie ne comptent pas ces salariés :
          les effectifs, l'ETP et les sorties peuvent être sous-estimés ; les entrées, le turnover et l'absentéisme peuvent être faussés dans un sens ou dans l'autre (un contrat qui fait suite à un contrat non renvoyé compte comme une entrée, et les dénominateurs sont réduits).
        </p>
        <p className="desc" data-testid="setting-payfit-history-origin">
          {history.origin === "default"
            ? "Valeur par défaut validée le 22/10/2026 : brut. Modifiable par un administrateur."
            : `Modifié le ${historyAt ? dateTimeFmt.format(historyAt) : "n.d."} par un administrateur.`}
        </p>
        <PayfitHistoryForm slug={slug} mode={history.mode} disabled={!isAdmin} />
      </section>

      <section className="panel" data-testid="setting-kpi" id="kpi">
        <h2>Définitions des KPI</h2>
        <p className="desc">
          Règles appliquées par Studio RH › KPI RH. Elles sont recalculées à chaque affichage, sans reconstruire le référentiel. Les natures comptées
          sont celles de la définition de l'effectif ci-dessus.
        </p>
        <KpiForm
          slug={slug}
          values={kpi.values}
          origins={origins}
          natures={natureChoices().map((n) => ({ code: n.code, label: n.label }))}
          types={typeRows}
          readLabel={active ? `lecture du ${dateTimeFmt.format(active.startedAt)}` : null}
          statuses={[...ABSENCE_STATUSES].map((code) => ({ code, label: ABSENCE_STATUS_LABELS[code] ?? code }))}
          disabled={!isAdmin}
        />
      </section>
    </>
  );
}
