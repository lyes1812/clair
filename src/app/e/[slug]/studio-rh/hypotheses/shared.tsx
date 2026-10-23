import { cloneElement, isValidElement } from "react";
import { formatMonth } from "@/lib/dates";
import { formatEuros } from "@/lib/money";
import { hireKey } from "@/lib/budget/engine";
import { CATEGORY_LABELS, type Amount, type BaseSnapshot, type Hypothesis, type Scope } from "@/lib/budget/types";
import { fmtFixed } from "@/lib/rh/kpi/format";

// Éléments communs aux écrans de saisie du scénario : libellés, détail d'une hypothèse, champs de formulaire.
export const UNIT_LABEL = { eur: "montant en euros", pct: "taux en %", nombre: "nombre" } as const;
export const pct = (bps: number) => `${fmtFixed({ num: bps, den: 100 }, 2)} %`;
export const amountText = (a: Amount) => (a.mode === "brut" ? `${formatEuros(a.brutCents)} brut + charges ${pct(a.chargesBps)}` : `${formatEuros(a.costCents)} chargés`);
export const KIND = { augmentation: "Augmentation", embauche: "Embauche", depart: "Départ", ponctuel: "Élément ponctuel", absence: "Congé non payé", categorie: "Catégorie", realise: "Non récurrent réalisé", base: "Correction de base", enveloppe: "Enveloppe", constante: "Constante de référence", changement: "Changement" } as const;

export function scopeText(s: Scope, base: BaseSnapshot, hyps: Hypothesis[]) {
  if (s.kind === "global") return "toute l'entreprise (hors embauches et entrées après la base)";
  if (s.kind === "service") return `service ${s.service} (hors embauches et entrées après la base)`;
  if (s.kind === "statut") return `${s.executive ? "cadres dirigeants" : "hors cadres dirigeants"} (hors embauches et entrées après la base ; statut du référentiel Collaborateurs)`;
  const c = base.contracts.find((x) => x.contractKey === s.key);
  const h = hyps.find((x) => hireKey(x.id) === s.key);
  return `contrat : ${c?.label ?? h?.label ?? s.key}`;
}

export function detailOf(h: Hypothesis, base: BaseSnapshot, hyps: Hypothesis[]): string {
  const who = (key: string) => base.contracts.find((c) => c.contractKey === key)?.label ?? key;
  switch (h.kind) {
    case "augmentation":
      return `${h.rateBps > 0 ? "+" : ""}${pct(h.rateBps)} à compter de ${formatMonth(h.from).toLowerCase()} · ${scopeText(h.scope, base, hyps)}`;
    case "embauche": {
      const rep = h.replaces ? hyps.find((x) => x.id === h.replaces) : null;
      const copied = h.copiedFrom ? (base.contracts.find((c) => c.contractKey === h.copiedFrom)?.label ?? hyps.find((x) => hireKey(x.id) === h.copiedFrom)?.label ?? h.copiedFrom) : null;
      return `${h.service ?? "Non ventilé"}${h.category ? ` · ${CATEGORY_LABELS[h.category]}` : ""}${h.metier ? ` · ${h.metier}` : ""}${h.motif ? ` · motif : ${h.motif}` : ""} · du ${h.start}${h.end ? ` au ${h.end}` : ""} · ${formatEuros(h.grossFullTimeCents)} brut temps plein × ${pct(h.quotaBps)} · charges ${pct(h.chargesBps)} · ${h.counted ? "compté" : "non compté"} dans l'effectif${rep ? ` · remplace « ${rep.label} »` : ""}${copied ? ` · profil recopié de « ${copied} »` : ""}`;
    }
    case "depart":
      return `${who(h.contractKey)} · ${h.motif ? `${h.motif} · ` : ""}dernier jour payé ${h.lastPaidDate}${h.exitCost ? ` · coûts de sortie ${amountText(h.exitCost)}` : ""}`;
    case "ponctuel":
      return `${formatMonth(h.month)} · ${amountText(h.amount)} · ${h.service ?? "toute l'entreprise"}${h.nonRecurring ? " · non récurrent" : ""}`;
    case "absence":
      return `${who(h.contractKey)} · du ${h.from} au ${h.to} · payé à ${fmtFixed({ num: h.paidBps, den: 100 }, 0)} % du salaire`;
    case "categorie":
      return `${who(h.contractKey)} · ${CATEGORY_LABELS[h.category]}`;
    case "realise":
      return `${formatMonth(h.month)} · ${h.category} · ${formatEuros(h.costCents)} chargés, déjà en comptabilité (atterrissage retraité seulement)`;
    case "base":
      return `${who(h.contractKey)} · salaire ${formatEuros(h.salaryCents)} · charges ${pct(h.chargesBps)}`;
    case "enveloppe": {
      const total = Object.values(h.monthly).reduce((s, v) => s + v, 0);
      return `${h.axis === "service" ? "centre de coûts" : "rubrique"} ${h.target} · ${Object.keys(h.monthly).length} mois · total ${formatEuros(total)} ${h.chargesBps === null ? "chargés" : `brut + charges ${pct(h.chargesBps)}`}${h.nonRecurring ? " · non récurrent" : ""}`;
    }
    case "constante":
      return `${UNIT_LABEL[h.unit]} · ${Object.keys(h.values).length} mois · source : ${h.source || "n.d."} · sans effet sur le calcul`;
    case "changement": {
      const target = base.contracts.find((c) => c.contractKey === h.contractKey)?.label ?? hyps.find((x) => hireKey(x.id) === h.contractKey)?.label ?? h.contractKey;
      return `${target} · à compter de ${formatMonth(h.from).toLowerCase()}${h.service ? ` · service ${h.service}` : ""}${h.quotaBps !== undefined ? ` · quotité ${pct(h.quotaBps)}` : ""}${h.poste ? ` · poste ${h.poste}` : ""}`;
    }
  }
}

// Champ de formulaire : libellé, aide courte facultative (hors du libellé, reliée au champ par aria-describedby), champ.
export const Field = ({ id, label, hint, children }: { id: string; label: string; hint?: React.ReactNode; children: React.ReactNode }) => (
  <div className="field-row">
    <label htmlFor={id}>{label}</label>
    {hint && isValidElement<{ "aria-describedby"?: string }>(children) ? cloneElement(children, { "aria-describedby": `${id}-hint` }) : children}
    {hint ? <small className="hint" id={`${id}-hint`}>{hint}</small> : null}
  </div>
);
export const Text = ({ id, name, label, hint, ...rest }: { id: string; name: string; label: string; hint?: React.ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) => (
  <Field id={id} label={label} hint={hint}><input className="input" id={id} name={name} {...rest} /></Field>
);

// Groupe de champs d'un formulaire : intitulé, phrase d'aide, champs en ligne.
export const FieldGroup = ({ title, hint, children }: { title: string; hint?: React.ReactNode; children: React.ReactNode }) => (
  <fieldset className="hs-group">
    <legend>{title}</legend>
    {hint ? <p className="hint">{hint}</p> : null}
    <div className="filters">{children}</div>
  </fieldset>
);

export function AmountFields({ prefix, idp, optional }: { prefix: string; idp: string; optional?: boolean }) {
  return (
    <>
      <Field id={`${idp}-mode`} label="Saisie" hint="Brut + taux : charges = brut × taux. Coût chargé : montant tel quel, non ventilé.">
        <select className="select" id={`${idp}-mode`} name={`${prefix}Mode`} defaultValue={optional ? "aucun" : ""}>
          {optional ? <option value="aucun">Aucun</option> : <option value="" disabled>Choisir…</option>}
          <option value="brut">Brut + taux de charges</option>
          <option value="charge">Coût chargé (non ventilé)</option>
        </select>
      </Field>
      <Text id={`${idp}-brut`} name={`${prefix}Brut`} label="Brut (€)" inputMode="decimal" hint="Si la saisie est « Brut + taux »." />
      <Text id={`${idp}-taux`} name={`${prefix}Taux`} label="Taux de charges (%)" inputMode="decimal" hint="Ex. 42,5." />
      <Text id={`${idp}-cout`} name={`${prefix}Cout`} label="Coût chargé (€)" inputMode="decimal" hint="Si la saisie est « Coût chargé »." />
    </>
  );
}


// Valeurs de grille : entiers de centièmes → texte saisissable en français (« 3000,5 », « -1,25 ») sans passer par un flottant.
export const decText = (n: number | null | undefined) => {
  if (n === null || n === undefined) return "";
  const a = Math.abs(n);
  const frac = a % 100 === 0 ? "" : `,${String(a % 100).padStart(2, "0").replace(/0$/, "")}`;
  return `${n < 0 ? "-" : ""}${Math.floor(a / 100)}${frac}`;
};
