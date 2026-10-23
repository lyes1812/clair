"use client";
import { useState } from "react";
import type { HireProfile } from "@/lib/budget/bulk";
import { CATEGORY_IDS, CATEGORY_LABELS } from "@/lib/budget/types";
import { ActionForm } from "./ActionForm";
import type { FormState } from "./actions";

const Field = ({ id, label, children }: { id: string; label: string; children: React.ReactNode }) => <div className="field-row"><label htmlFor={id}>{label}</label>{children}</div>;

export function HireForm({ action, profiles, deps }: { action: (prev: FormState, f: FormData) => Promise<FormState>; profiles: HireProfile[]; deps: { id: string; label: string }[] }) {
  const [key, setKey] = useState("");
  const p = profiles.find((x) => x.key === key) ?? null;
  return (
    <ActionForm action={action} submit="Ajouter l'embauche" testid="hyp-form-embauche">
      <div className="filters">
        <Field id="hire-copy" label="Recopier le profil d'un salarié (facultatif)">
          <select className="select" id="hire-copy" value={key} onChange={(e) => setKey(e.target.value)} data-testid="hire-copy">
            <option value="">— saisie libre</option>
            {profiles.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
        </Field>
      </div>
      {p && <p className="tile-foot" data-testid="hire-copy-note">{p.note}</p>}
      <input type="hidden" name="copiedFrom" value={p?.key ?? ""} />
      {/* Les champs sont remontés à chaque changement de profil pour reprendre ses valeurs. */}
      <div className="filters" key={key}>
        <Field id="hire-label" label="Poste"><input className="input" id="hire-label" name="label" maxLength={200} required /></Field>
        <Field id="hire-count" label="Nombre de postes"><input className="input" id="hire-count" name="count" type="number" min={1} max={50} defaultValue={1} required /></Field>
        <Field id="hire-service" label="Centre de coûts (service)">
          <input className="input" id="hire-service" name="service" list="hyp-services" placeholder="Existant ou nouveau (vide : non ventilé)" maxLength={200} defaultValue={p?.service ?? ""} />
        </Field>
        <Field id="hire-category" label="Catégorie">
          <select className="select" id="hire-category" name="category" defaultValue={p?.category ?? ""}>
            <option value="" disabled>Choisir…</option>
            {CATEGORY_IDS.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </select>
        </Field>
        <Field id="hire-motif" label="Motif d'embauche (facultatif)"><input className="input" id="hire-motif" name="motif" list="hire-motifs" maxLength={100} /></Field>
        <Field id="hire-metier" label="Métier (facultatif)"><input className="input" id="hire-metier" name="metier" maxLength={100} /></Field>
        <Field id="hire-start" label="Premier jour payé"><input className="input" id="hire-start" name="start" type="date" required /></Field>
        <Field id="hire-end" label="Dernier jour payé (CDD, facultatif)"><input className="input" id="hire-end" name="end" type="date" /></Field>
        <Field id="hire-gross" label="Brut mensuel temps plein (€)"><input className="input" id="hire-gross" name="gross" inputMode="decimal" required defaultValue={p?.grossFullTime ?? ""} /></Field>
        <Field id="hire-quota" label="Quotité (%)"><input className="input" id="hire-quota" name="quota" inputMode="decimal" required defaultValue={p?.quotaPct ?? ""} /></Field>
        <Field id="hire-charges" label="Taux de charges (%)"><input className="input" id="hire-charges" name="charges" inputMode="decimal" required defaultValue={p?.chargesPct ?? ""} /></Field>
        <Field id="hire-counted" label="Effectif">
          <select className="select" id="hire-counted" name="counted" defaultValue={p?.counted === null || p === null ? "" : p.counted ? "oui" : "non"}>
            <option value="" disabled>Choisir…</option>
            <option value="oui">Compté dans l'effectif</option>
            <option value="non">Non compté (ex. stagiaire)</option>
          </select>
        </Field>
        <Field id="hire-replaces" label="Remplace (un seul poste)">
          <select className="select" id="hire-replaces" name="replaces" defaultValue="">
            <option value="">— (création de poste)</option>
            {deps.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        </Field>
      </div>
      <datalist id="hire-motifs"><option value="Création de poste" /><option value="Remplacement" /><option value="Accroissement temporaire d'activité" /><option value="Renfort saisonnier" /><option value="Stage" /><option value="Alternance" /></datalist>
    </ActionForm>
  );
}
