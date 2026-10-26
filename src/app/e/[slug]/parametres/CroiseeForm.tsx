"use client";
import { useActionState, useState, type ReactNode } from "react";
import type { CroiseeSettingKey, SeuilEffectif } from "@/lib/croisee-settings";
import { Feedback } from "./Feedback";
import { saveCroiseeSettings } from "./actions";

// Origine d'un réglage de la Masse salariale croisée : non défini, modifié (date déjà mise en forme par la page) ou illisible.
export type CroiseeOrigin = { kind: "absent" } | { kind: "set"; at: string | null } | { kind: "invalid" };
// Liens « ? » vers le glossaire, rendus par la page (composant serveur) : le glossaire n'est pas embarqué dans ce composant client.
export type CroiseeHelpKey = "confidentialite" | "seuilsEffectif" | "horizonEcheances";
export type CroiseeFormProps = {
  slug: string;
  // Valeurs en vigueur. null (ou liste vide) : le champ reste vide, jamais pré-rempli ni suggéré.
  values: { confidentialite: number | null; seuilsEffectif: SeuilEffectif[]; margeAlerte: number | null; horizonEcheances: number | null };
  origins: Record<CroiseeSettingKey, CroiseeOrigin>;
  limits: { seuilsMax: number; libelleMax: number }; // tailles de saisie (SEUILS_MAX, LIBELLE_MAX de src/lib/croisee-settings.ts)
  disabled: boolean;
  helps?: Partial<Record<CroiseeHelpKey, ReactNode>>;
};

const ORIGIN_IDS: Record<CroiseeSettingKey, string> = { confidentialite: "confidentialite", seuilsEffectif: "seuils", margeAlerte: "marge", horizonEcheances: "horizon" };

function Origin({ name, origin }: { name: CroiseeSettingKey; origin: CroiseeOrigin }) {
  const text = origin.kind === "set" ? `Modifié le ${origin.at ?? "n.d."} par un administrateur.` : origin.kind === "invalid" ? "Valeur enregistrée illisible : à ré-enregistrer." : "Non défini.";
  return (
    <span className="desc pm-origin" data-missing={origin.kind === "invalid" ? "true" : undefined} data-testid={`setting-croisee-origin-${ORIGIN_IDS[name]}`}>
      {text}
    </span>
  );
}

// Champ entier : vide tant que le réglage n'est pas défini (aucune valeur suggérée).
function IntField({ id, name, label, min, value, testid }: { id: string; name: string; label: string; min: number; value: number | null; testid: string }) {
  return (
    <div className="field-row pm-field-narrow">
      <label htmlFor={id}>{label}</label>
      <input className="input" id={id} name={name} type="number" min={min} step={1} inputMode="numeric" defaultValue={value ?? ""} autoComplete="off" data-testid={testid} />
    </div>
  );
}

// Tableau des seuils d'effectif suivis : une ligne par seuil (libellé + effectif). Sans seuil enregistré, une ligne vide à remplir.
// Les lignes ajoutées ou retirées restent dans le formulaire tant qu'il n'est pas enregistré ; une ligne vide est ignorée.
function SeuilsRows({ initial, disabled, max, libelleMax }: { initial: SeuilEffectif[]; disabled: boolean; max: number; libelleMax: number }) {
  const start = initial.length > 0 ? initial.map((s, i) => ({ id: i, libelle: s.libelle, valeur: String(s.valeur) })) : disabled ? [] : [{ id: 0, libelle: "", valeur: "" }];
  const [rows, setRows] = useState(start);
  const [next, setNext] = useState(start.length);
  const add = () => {
    setRows((r) => [...r, { id: next, libelle: "", valeur: "" }]);
    setNext((n) => n + 1);
  };
  return (
    <>
      <input type="hidden" name="seuils" value="1" />
      {rows.length > 0 && (
        <div className="table-wrap">
          <table className="data-table" data-testid="setting-croisee-seuils">
            <thead>
              <tr>
                <th scope="col">Libellé</th>
                <th scope="col">Effectif (salariés)</th>
                {!disabled && (
                  <th scope="col">
                    <span className="pm-vh">Retirer</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id}>
                  <td>
                    <input className="input" name="seuilLibelle" defaultValue={r.libelle} maxLength={libelleMax} autoComplete="off" aria-label={`Libellé du seuil ${i + 1}`} data-testid="setting-croisee-seuil-libelle" />
                  </td>
                  <td>
                    <input className="input" name="seuilValeur" type="number" min={1} step={1} inputMode="numeric" defaultValue={r.valeur} autoComplete="off" aria-label={`Effectif du seuil ${i + 1}`} data-testid="setting-croisee-seuil-valeur" />
                  </td>
                  {!disabled && (
                    <td>
                      <button type="button" className="btn small" onClick={() => setRows((all) => all.filter((x) => x.id !== r.id))} aria-label={`Retirer le seuil ${i + 1}`} data-testid="setting-croisee-seuil-remove">
                        Retirer
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!disabled && rows.length < max && (
        <div>
          <button type="button" className="btn small" onClick={add} data-testid="setting-croisee-seuil-add">
            Ajouter un seuil
          </button>
        </div>
      )}
    </>
  );
}

// Paramètres de la Masse salariale croisée : seuil de confidentialité, seuils d'effectif suivis et marge d'alerte, horizon des
// échéances de contrat. Aucune valeur par défaut : un champ vidé supprime le réglage. Lecture seule hors administrateurs.
export function CroiseeForm({ slug, values, origins, limits, disabled, helps = {} }: CroiseeFormProps) {
  const [state, action, pending] = useActionState(saveCroiseeSettings.bind(null, slug), undefined);
  return (
    <form className="form" action={action}>
      <Feedback state={state} testid="setting-croisee-status" />
      <p className="desc">Aucune valeur par défaut : un champ vidé supprime le réglage, qui redevient « non défini ».</p>
      <div className="pm-cols">
        <fieldset className="pm-card" disabled={disabled}>
          <legend className="label">Confidentialité{helps.confidentialite}</legend>
          <div className="pm-card-body">
            <div className="pm-item">
              <IntField id="croisee-confidentialite" name="confidentialite" label="Seuil de confidentialité (personnes)" min={1} value={values.confidentialite} testid="setting-croisee-confidentialite" />
              <Origin name="confidentialite" origin={origins.confidentialite} />
            </div>
          </div>
        </fieldset>

        <fieldset className="pm-card" disabled={disabled}>
          <legend className="label">Échéances de contrat{helps.horizonEcheances}</legend>
          <div className="pm-card-body">
            <div className="pm-item">
              <IntField id="croisee-horizon" name="horizonEcheances" label="Horizon des échéances (jours)" min={1} value={values.horizonEcheances} testid="setting-croisee-horizon" />
              <Origin name="horizonEcheances" origin={origins.horizonEcheances} />
            </div>
          </div>
        </fieldset>

        <fieldset className="pm-card pm-wide" disabled={disabled}>
          <legend className="label">Seuils d'effectif{helps.seuilsEffectif}</legend>
          <div className="pm-card-body">
            <div className="pm-item" role="group" aria-labelledby="croisee-seuils-title">
              <span className="pm-item-head">
                <span className="pm-item-title" id="croisee-seuils-title">Seuils d'effectif suivis</span>
              </span>
              <SeuilsRows key={JSON.stringify(values.seuilsEffectif)} initial={values.seuilsEffectif} disabled={disabled} max={limits.seuilsMax} libelleMax={limits.libelleMax} />
              <Origin name="seuilsEffectif" origin={origins.seuilsEffectif} />
            </div>
            <div className="pm-item">
              <IntField id="croisee-marge" name="margeAlerte" label="Marge d'alerte (salariés)" min={0} value={values.margeAlerte} testid="setting-croisee-marge" />
              <Origin name="margeAlerte" origin={origins.margeAlerte} />
            </div>
          </div>
        </fieldset>
      </div>

      {!disabled && (
        <div className="actions">
          <button className="btn primary" type="submit" disabled={pending} data-testid="setting-croisee-save">
            {pending ? "Enregistrement…" : "Enregistrer les paramètres de la croisée"}
          </button>
        </div>
      )}
    </form>
  );
}
