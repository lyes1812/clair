import { formatMonth } from "@/lib/dates";
import { formatEuros } from "@/lib/money";
import { hireKey, roundDiv } from "@/lib/budget/engine";
import type { ScenarioRow } from "@/lib/budget/store";
import { CATEGORY_IDS, CATEGORY_LABELS, type BaseContract, type BaseSnapshot, type CategoryId, type Hypothesis, type Projection } from "@/lib/budget/types";
import { fmtEtp4 } from "@/lib/rh/kpi/format";
import { ActionForm } from "./ActionForm";
import { addHypothesisAction, bulkDeparturesAction, bulkRaisesAction, deleteHypothesisAction } from "./actions";

type Row = { key: string; label: string; kind: "base" | "embauche"; service: string | null; category: CategoryId | null; etp4: number | null; monthly: number | null; entry: string | null; contract: BaseContract | null };

const fold = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const catText = (c: CategoryId | null) => (c ? CATEGORY_LABELS[c] : "Non classé");
const Field = ({ id, label, children }: { id: string; label: string; children: React.ReactNode }) => <div className="field-row"><label htmlFor={id}>{label}</label>{children}</div>;

// Hypothèses qui concernent un salarié (contrat de la base ou embauche).
export function eventsOf(key: string, hyps: Hypothesis[]): Hypothesis[] {
  return hyps.filter((h) => {
    if (h.kind === "depart" || h.kind === "absence" || h.kind === "categorie" || h.kind === "base") return h.contractKey === key;
    if (h.kind === "augmentation") return h.scope.kind === "contrat" && h.scope.key === key;
    if (h.kind === "ponctuel") return h.contractKey === key;
    if (h.kind === "embauche") return hireKey(h.id) === key;
    return false;
  });
}

const KIND_TEXT: Record<string, string> = { augmentation: "Augmentation", depart: "Départ", absence: "Congé non payé", categorie: "Catégorie", base: "Correction de base", ponctuel: "Prime / élément ponctuel", embauche: "Embauche" };
const detail = (h: Hypothesis): string => {
  switch (h.kind) {
    case "augmentation": return `${h.rateBps > 0 ? "+" : ""}${h.rateBps / 100} % à compter de ${formatMonth(h.from).toLowerCase()}`;
    case "depart": return `${h.motif ? `${h.motif} · ` : ""}dernier jour payé ${h.lastPaidDate}${h.exitCost ? ` · sortie ${h.exitCost.mode === "brut" ? `${formatEuros(h.exitCost.brutCents)} brut + ${h.exitCost.chargesBps / 100} %` : `${formatEuros(h.exitCost.costCents)} chargés`}` : ""}`;
    case "absence": return `du ${h.from} au ${h.to} · payé à ${h.paidBps / 100} %`;
    case "categorie": return CATEGORY_LABELS[h.category];
    case "base": return `salaire ${formatEuros(h.salaryCents)} · charges ${h.chargesBps / 100} %`;
    case "ponctuel": return `${formatMonth(h.month)} · ${h.amount.mode === "brut" ? `${formatEuros(h.amount.brutCents)} brut + ${h.amount.chargesBps / 100} %` : `${formatEuros(h.amount.costCents)} chargés`}${h.nonRecurring ? " · non récurrent" : ""}`;
    case "embauche": return `${h.start}${h.end ? ` → ${h.end}` : ""} · ${formatEuros(h.grossFullTimeCents)} × ${h.quotaBps / 100} %`;
    default: return "";
  }
};

// Saisie en masse : une ligne par salarié de la base, lignes vides ignorées, lot enregistré en entier ou pas du tout.
function BulkSection({ slug, scenario, base, hyps }: { slug: string; scenario: ScenarioRow; base: BaseSnapshot; hyps: Hypothesis[] }) {
  const departing = new Set(hyps.flatMap((h) => (h.kind === "depart" ? [h.contractKey] : [])));
  const leavers = base.contracts.filter((c) => !departing.has(c.contractKey));
  return (
    <section className="panel" data-testid="sal-bulk">
      <h2>Saisie en masse <span className="desc">— une ligne par salarié, les lignes vides sont ignorées · <a href="#def-saisie-masse">règle</a></span></h2>
      <details>
        <summary>Départs ({leavers.length} salariés sans départ saisi)</summary>
        <ActionForm action={bulkDeparturesAction.bind(null, slug, scenario.id)} submit="Enregistrer les départs renseignés" testid="sal-bulk-departs">
          <input type="hidden" name="n" value={leavers.length} />
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Salarié</th><th>Service</th><th>Dernier jour payé</th><th>Motif</th><th>Coûts de sortie chargés (€)</th></tr></thead>
              <tbody>
                {leavers.map((c, i) => (
                  <tr key={c.contractKey} data-salarie={c.label}>
                    <td>{c.label}<input type="hidden" name={`key_${i}`} value={c.contractKey} /></td>
                    <td>{c.service ?? "Non ventilé"}</td>
                    <td><input className="input" type="date" name={`date_${i}`} aria-label={`Dernier jour payé de ${c.label}`} /></td>
                    <td><input className="input" name={`motif_${i}`} list="bulk-motifs" maxLength={100} aria-label={`Motif de départ de ${c.label}`} /></td>
                    <td><input className="input" name={`cost_${i}`} inputMode="decimal" aria-label={`Coûts de sortie chargés de ${c.label}`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <datalist id="bulk-motifs"><option value="Licenciement" /><option value="Licenciement pour faute grave" /><option value="Rupture conventionnelle" /><option value="Démission" /><option value="Fin de CDD" /><option value="Fin de stage" /></datalist>
          <p className="tile-foot">Coûts de sortie en coût chargé, imputés au mois du départ (facultatif). Pour les saisir en brut + taux de charges, utilisez la fiche du salarié.</p>
        </ActionForm>
      </details>
      <details>
        <summary>Augmentations ({base.contracts.length} salariés)</summary>
        <ActionForm action={bulkRaisesAction.bind(null, slug, scenario.id)} submit="Enregistrer les augmentations renseignées" testid="sal-bulk-raises">
          <input type="hidden" name="n" value={base.contracts.length} />
          <div className="filters">
            <Field id="bulk-from" label="À compter de (mois), commun à toutes les lignes"><input className="input" id="bulk-from" name="from" type="month" min={scenario.firstMonth} max={scenario.lastMonth} /></Field>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Salarié</th><th>Service</th><th>Catégorie</th><th>Taux d'augmentation (%)</th></tr></thead>
              <tbody>
                {base.contracts.map((c, i) => (
                  <tr key={c.contractKey} data-salarie={c.label}>
                    <td>{c.label}<input type="hidden" name={`key_${i}`} value={c.contractKey} /></td>
                    <td>{c.service ?? "Non ventilé"}</td>
                    <td>{catText(c.category ?? null)}</td>
                    <td><input className="input" name={`rate_${i}`} inputMode="decimal" aria-label={`Taux d'augmentation de ${c.label}`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ActionForm>
      </details>
    </section>
  );
}

export function SalariesView({ slug, scenario, base, hyps, proj, q, selected, canEdit }: { slug: string; scenario: ScenarioRow; base: BaseSnapshot; hyps: Hypothesis[]; proj: Projection; q: string; selected: string; canEdit: boolean }) {
  const catOver = new Map(hyps.flatMap((h) => (h.kind === "categorie" ? [[h.contractKey, h.category] as const] : [])));
  const rows: Row[] = [
    ...base.contracts.map((c): Row => ({
      key: c.contractKey, label: c.label, kind: "base", service: c.service, category: catOver.get(c.contractKey) ?? c.category ?? null, etp4: c.etp4, entry: c.startDate, contract: c,
      monthly: c.base ? c.base.salaryCents + roundDiv(BigInt(c.base.salaryCents) * BigInt(c.base.refCotisationsCents), BigInt(c.base.refBrutCents)) : null,
    })),
    ...hyps.flatMap((h): Row[] => (h.kind === "embauche" ? [{ key: hireKey(h.id), label: `${h.label} (embauche)`, kind: "embauche", service: h.service, category: catOver.get(hireKey(h.id)) ?? h.category ?? null, etp4: h.counted ? h.quotaBps : null, entry: h.start, contract: null, monthly: null }] : [])),
  ];
  const shown = q ? rows.filter((r) => fold(r.label).includes(fold(q)) || fold(r.service ?? "").includes(fold(q))) : rows;
  const sel = rows.find((r) => r.key === selected) ?? null;
  const base_ = `/e/${slug}/studio-rh/hypotheses?scenario=${scenario.id}&vue=salaries`;
  const add = (kind: Hypothesis["kind"]) => addHypothesisAction.bind(null, slug, scenario.id, kind);
  return (
    <>
      <section className="panel" data-testid="sal-list">
        <h2>Salariés du scénario <span className="desc">— cherchez un salarié, puis créez-lui un événement (augmentation, départ, congé non payé, prime…)</span></h2>
        <form method="get" action={`/e/${slug}/studio-rh/hypotheses`} className="filters" data-testid="sal-search">
          <input type="hidden" name="scenario" value={scenario.id} />
          <input type="hidden" name="vue" value="salaries" />
          <div className="field-row">
            <label htmlFor="sal-q">Rechercher (nom, service)</label>
            <input className="input" id="sal-q" name="q" defaultValue={q} />
          </div>
          <button className="btn" type="submit">Rechercher</button>
        </form>
        <div className="table-wrap">
          <table className="data-table" data-testid="sal-table">
            <thead><tr><th>Salarié</th><th>Catégorie</th><th>Service</th><th>Entrée</th><th className="num">ETP</th><th className="num">Coût mensuel de base</th><th className="num">Événements</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.key} data-salarie={r.label} aria-current={r.key === selected ? "true" : undefined}>
                  <td><a href={`${base_}&salarie=${encodeURIComponent(r.key)}${q ? `&q=${encodeURIComponent(q)}` : ""}#sal-fiche`}>{r.label}</a></td>
                  <td>{catText(r.category)}{r.category === null && r.contract?.nature ? <span className="tile-foot"> nature {r.contract.nature}</span> : null}</td>
                  <td>{r.service ?? "Non ventilé"}</td>
                  <td>{r.entry ?? "n.d."}</td>
                  <td className="num">{r.etp4 === null ? "n.d." : fmtEtp4(r.etp4)}</td>
                  <td className="num">{r.monthly === null ? (r.kind === "embauche" ? "—" : "n.d.") : formatEuros(r.monthly)}</td>
                  <td className="num">{eventsOf(r.key, hyps).length}</td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={7} className="desc">Aucun salarié ne correspond.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="tile-foot">Catégorie proposée depuis la nature du contrat (Paramètres › Projection), corrigée ici si besoin (ex. une apprentie codée CDD par PayFit).</p>
      </section>

      {canEdit && <BulkSection slug={slug} scenario={scenario} base={base} hyps={hyps} />}

      {sel && (
        <section className="panel" id="sal-fiche" data-testid="sal-fiche">
          <h2>{sel.label} <span className="tag">{catText(sel.category)}</span></h2>
          <p className="desc">
            {sel.service ?? "Non ventilé"} · entrée {sel.entry ?? "n.d."} · ETP {sel.etp4 === null ? "n.d." : fmtEtp4(sel.etp4)}
            {sel.contract?.baseNote ? ` · base : ${sel.contract.baseNote}` : ""}
            {sel.contract?.baseNd ? ` · base n.d. : ${sel.contract.baseNd}` : ""}
          </p>
          <h3>Événements</h3>
          {eventsOf(sel.key, hyps).filter((h) => h.kind !== "embauche").length === 0 ? (
            <p className="desc">Aucun événement pour ce salarié : la projection reconduit sa base.</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table" data-testid="sal-events">
                <thead><tr><th>Type</th><th>Libellé</th><th>Détail</th>{canEdit && <th />}</tr></thead>
                <tbody>
                  {eventsOf(sel.key, hyps).filter((h) => h.kind !== "embauche").map((h) => (
                    <tr key={h.id} data-hyp={h.label}>
                      <td>{KIND_TEXT[h.kind]}</td><td>{h.label}</td><td className="wrap">{detail(h)}</td>
                      {canEdit && <td><ActionForm action={deleteHypothesisAction.bind(null, slug, scenario.id, h.id)} submit="Supprimer" testid={`sal-del-${h.id}`} className="inline-form" danger /></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h3>Coût mensuel projeté</h3>
          {proj.kind === "error" ? (
            <p className="nd">n.d. — projection refusée : {proj.errors.join(" ; ")}</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table" data-testid="sal-months">
                <thead><tr><th>Mois</th><th>Détail</th><th className="num">Coût chargé</th></tr></thead>
                <tbody>
                  {proj.months.map((m) => {
                    const lines = m.kind === "value" ? m.contributions.filter((c) => c.contractKey === sel.key) : [];
                    return (
                      <tr key={m.month} data-month={m.month}>
                        <td>{formatMonth(m.month)}</td>
                        <td className="wrap">{m.kind === "nd" ? <span className="nd">n.d. — {m.reasons.join(" ; ")}</span> : lines.length ? lines.map((c) => `${c.label} ${formatEuros(c.cost)}`).join(" · ") : "—"}</td>
                        <td className="num" data-col="cost">{m.kind === "nd" ? "n.d." : formatEuros(lines.reduce((s, c) => s + c.cost, 0))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {canEdit && (
            <div data-testid="sal-add">
              <h3>Créer un événement pour {sel.label}</h3>
              <details>
                <summary>Augmentation de salaire</summary>
                <ActionForm action={add("augmentation")} submit="Ajouter l'augmentation" testid="sal-form-augmentation">
                  <input type="hidden" name="scope" value={`contrat:${sel.key}`} />
                  <div className="filters">
                    <Field id="s-aug-l" label="Libellé"><input className="input" id="s-aug-l" name="label" defaultValue={`Augmentation ${sel.label}`} maxLength={200} required /></Field>
                    <Field id="s-aug-r" label="Taux (%)"><input className="input" id="s-aug-r" name="rate" inputMode="decimal" required /></Field>
                    <Field id="s-aug-f" label="À compter de (mois)"><input className="input" id="s-aug-f" name="from" type="month" min={scenario.firstMonth} max={scenario.lastMonth} required /></Field>
                  </div>
                </ActionForm>
              </details>
              {sel.kind === "base" && (
                <>
                  <details>
                    <summary>Départ (licenciement, rupture conventionnelle, démission, fin de CDD…)</summary>
                    <ActionForm action={add("depart")} submit="Ajouter le départ" testid="sal-form-depart">
                      <input type="hidden" name="contractKey" value={sel.key} />
                      <div className="filters">
                        <Field id="s-dep-l" label="Libellé"><input className="input" id="s-dep-l" name="label" defaultValue={`Départ ${sel.label}`} maxLength={200} required /></Field>
                        <Field id="s-dep-m" label="Motif"><input className="input" id="s-dep-m" name="motif" list="sal-motifs" maxLength={100} /></Field>
                        <Field id="s-dep-d" label="Dernier jour payé"><input className="input" id="s-dep-d" name="lastPaidDate" type="date" required /></Field>
                      </div>
                      <p className="label">Coûts de sortie (mois du départ, facultatif)</p>
                      <div className="filters">
                        <Field id="s-dep-em" label="Saisie">
                          <select className="select" id="s-dep-em" name="exitMode" defaultValue="aucun"><option value="aucun">Aucun</option><option value="brut">Brut + taux de charges</option><option value="charge">Coût chargé</option></select>
                        </Field>
                        <Field id="s-dep-eb" label="Brut (€)"><input className="input" id="s-dep-eb" name="exitBrut" inputMode="decimal" /></Field>
                        <Field id="s-dep-et" label="Taux de charges (%)"><input className="input" id="s-dep-et" name="exitTaux" inputMode="decimal" /></Field>
                        <Field id="s-dep-ec" label="Coût chargé (€)"><input className="input" id="s-dep-ec" name="exitCout" inputMode="decimal" /></Field>
                      </div>
                      <datalist id="sal-motifs"><option value="Licenciement" /><option value="Licenciement pour faute grave" /><option value="Rupture conventionnelle" /><option value="Démission" /><option value="Fin de CDD" /><option value="Fin de stage" /></datalist>
                    </ActionForm>
                  </details>
                  <details>
                    <summary>Congé non payé ou partiellement payé (congé sans solde, congé supplémentaire de naissance…)</summary>
                    <ActionForm action={add("absence")} submit="Ajouter le congé" testid="sal-form-absence">
                      <input type="hidden" name="contractKey" value={sel.key} />
                      <div className="filters">
                        <Field id="s-abs-l" label="Libellé"><input className="input" id="s-abs-l" name="label" defaultValue={`Congé ${sel.label}`} maxLength={200} required /></Field>
                        <Field id="s-abs-f" label="Du"><input className="input" id="s-abs-f" name="from" type="date" required /></Field>
                        <Field id="s-abs-t" label="Au (inclus)"><input className="input" id="s-abs-t" name="to" type="date" required /></Field>
                        <Field id="s-abs-p" label="Part du salaire payée (%) — 0 : aucun salaire"><input className="input" id="s-abs-p" name="paid" inputMode="decimal" required /></Field>
                      </div>
                    </ActionForm>
                  </details>
                  {sel.contract && !sel.contract.base && (
                    <details open>
                      <summary>Base du salarié (n.d. : à saisir)</summary>
                      <ActionForm action={add("base")} submit="Enregistrer la base" testid="sal-form-base">
                        <input type="hidden" name="contractKey" value={sel.key} />
                        <div className="filters">
                          <Field id="s-b-l" label="Libellé"><input className="input" id="s-b-l" name="label" defaultValue="Base saisie" maxLength={200} required /></Field>
                          <Field id="s-b-s" label="Salaire mensuel de base (€, 0 si non payé)"><input className="input" id="s-b-s" name="salary" inputMode="decimal" required /></Field>
                          <Field id="s-b-c" label="Taux de charges (%)"><input className="input" id="s-b-c" name="charges" inputMode="decimal" required /></Field>
                        </div>
                      </ActionForm>
                    </details>
                  )}
                </>
              )}
              <details>
                <summary>Prime ou élément ponctuel</summary>
                <ActionForm action={add("ponctuel")} submit="Ajouter l'élément" testid="sal-form-ponctuel">
                  <input type="hidden" name="contractKey" value={sel.key} />
                  <input type="hidden" name="service" value={sel.service ?? ""} />
                  <div className="filters">
                    <Field id="s-p-l" label="Libellé"><input className="input" id="s-p-l" name="label" defaultValue={`Prime ${sel.label}`} maxLength={200} required /></Field>
                    <Field id="s-p-m" label="Mois"><input className="input" id="s-p-m" name="month" type="month" min={scenario.firstMonth} max={scenario.lastMonth} required /></Field>
                    <Field id="s-p-mode" label="Saisie">
                      <select className="select" id="s-p-mode" name="amountMode" defaultValue=""><option value="" disabled>Choisir…</option><option value="brut">Brut + taux de charges</option><option value="charge">Coût chargé (non ventilé)</option></select>
                    </Field>
                    <Field id="s-p-b" label="Brut (€)"><input className="input" id="s-p-b" name="amountBrut" inputMode="decimal" /></Field>
                    <Field id="s-p-t" label="Taux de charges (%)"><input className="input" id="s-p-t" name="amountTaux" inputMode="decimal" /></Field>
                    <Field id="s-p-c" label="Coût chargé (€)"><input className="input" id="s-p-c" name="amountCout" inputMode="decimal" /></Field>
                  </div>
                  <label className="check"><input type="checkbox" name="nonRecurring" value="oui" /><span>Non récurrent (retiré de l'atterrissage retraité)</span></label>
                </ActionForm>
              </details>
              <details>
                <summary>Catégorie (CDI, CDD, apprenti, stagiaire)</summary>
                <ActionForm action={add("categorie")} submit="Enregistrer la catégorie" testid="sal-form-categorie">
                  <input type="hidden" name="contractKey" value={sel.key} />
                  <div className="filters">
                    <Field id="s-c-l" label="Libellé"><input className="input" id="s-c-l" name="label" defaultValue={`Catégorie ${sel.label}`} maxLength={200} required /></Field>
                    <Field id="s-c-c" label="Catégorie">
                      <select className="select" id="s-c-c" name="category" defaultValue={sel.category ?? ""}><option value="" disabled>Choisir…</option>{CATEGORY_IDS.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}</select>
                    </Field>
                  </div>
                </ActionForm>
              </details>
            </div>
          )}
        </section>
      )}
    </>
  );
}
