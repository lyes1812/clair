import { monthRange } from "@/lib/connectors/months";
import { formatEuros } from "@/lib/money";
import { hireKey } from "@/lib/budget/engine";
import { hireProfiles } from "@/lib/budget/bulk";
import type { ScenarioRow } from "@/lib/budget/store";
import { CATEGORY_LABELS, type BaseSnapshot, type Hypothesis } from "@/lib/budget/types";
import { monthShort } from "../masse-salariale/components";
import { ActionForm } from "./ActionForm";
import { addHypothesisAction, deleteHypothesisAction } from "./actions";
import { HireForm } from "./HireForm";
import { pct } from "./shared";

type Hire = Extract<Hypothesis, { kind: "embauche" }>;
const GROUPS = { categorie: "Catégorie", service: "Centre de coûts", metier: "Métier", motif: "Motif d'embauche" } as const;
type Group = keyof typeof GROUPS;
const groupOf = (h: Hire, by: Group) => (by === "categorie" ? (h.category ? CATEGORY_LABELS[h.category] : "Non classé") : by === "service" ? (h.service ?? "Non ventilé") : by === "metier" ? (h.metier ?? "Non renseigné") : (h.motif ?? "Non renseigné"));

// Embauches prévisionnelles : postes futurs du scénario (jamais confondus avec des collaborateurs réels), leur calendrier
// par mois et leur fiche contractuelle. Le coût de chaque poste est calculé par la projection (prorata d'arrivée,
// augmentations ciblées, tuilage d'un remplacement).
export function EmbauchesView({ slug, scenario, base, hypotheses, canEdit, par }: { slug: string; scenario: ScenarioRow; base: BaseSnapshot; hypotheses: Hypothesis[]; canEdit: boolean; par: string }) {
  const hires = hypotheses.filter((h): h is Hire => h.kind === "embauche");
  const deps = hypotheses.filter((h): h is Extract<Hypothesis, { kind: "depart" }> => h.kind === "depart");
  const by: Group = par in GROUPS ? (par as Group) : "categorie";
  const months = monthRange(scenario.firstMonth, scenario.lastMonth);
  const groups = [...new Set(hires.map((h) => groupOf(h, by)))].sort();
  const count = (g: string, m: string) => hires.filter((h) => groupOf(h, by) === g && h.start.slice(0, 7) === m).length;
  const totals = months.map((m) => hires.filter((h) => h.start.slice(0, 7) === m).length);
  const services = [...new Set([...base.contracts.map((c) => c.service), ...hires.map((h) => h.service)].filter((s): s is string => s !== null))].sort();
  const add = (kind: Hypothesis["kind"]) => addHypothesisAction.bind(null, slug, scenario.id, kind);
  const W = 48;
  const H = 110;
  const max = Math.max(1, ...totals);
  return (
    <>
      <section className="panel" data-testid="emb-chart">
        <h2>Embauches par mois <span className="desc">— postes qui commencent chaque mois du scénario</span></h2>
        <form method="get" action={`/e/${slug}/studio-rh/hypotheses`} className="filters">
          <input type="hidden" name="scenario" value={scenario.id} />
          <input type="hidden" name="vue" value="embauches" />
          <div className="field-row">
            <label htmlFor="emb-par">Regrouper par</label>
            <select className="select" id="emb-par" name="par" defaultValue={by}>{(Object.keys(GROUPS) as Group[]).map((g) => <option key={g} value={g}>{GROUPS[g]}</option>)}</select>
          </div>
          <button className="btn" type="submit">Afficher</button>
        </form>
        {hires.length === 0 ? (
          <p className="desc">Aucune embauche prévisionnelle.</p>
        ) : (
          <>
            <svg viewBox={`0 0 ${months.length * W + 20} ${H + 30}`} role="img" aria-label="Nombre d'embauches par mois" style={{ width: "100%", maxWidth: months.length * W + 20, height: "auto" }}>
              <line x1="6" x2={months.length * W + 14} y1={H} y2={H} stroke="var(--line)" />
              {months.map((m, i) => {
                const h = (totals[i] / max) * (H - 24);
                return (
                  <g key={m}>
                    <rect x={14 + i * W} y={H - h} width="26" height={h} fill="var(--ink)"><title>{`${m} : ${totals[i]} embauche${totals[i] > 1 ? "s" : ""}`}</title></rect>
                    {totals[i] > 0 && <text x={27 + i * W} y={H - h - 4} textAnchor="middle" fontSize="10" fill="var(--ink)">{totals[i]}</text>}
                    <text x={27 + i * W} y={H + 16} textAnchor="middle" fontSize="11" fill="var(--muted)">{monthShort(m)}</text>
                  </g>
                );
              })}
            </svg>
            <div className="table-wrap">
              <table className="data-table" data-testid="emb-by-month">
                <thead><tr><th>{GROUPS[by]}</th>{months.map((m) => <th key={m} className="num">{monthShort(m)}</th>)}<th className="num">Total</th></tr></thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g} data-group={g}><td>{g}</td>{months.map((m) => <td key={m} className="num">{count(g, m) || "—"}</td>)}<td className="num">{hires.filter((h) => groupOf(h, by) === g).length}</td></tr>
                  ))}
                  <tr><th>Total</th>{totals.map((t, i) => <td key={months[i]} className="num">{t || "—"}</td>)}<td className="num">{hires.length}</td></tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="panel" data-testid="emb-list">
        <h2>Embauches prévisionnelles ({hires.length})</h2>
        {hires.length > 0 && (
          <div className="table-wrap">
            <table className="data-table" data-testid="emb-table">
              <thead><tr><th>Poste</th><th>Catégorie</th><th>Centre de coûts</th><th>Motif</th><th>Métier</th><th>Arrivée</th><th>Fin</th><th className="num">Brut temps plein</th><th className="num">Quotité</th><th className="num">Charges</th><th>Effectif</th><th>Remplace</th>{canEdit && <th />}</tr></thead>
              <tbody>
                {hires.map((h) => (
                  <tr key={h.id} data-hyp={h.label}>
                    <td>{h.label}{h.copiedFrom ? <span className="tile-foot"> · profil recopié de {base.contracts.find((c) => c.contractKey === h.copiedFrom)?.label ?? hypotheses.find((x) => hireKey(x.id) === h.copiedFrom)?.label ?? h.copiedFrom}</span> : null}</td>
                    <td>{h.category ? CATEGORY_LABELS[h.category] : "Non classé"}</td>
                    <td>{h.service ?? "Non ventilé"}</td>
                    <td>{h.motif ?? "—"}</td>
                    <td>{h.metier ?? "—"}</td>
                    <td>{h.start}</td>
                    <td>{h.end ?? "—"}</td>
                    <td className="num">{formatEuros(h.grossFullTimeCents)}</td>
                    <td className="num">{pct(h.quotaBps)}</td>
                    <td className="num">{pct(h.chargesBps)}</td>
                    <td>{h.counted ? "compté" : "non compté"}</td>
                    <td>{h.replaces ? (hypotheses.find((x) => x.id === h.replaces)?.label ?? "départ supprimé") : "—"}</td>
                    {canEdit && <td><ActionForm action={deleteHypothesisAction.bind(null, slug, scenario.id, h.id)} submit="Supprimer" testid={`hyp-delete-${h.id}`} className="inline-form" danger /></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canEdit && (
          <details open>
            <summary>Ajouter une embauche (un ou plusieurs postes, par centre de coûts)</summary>
            <p className="desc">Un centre de coûts existant ou nouveau, une catégorie (CDI, CDD, apprenti, stagiaire) et un nombre de postes : chaque poste devient une hypothèse distincte, supprimable seule. Le profil d'un salarié peut être recopié (service, catégorie, brut temps plein = salaire du mois de référence ÷ ETP, taux de charges observé) ; les valeurs restent modifiables et rien n'est supposé quand l'ETP ou la base est n.d. · <a href="#def-embauche-postes">règle</a></p>
            <datalist id="hyp-services">{services.map((x) => <option key={x} value={x} />)}</datalist>
            <HireForm action={add("embauche")} profiles={hireProfiles(base, hires)} deps={deps.map((d) => ({ id: d.id, label: d.label }))} />
          </details>
        )}
      </section>
    </>
  );
}
