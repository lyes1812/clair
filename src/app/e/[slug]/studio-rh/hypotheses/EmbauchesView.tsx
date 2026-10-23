import "@/styles/hypotheses-resultat.css";
import { BarChart } from "@/components/charts";
import { ViewSwitch } from "@/components/ViewSwitch";
import { monthRange } from "@/lib/connectors/months";
import { formatEuros } from "@/lib/money";
import { hireKey } from "@/lib/budget/engine";
import { hireProfiles } from "@/lib/budget/bulk";
import type { ScenarioRow } from "@/lib/budget/store";
import { CATEGORY_LABELS, type BaseSnapshot, type Hypothesis } from "@/lib/budget/types";
import { affichageOf, groupColor, hiresByMonth, monthAxis, monthLongLabel, showCharts, showTables, withAffichage } from "@/lib/viz/hypotheses";
import { monthShort } from "../masse-salariale/components";
import { ActionForm } from "./ActionForm";
import { addHypothesisAction, deleteHypothesisAction } from "./actions";
import { HireForm } from "./HireForm";
import { pct } from "./shared";

type Hire = Extract<Hypothesis, { kind: "embauche" }>;
// « Contrat » des captures du webinaire = la catégorie de contrat de Clair (CDI, CDD, apprenti, stagiaire) : un seul champ.
const GROUPS = { categorie: "Catégorie de contrat", service: "Centre de coûts", metier: "Métier", motif: "Motif d'embauche" } as const;
type Group = keyof typeof GROUPS;
const GROUP_ORDER = Object.keys(GROUPS) as Group[];
// Valeur saisie d'un poste pour un regroupement (null : non renseignée) ; le libellé de repli n'est écrit qu'à l'affichage.
const rawOf = (h: Hire, by: Group): string | null => (by === "categorie" ? (h.category ? CATEGORY_LABELS[h.category] : null) : by === "service" ? (h.service?.trim() || null) : by === "metier" ? (h.metier?.trim() || null) : (h.motif?.trim() || null));
const FALLBACK: Record<Group, string> = { categorie: "Non classé", service: "Non ventilé", metier: "Non renseigné", motif: "Non renseigné" };
const MISSING: Record<Group, string> = { categorie: "aucun poste n'a de catégorie de contrat", service: "aucun poste n'a de centre de coûts", metier: "aucun poste n'a de métier renseigné", motif: "aucun poste n'a de motif d'embauche renseigné" };
const groupOf = (h: Hire, by: Group) => rawOf(h, by) ?? FALLBACK[by];

// Embauches prévisionnelles : postes futurs du scénario (jamais confondus avec des collaborateurs réels), leur calendrier
// par mois et leur fiche contractuelle. Le coût de chaque poste est calculé par la projection (prorata d'arrivée,
// augmentations ciblées, tuilage d'un remplacement).
export function EmbauchesView({ slug, scenario, base, hypotheses, canEdit, par, affichage }: { slug: string; scenario: ScenarioRow; base: BaseSnapshot; hypotheses: Hypothesis[]; canEdit: boolean; par: string; affichage?: string }) {
  const hires = hypotheses.filter((h): h is Hire => h.kind === "embauche");
  const deps = hypotheses.filter((h): h is Extract<Hypothesis, { kind: "depart" }> => h.kind === "depart");
  const by: Group = GROUP_ORDER.includes(par as Group) ? (par as Group) : "categorie";
  const aff = affichageOf(affichage);
  const months = monthRange(scenario.firstMonth, scenario.lastMonth);
  const data = hiresByMonth(hires.map((h) => ({ start: h.start, group: groupOf(h, by) })), months);
  const axis = monthAxis(months);
  const services = [...new Set([...base.contracts.map((c) => c.service), ...hires.map((h) => h.service)].filter((s): s is string => s !== null))].sort();
  const add = (kind: Hypothesis["kind"]) => addHypothesisAction.bind(null, slug, scenario.id, kind);
  const baseHref = `/e/${slug}/studio-rh/hypotheses?scenario=${scenario.id}&vue=embauches`;
  const here = (par2: Group) => `${baseHref}&par=${par2}`;
  // Regroupements proposés : celui dont aucun poste ne porte la valeur est n.d. avec sa raison (jamais une ventilation inventée).
  const available = (g: Group) => hires.some((h) => rawOf(h, g) !== null);
  const missing = GROUP_ORDER.filter((g) => hires.length > 0 && !available(g));
  const range = months.length ? `${monthLongLabel(months[0])} → ${monthLongLabel(months.at(-1)!)}` : "";
  return (
    <>
      <div className="hr-switch">
        <ViewSwitch
          testid="emb-affichage"
          label="Affichage des embauches prévisionnelles"
          current={aff}
          options={[
            { key: "tout", label: "Afficher tout", href: withAffichage(here(by), "tout") },
            { key: "graphique", label: "Graphique", href: withAffichage(here(by), "graphique") },
            { key: "tableau", label: "Embauches prévisionnelles", href: withAffichage(here(by), "tableau") },
          ]}
        />
        <p className="hr-hint">Postes futurs du scénario, comptés le mois de leur arrivée. Ils ne sont jamais confondus avec des collaborateurs réels.</p>
      </div>
      {showCharts(aff) && (
        <section className="panel" data-testid="emb-chart">
          <div className="panel-head">
            <div className="hr-title">
              <h2>Embauches par mois</h2>
              <p className="desc">Postes qui commencent chaque mois du scénario{range ? `, ${range}` : ""}, par {GROUPS[by].toLowerCase()}. <a href="#def-embauche-postes">Définition</a></p>
            </div>
            <div className="panel-tools">
              <nav className="hr-seg" aria-label="Regrouper les embauches par" data-testid="emb-group">
                {GROUP_ORDER.map((g) => {
                  const ok = available(g) || hires.length === 0;
                  if (!ok && g !== by) return <span key={g} aria-disabled="true" title={`n.d. — ${MISSING[g]}`} data-group-by={g}>{GROUPS[g]} <em>n.d.</em></span>;
                  return <a key={g} href={withAffichage(here(g), aff)} aria-current={g === by ? "true" : undefined} data-group-by={g}>{GROUPS[g]}</a>;
                })}
              </nav>
            </div>
          </div>
          {hires.length === 0 ? (
            <p className="desc">Aucune embauche prévisionnelle.{canEdit && aff === "graphique" ? <> <a href={withAffichage(here(by), "tableau")}>Ajouter une embauche</a>.</> : null}</p>
          ) : (
            <>
              <BarChart
                testid="emb-bars"
                label={`Nombre d'embauches prévisionnelles par mois de début, ${range}, par ${GROUPS[by].toLowerCase()} : ${hires.length} poste${hires.length > 1 ? "s" : ""} au total`}
                title={`Embauches par mois de début, par ${GROUPS[by].toLowerCase()}`}
                categories={axis.categories}
                categoryTitles={axis.titles}
                series={data.series}
                unit="nombre"
                mode="stacked"
                toggle
                note={[
                  "Un poste est compté le mois de son premier jour payé. Axe gradué en nombres entiers, depuis zéro.",
                  data.outside > 0 ? `${data.outside} poste${data.outside > 1 ? "s" : ""} commence${data.outside > 1 ? "nt" : ""} hors des mois affichés : non tracé${data.outside > 1 ? "s" : ""}, compté${data.outside > 1 ? "s" : ""} dans la colonne Total du tableau.` : null,
                  data.groups.length > 8 ? "Plus de huit groupes : certaines teintes se répètent ; l'infobulle et le tableau nomment chaque groupe." : null,
                ].filter(Boolean).join(" ")}
              />
              {missing.length > 0 && (
                <div className="hr-notes" data-testid="emb-group-nd">
                  {missing.map((g) => <p key={g} className="tile-foot nd">Regroupement par {GROUPS[g].toLowerCase()} n.d. — {MISSING[g]}.</p>)}
                </div>
              )}
              <div className="table-wrap">
                <table className="data-table" data-testid="emb-by-month">
                  <thead><tr><th>{GROUPS[by]}</th>{months.map((m) => <th key={m} className="num">{monthShort(m)}</th>)}<th className="num">Total</th></tr></thead>
                  <tbody>
                    {data.groups.map((g, gi) => (
                      <tr key={g} data-group={g}>
                        <td><span className="hr-group"><i className="swatch" style={{ background: groupColor(gi) }} aria-hidden="true" />{g}</span></td>
                        {months.map((m, mi) => <td key={m} className="num">{data.counts[gi][mi] || "—"}</td>)}
                        <td className="num">{data.groupTotals[gi]}</td>
                      </tr>
                    ))}
                    <tr><th>Total</th>{data.totals.map((t, i) => <td key={months[i]} className="num">{t || "—"}</td>)}<td className="num">{hires.length}</td></tr>
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}

      {showTables(aff) && (
        <section className="panel" data-testid="emb-list">
          <h2>Embauches prévisionnelles ({hires.length}){hires.length > 1 && <span className="desc"> — classées par date d'arrivée</span>}</h2>
          {hires.length > 0 && (
            <div className="table-wrap scroll">
              <table className="data-table sticky sticky-first hr-hires" data-testid="emb-table">
                <thead><tr><th>Poste</th><th>Catégorie</th><th>Centre de coûts</th><th>Motif</th><th>Métier</th><th>Arrivée</th><th>Fin</th><th className="num">Brut temps plein</th><th className="num">Quotité</th><th className="num">Charges</th><th>Effectif</th><th>Remplace</th>{canEdit && <th />}</tr></thead>
                <tbody>
                  {[...hires].sort((a, b) => a.start.localeCompare(b.start) || a.label.localeCompare(b.label, "fr")).map((h) => (
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
                      {canEdit && <td><ActionForm action={deleteHypothesisAction.bind(null, slug, scenario.id, h.id)} submit="Supprimer" testid={`hyp-delete-${h.id}`} className="inline-form" danger confirm={`Supprimer l'embauche « ${h.label} » ?`} /></td>}
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
      )}
    </>
  );
}
