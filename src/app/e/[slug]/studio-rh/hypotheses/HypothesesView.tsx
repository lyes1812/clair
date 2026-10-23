import { formatMonth } from "@/lib/dates";
import { formatEuros } from "@/lib/money";
import { enteredAfter, hireKey, roundDiv } from "@/lib/budget/engine";
import type { ScenarioRow } from "@/lib/budget/store";
import type { Amount, BaseSnapshot, Hypothesis, Projection, Scope } from "@/lib/budget/types";
import { fmtEtp4, fmtFixed } from "@/lib/rh/kpi/format";
import { ActionForm } from "./ActionForm";
import { addHypothesisAction, deleteHypothesisAction } from "./actions";

const pct = (bps: number) => `${fmtFixed({ num: bps, den: 100 }, 2)} %`;
const amountText = (a: Amount) => (a.mode === "brut" ? `${formatEuros(a.brutCents)} brut + charges ${pct(a.chargesBps)}` : `${formatEuros(a.costCents)} chargés`);
const KIND = { augmentation: "Augmentation", embauche: "Embauche", depart: "Départ", ponctuel: "Élément ponctuel", base: "Correction de base" } as const;

function scopeText(s: Scope, base: BaseSnapshot, hyps: Hypothesis[]) {
  if (s.kind === "global") return "toute l'entreprise (hors embauches et entrées après la base)";
  if (s.kind === "service") return `service ${s.service} (hors embauches et entrées après la base)`;
  const c = base.contracts.find((x) => x.contractKey === s.key);
  const h = hyps.find((x) => hireKey(x.id) === s.key);
  return `contrat : ${c?.label ?? h?.label ?? s.key}`;
}

function detailOf(h: Hypothesis, base: BaseSnapshot, hyps: Hypothesis[]): string {
  const who = (key: string) => base.contracts.find((c) => c.contractKey === key)?.label ?? key;
  switch (h.kind) {
    case "augmentation":
      return `${h.rateBps > 0 ? "+" : ""}${pct(h.rateBps)} à compter de ${formatMonth(h.from).toLowerCase()} · ${scopeText(h.scope, base, hyps)}`;
    case "embauche": {
      const rep = h.replaces ? hyps.find((x) => x.id === h.replaces) : null;
      return `${h.service ?? "Non ventilé"} · du ${h.start}${h.end ? ` au ${h.end}` : ""} · ${formatEuros(h.grossFullTimeCents)} brut temps plein × ${pct(h.quotaBps)} · charges ${pct(h.chargesBps)} · ${h.counted ? "compté" : "non compté"} dans l'effectif${rep ? ` · remplace « ${rep.label} »` : ""}`;
    }
    case "depart":
      return `${who(h.contractKey)} · dernier jour payé ${h.lastPaidDate}${h.exitCost ? ` · coûts de sortie ${amountText(h.exitCost)}` : ""}`;
    case "ponctuel":
      return `${formatMonth(h.month)} · ${amountText(h.amount)} · ${h.service ?? "toute l'entreprise"}`;
    case "base":
      return `${who(h.contractKey)} · salaire ${formatEuros(h.salaryCents)} · charges ${pct(h.chargesBps)}`;
  }
}

const Field = ({ id, label, children }: { id: string; label: string; children: React.ReactNode }) => (
  <div className="field-row"><label htmlFor={id}>{label}</label>{children}</div>
);
const Text = ({ id, name, label, ...rest }: { id: string; name: string; label: string } & React.InputHTMLAttributes<HTMLInputElement>) => (
  <Field id={id} label={label}><input className="input" id={id} name={name} {...rest} /></Field>
);

function AmountFields({ prefix, idp, optional }: { prefix: string; idp: string; optional?: boolean }) {
  return (
    <>
      <Field id={`${idp}-mode`} label="Saisie">
        <select className="select" id={`${idp}-mode`} name={`${prefix}Mode`} defaultValue={optional ? "aucun" : ""}>
          {optional ? <option value="aucun">Aucun</option> : <option value="" disabled>Choisir…</option>}
          <option value="brut">Brut + taux de charges</option>
          <option value="charge">Coût chargé (non ventilé)</option>
        </select>
      </Field>
      <Text id={`${idp}-brut`} name={`${prefix}Brut`} label="Brut (€)" inputMode="decimal" />
      <Text id={`${idp}-taux`} name={`${prefix}Taux`} label="Taux de charges (%)" inputMode="decimal" />
      <Text id={`${idp}-cout`} name={`${prefix}Cout`} label="Coût chargé (€)" inputMode="decimal" />
    </>
  );
}

export function HypothesesView({ slug, scenario, base, hypotheses, proj, canEdit }: { slug: string; scenario: ScenarioRow; base: BaseSnapshot; hypotheses: Hypothesis[]; proj: Projection; canEdit: boolean }) {
  const fixes = new Map(hypotheses.filter((h) => h.kind === "base").map((h) => [h.contractKey, h]));
  const departed = new Set(hypotheses.filter((h) => h.kind === "depart").map((h) => h.contractKey));
  const services = [...new Set([...base.contracts.map((c) => c.service), ...hypotheses.map((h) => (h.kind === "embauche" ? h.service : null))].filter((s): s is string => s !== null))].sort();
  const hires = hypotheses.filter((h): h is Extract<Hypothesis, { kind: "embauche" }> => h.kind === "embauche");
  const deps = hypotheses.filter((h): h is Extract<Hypothesis, { kind: "depart" }> => h.kind === "depart");
  const add = (kind: Hypothesis["kind"]) => addHypothesisAction.bind(null, slug, scenario.id, kind);
  const toFix = base.contracts.filter((c) => !c.base && !fixes.has(c.contractKey));
  const cost = (c: BaseSnapshot["contracts"][number]) => (c.base ? c.base.salaryCents + roundDiv(BigInt(c.base.salaryCents) * BigInt(c.base.refCotisationsCents), BigInt(c.base.refBrutCents)) : null);
  return (
    <>
      <section className="panel" data-testid="hyp-base">
        <h2>Base figée — {formatMonth(base.refMonth).toLowerCase()} <span className="desc">— <a href="#def-base-contrat">coût de référence d'un contrat</a></span></h2>
        <dl className="facts">
          <div data-testid="hyp-base-total">
            <dt>Coût mensuel de la base ({base.contracts.filter((c) => !enteredAfter(base, c)).length} contrats présents fin {formatMonth(base.refMonth).toLowerCase()})</dt>
            <dd className={base.refBaseCost === null ? "nd" : undefined}>{base.refBaseCost === null ? `n.d. — ${base.contracts.filter((c) => !c.base && !enteredAfter(base, c)).length} base(s) de contrat n.d.` : formatEuros(base.refBaseCost)}</dd>
            <span className="tile-foot">salaires et gratifications de stage + charges au taux observé de chaque contrat</span>
          </div>
          <div data-testid="hyp-base-masse">
            <dt>Masse salariale réelle de {formatMonth(base.refMonth).toLowerCase()}</dt>
            <dd>{formatEuros(base.refMasse)}</dd>
            <span className="tile-foot">{base.refBaseCost === null ? "écart avec la base : n.d." : `hors base : ${formatEuros(base.refMasse - base.refBaseCost)} (primes, indemnités, contrats sortis dans le mois, lignes sans contrat)`}</span>
          </div>
        </dl>
        {toFix.length > 0 && (
          <p className="notice" data-testid="hyp-base-nd">{toFix.length} contrat(s) sans base : la projection est n.d. tant qu'une correction de base n'est pas saisie (salaire mensuel et taux de charges).</p>
        )}
        <details open={toFix.length > 0}>
          <summary>Contrats de la base ({base.contracts.length})</summary>
          <div className="table-wrap">
            <table className="data-table" data-testid="hyp-base-contracts">
              <thead><tr><th>Contrat</th><th>Service</th><th>Entrée</th><th>Fin connue</th><th className="num">ETP</th><th className="num">Salaire</th><th className="num">Taux de charges</th><th className="num">Coût mensuel</th><th>État</th></tr></thead>
              <tbody>
                {base.contracts.map((c) => {
                  const fix = fixes.get(c.contractKey);
                  return (
                    <tr key={c.contractKey} data-contract={c.externalId}>
                      <td>{c.label}</td>
                      <td>{c.service ?? <span title={c.serviceNd ?? undefined}>Non ventilé{c.serviceNd ? " ⚠" : ""}</span>}</td>
                      <td>{c.startDate ?? "n.d."}</td>
                      <td>{c.endDate ?? "—"}</td>
                      <td className="num">{c.etp4 === null ? <span title={c.etpNd ?? undefined}>n.d.</span> : fmtEtp4(c.etp4)}</td>
                      <td className="num">{c.base ? formatEuros(c.base.salaryCents) : "n.d."}</td>
                      <td className="num">{c.base ? `${fmtFixed({ num: c.base.refCotisationsCents * 100, den: c.base.refBrutCents }, 2)} %` : "n.d."}</td>
                      <td className="num">{cost(c) === null ? "n.d." : formatEuros(cost(c)!)}</td>
                      <td className="wrap">{fix ? `corrigée : ${detailOf(fix, base, hypotheses)}` : c.baseNd ? <span className="nd">n.d. — {c.baseNd}</span> : "figée"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
        {(base.etpNote || base.contracts.some((c) => c.serviceNd)) && (
          <p className="tile-foot" data-testid="hyp-base-notes">
            {base.etpNote ? `ETP : ${base.etpNote}. ` : ""}
            {base.contracts.filter((c) => c.serviceNd).map((c) => `${c.label} : ${c.serviceNd}`).join(" ; ")}
          </p>
        )}
        {canEdit && toFix.length > 0 && (
          <ActionForm action={add("base")} submit="Enregistrer la correction" testid="hyp-form-base">
            <div className="filters">
              <Field id="fix-contract" label="Contrat">
                <select className="select" id="fix-contract" name="contractKey" defaultValue="">
                  <option value="" disabled>Choisir…</option>
                  {toFix.map((c) => <option key={c.contractKey} value={c.contractKey}>{c.label} — {c.baseNd}</option>)}
                </select>
              </Field>
              <Text id="fix-label" name="label" label="Libellé" defaultValue="Base saisie" maxLength={200} />
              <Text id="fix-salary" name="salary" label="Salaire mensuel de base (€, 0 si non payé)" inputMode="decimal" />
              <Text id="fix-charges" name="charges" label="Taux de charges (%)" inputMode="decimal" />
            </div>
          </ActionForm>
        )}
      </section>

      <section className="panel" data-testid="hyp-list-hyps">
        <h2>Hypothèses du scénario ({hypotheses.length})</h2>
        {proj.kind === "error" && <ul className="list" data-testid="hyp-errors">{proj.errors.map((e) => <li key={e} className="nd">{e}</li>)}</ul>}
        {hypotheses.length === 0 ? (
          <p className="desc">Aucune hypothèse : la projection reconduit la base figée (avec les fins de contrat connues).</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table" data-testid="hyp-hypotheses">
              <thead><tr><th>Type</th><th>Libellé</th><th>Détail</th>{canEdit && <th />}</tr></thead>
              <tbody>
                {hypotheses.map((h) => (
                  <tr key={h.id} data-hyp={h.label}>
                    <td>{KIND[h.kind]}</td>
                    <td>{h.label}</td>
                    <td className="wrap">{detailOf(h, base, hypotheses)}</td>
                    {canEdit && <td><ActionForm action={deleteHypothesisAction.bind(null, slug, scenario.id, h.id)} submit="Supprimer" testid={`hyp-delete-${h.id}`} className="inline-form" danger /></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canEdit ? (
        <section className="panel" data-testid="hyp-add">
          <h2>Ajouter une hypothèse <span className="desc">— chaque hypothèse est contrôlée par le moteur avant enregistrement</span></h2>
          <details>
            <summary>Augmentation</summary>
            <ActionForm action={add("augmentation")} submit="Ajouter l'augmentation" testid="hyp-form-augmentation">
              <div className="filters">
                <Text id="aug-label" name="label" label="Libellé" maxLength={200} required />
                <Text id="aug-rate" name="rate" label="Taux (%)" inputMode="decimal" required />
                <Text id="aug-from" name="from" label="À compter de (mois)" type="month" min={scenario.firstMonth} max={scenario.lastMonth} required />
                <Field id="aug-scope" label="Périmètre">
                  <select className="select" id="aug-scope" name="scope" defaultValue="">
                    <option value="" disabled>Choisir…</option>
                    <option value="global">Toute l'entreprise (hors embauches et entrées après la base)</option>
                    {services.map((s) => <option key={s} value={`service:${s}`}>Service {s}</option>)}
                    {base.contracts.map((c) => <option key={c.contractKey} value={`contrat:${c.contractKey}`}>Contrat : {c.label}</option>)}
                    {hires.map((h) => <option key={h.id} value={`contrat:${hireKey(h.id)}`}>Embauche : {h.label}</option>)}
                  </select>
                </Field>
              </div>
            </ActionForm>
          </details>
          <details>
            <summary>Embauche</summary>
            <ActionForm action={add("embauche")} submit="Ajouter l'embauche" testid="hyp-form-embauche">
              <div className="filters">
                <Text id="hire-label" name="label" label="Poste" maxLength={200} required />
                <Field id="hire-service" label="Service">
                  <select className="select" id="hire-service" name="service" defaultValue="">
                    <option value="">Non ventilé</option>
                    {services.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
                <Text id="hire-start" name="start" label="Premier jour payé" type="date" required />
                <Text id="hire-end" name="end" label="Dernier jour payé (CDD, facultatif)" type="date" />
                <Text id="hire-gross" name="gross" label="Brut mensuel temps plein (€)" inputMode="decimal" required />
                <Text id="hire-quota" name="quota" label="Quotité (%)" inputMode="decimal" required />
                <Text id="hire-charges" name="charges" label="Taux de charges (%)" inputMode="decimal" required />
                <Field id="hire-counted" label="Effectif">
                  <select className="select" id="hire-counted" name="counted" defaultValue="">
                    <option value="" disabled>Choisir…</option>
                    <option value="oui">Compté dans l'effectif</option>
                    <option value="non">Non compté (ex. stagiaire)</option>
                  </select>
                </Field>
                <Field id="hire-replaces" label="Remplace">
                  <select className="select" id="hire-replaces" name="replaces" defaultValue="">
                    <option value="">— (création de poste)</option>
                    {deps.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                  </select>
                </Field>
              </div>
            </ActionForm>
          </details>
          <details>
            <summary>Départ</summary>
            <ActionForm action={add("depart")} submit="Ajouter le départ" testid="hyp-form-depart">
              <div className="filters">
                <Text id="dep-label" name="label" label="Libellé" maxLength={200} required />
                <Field id="dep-contract" label="Contrat">
                  <select className="select" id="dep-contract" name="contractKey" defaultValue="">
                    <option value="" disabled>Choisir…</option>
                    {base.contracts.filter((c) => !departed.has(c.contractKey)).map((c) => <option key={c.contractKey} value={c.contractKey}>{c.label}</option>)}
                  </select>
                </Field>
                <Text id="dep-date" name="lastPaidDate" label="Dernier jour payé" type="date" required />
              </div>
              <p className="label">Coûts de sortie (mois du départ, facultatif)</p>
              <div className="filters"><AmountFields prefix="exit" idp="dep-exit" optional /></div>
            </ActionForm>
          </details>
          <details>
            <summary>Élément ponctuel (prime, régularisation…)</summary>
            <ActionForm action={add("ponctuel")} submit="Ajouter l'élément" testid="hyp-form-ponctuel">
              <div className="filters">
                <Text id="pon-label" name="label" label="Libellé" maxLength={200} required />
                <Text id="pon-month" name="month" label="Mois" type="month" min={scenario.firstMonth} max={scenario.lastMonth} required />
                <Field id="pon-service" label="Service">
                  <select className="select" id="pon-service" name="service" defaultValue="">
                    <option value="">Toute l'entreprise</option>
                    {services.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
              </div>
              <div className="filters"><AmountFields prefix="amount" idp="pon-amount" /></div>
            </ActionForm>
          </details>
        </section>
      ) : (
        <p className="desc">{scenario.status === "fige" ? "Scénario figé : dupliquez-le pour préparer une variante." : "Saisie réservée aux éditeurs et administrateurs."}</p>
      )}
    </>
  );
}
