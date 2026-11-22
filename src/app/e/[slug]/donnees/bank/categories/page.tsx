import "@/styles/donnees.css";
import "@/styles/masse-salariale.css";
import "@/styles/hypotheses-saisie.css";
import { GlossaryLink } from "@/components/GlossaryLink";
import { BANK_CATEGORIES, categoryLabel, fitsDirection, type CategorizedFlow } from "@/lib/bank/categories";
import { loadCategorization } from "@/lib/bank/categorization-context";
import { formatDate } from "@/lib/dates";
import { DONNEES_TERMS } from "@/lib/glossary/donnees";
import { IA_MODEL } from "@/lib/ia/client";
import { formatEuros } from "@/lib/money";
import { hasAtLeast } from "@/lib/roles";
import { requireWorkspace } from "@/lib/workspace";
import { ActionForm } from "../../../studio-rh/hypotheses/ActionForm";
import { Tile } from "../../../studio-rh/masse-salariale/components";
import { Empty, PageHead, Pill } from "../../ui";
import { forgetTierAction, runAiAction, saveCategoriesAction, setNoAiAction } from "./actions";

export const dynamic = "force-dynamic";

const ROWS_SHOWN = 200;
const SOURCE_LABELS: Record<NonNullable<CategorizedFlow["source"]>, string> = { saisie: "Saisie", apprise: "Tiers appris", regle: "Référentiel", ia: "IA" };
const pct = (permille: number | null) => (permille === null ? "n.d." : `${(permille / 10).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`);

export default async function BankCategoriesPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ vue?: string }> }) {
  const { slug } = await params;
  const { vue } = await searchParams;
  const { workspace } = await requireWorkspace(slug);
  const canEdit = hasAtLeast(workspace.role, "editor");
  const isAdmin = hasAtLeast(workspace.role, "admin");
  const { flows, settings, unreadable, iaReady, stats } = await loadCategorization(workspace.id);
  const all = vue === "tous";
  const listed = (all ? flows : flows.filter((f) => f.review)).slice(-ROWS_SHOWN).reverse();
  const shownTotal = all ? flows.length : stats.review;
  const learned = Object.entries(settings.learned).sort(([a], [b]) => a.localeCompare(b));
  const base = `/e/${slug}/donnees/bank/categories`;

  return (
    <>
      <PageHead crumbs={[{ label: "Données", href: `/e/${slug}/donnees` }, { label: "Relevés bancaires", href: `/e/${slug}/donnees/bank` }, { label: "Catégories" }]} title="Catégories des flux bancaires">
        <p className="desc">Chaque mouvement des relevés, rangé dans une catégorie de trésorerie.<GlossaryLink slug={slug} term={DONNEES_TERMS.categorisation} /></p>
      </PageHead>

      {unreadable && <p className="notice" data-testid="categories-unreadable">Catégories enregistrées illisibles : les flux sont affichés sans saisie et aucune modification n’est acceptée.</p>}

      {flows.length === 0 ? (
        <section className="panel"><Empty>Aucun mouvement bancaire appliqué. Dépose un relevé dans <a href={`/e/${slug}/donnees/bank`}>Relevés bancaires</a>.</Empty></section>
      ) : (
        <>
          <dl className="facts ms-tiles four" data-testid="categories-tiles">
            <Tile testid="categories-tile-total" main label="Flux" value={String(stats.total)} lead={`${stats.saisie} saisi(s) · ${stats.apprise} par tiers appris`} />
            <Tile testid="categories-tile-rules" label="Classés par le référentiel et les tiers appris" value={pct(stats.rulesPermille)} lead={`${stats.regle + stats.apprise} flux`} />
            <Tile testid="categories-tile-ia" label="Proposés par l’IA" value={String(stats.ia)} lead={settings.noAi ? "Mode sans IA" : `${stats.none} sans catégorie`} />
            <Tile testid="categories-tile-review" label="À revoir" value={String(stats.review)} lead="Sans catégorie, confiance < 80 % ou montant > 5 % du décaissement mensuel" />
          </dl>

          <section className="panel" id="ia" data-testid="categories-ia">
            <h2>Proposition par l’IA</h2>
            {settings.noAi ? (
              <p className="desc" data-testid="categories-ia-off">Mode sans IA : aucun flux n’est envoyé. Le référentiel et les tiers appris classent seuls, le reste se revoit à la main.</p>
            ) : !iaReady ? (
              <p className="desc" data-testid="categories-ia-missing">IA non configurée pour cette installation : aucun flux n’est envoyé. Le référentiel et les tiers appris classent seuls.</p>
            ) : (
              <>
                <p className="desc">{stats.none} flux sans catégorie. Seuls ceux-là sont envoyés, pseudonymisés, 500 au plus par lancement. Modèle : <code>{IA_MODEL}</code>.</p>
                {canEdit && stats.none > 0 && (
                  <ActionForm action={runAiAction.bind(null, slug)} submit="Proposer des catégories" testid="categories-ia-run" plain
                    confirm={`Envoyer jusqu’à ${Math.min(stats.none, 500)} libellé(s) pseudonymisé(s) au modèle ?`} />
                )}
              </>
            )}
            {isAdmin && !unreadable && (
              <ActionForm action={setNoAiAction.bind(null, slug, !settings.noAi)} submit={settings.noAi ? "Retirer le mode sans IA" : "Activer le mode sans IA"} testid="categories-noai" plain compact />
            )}
          </section>

          <section className="panel" id="revue" data-testid="categories-review">
            <h2>{all ? "Tous les flux" : "Flux à revoir"}</h2>
            <nav className="tabs" aria-label="Flux affichés">
              <a href={`${base}?vue=revue`} aria-current={all ? undefined : "page"}>À revoir ({stats.review})</a>
              <a href={`${base}?vue=tous`} aria-current={all ? "page" : undefined}>Tous ({stats.total})</a>
            </nav>
            {listed.length === 0 ? (
              <Empty>Aucun flux à revoir.</Empty>
            ) : (
              <ActionForm action={saveCategoriesAction.bind(null, slug)} submit="Enregistrer les catégories" testid="categories-form">
                {shownTotal > listed.length && <p className="desc">{listed.length} plus récents sur {shownTotal}. Enregistre pour faire apparaître la suite.</p>}
                <div className="table-wrap scroll">
                  <table className="data-table sticky" data-testid="categories-table">
                    <thead><tr><th scope="col">Date</th><th scope="col">Libellé</th><th scope="col" className="num">Montant</th><th scope="col">Catégorie</th><th scope="col">Origine</th><th scope="col">Revue</th>{canEdit && <th scope="col">Nouvelle catégorie</th>}{canEdit && <th scope="col">Tout le tiers</th>}</tr></thead>
                    <tbody>
                      {listed.map((f, i) => (
                        <tr key={f.key} data-testid="categories-row">
                          <td>{formatDate(f.date)}</td>
                          <td className="wrap cat-label">{f.label}{f.counterparty && <span className="desc"> · {f.counterparty}</span>}</td>
                          <td className="num">{formatEuros(f.amountCents)}</td>
                          <td>{f.category ? categoryLabel(f.category) : <span className="nd">n.d.</span>}</td>
                          <td className="wrap">{f.source ? <>{SOURCE_LABELS[f.source]}{f.reason && <span className="desc"> · {f.reason}</span>}</> : "—"}</td>
                          <td className="cat-review">{f.review ? <Pill tone="preview">{f.reviewReason ?? "À revoir"}</Pill> : "—"}</td>
                          {canEdit && (
                            <td>
                              <input type="hidden" name={`key-${i}`} value={f.key} />
                              <select className="select" name={`cat-${i}`} defaultValue="" disabled={unreadable} aria-label={`Catégorie du flux ${f.label}`}>
                                <option value="">Inchangée</option>
                                {f.category && f.source !== "saisie" && <option value="ok">Valider : {categoryLabel(f.category)}</option>}
                                {BANK_CATEGORIES.filter((c) => fitsDirection(c.id, f.direction)).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                              </select>
                            </td>
                          )}
                          {canEdit && (
                            <td>{f.tier ? <label className="check"><input type="checkbox" name={`tier-${i}`} disabled={unreadable} /> <span>{f.tier}</span></label> : <span className="nd">n.d.</span>}</td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </ActionForm>
            )}
          </section>
        </>
      )}

      <section className="panel" id="tiers" data-testid="categories-learned">
        <h2>Tiers appris</h2>
        {learned.length === 0 ? (
          <Empty>Aucun tiers appris.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th scope="col">Tiers</th><th scope="col">Catégorie</th>{canEdit && <th scope="col"></th>}</tr></thead>
              <tbody>
                {learned.map(([tier, category]) => (
                  <tr key={tier}>
                    <td>{tier}</td>
                    <td>{categoryLabel(category)}</td>
                    {canEdit && <td><ActionForm action={forgetTierAction.bind(null, slug, tier)} submit="Oublier" srLabel={`le tiers ${tier}`} testid="categories-forget" plain compact /></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
