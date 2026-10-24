"use client";
import { useId, useState } from "react";
import { LineChart } from "@/components/charts";
import type { RubricChart } from "@/lib/viz/ecart";

// Courbes de l'écart budgétaire : une courbe par version, mois par mois, pour la rubrique choisie. Le choix de rubrique se fait
// sans recharger la page (toutes les rubriques sont déjà calculées côté serveur) ; il est reporté dans l'adresse pour pouvoir être
// partagé ou rechargé. Le tableau exact correspondant reste la référence : le graphique n'en est qu'une lecture.
export type EcartChartProps = {
  testid: string;
  initial: string;
  groups: { label: string; options: { key: string; label: string }[] }[];
  categories: string[];
  categoryTitles: string[];
  data: Record<string, RubricChart>;
  period: string; // « de janvier à décembre »
  scope: string; // « tous les services » / « service X »
};

export function EcartChart(p: EcartChartProps) {
  const uid = useId();
  const labels = new Map(p.groups.flatMap((g) => g.options.map((o) => [o.key, o.label] as const)));
  const first = p.groups[0]?.options[0]?.key ?? "";
  const [rub, setRub] = useState(p.data[p.initial] ? p.initial : first);
  const [zero, setZero] = useState(false);
  const d = p.data[rub];
  const label = labels.get(rub) ?? rub;

  const pick = (key: string) => {
    setRub(key);
    try {
      const u = new URL(window.location.href);
      u.searchParams.set("rub", key);
      window.history.replaceState(null, "", u);
    } catch {
      // Adresse non modifiable (aperçu, navigateur restreint) : le choix reste valable à l'écran.
    }
  };

  const drawn = d ? d.series.some((s) => s.values.some((v) => v !== null)) : false;
  const reasonsOf = (s: RubricChart["series"][number]) => {
    const all = [...new Set((s.reasons ?? []).filter((r): r is string => !!r))];
    return all.length ? `${all.slice(0, 2).join(" ; ")}${all.length > 2 ? " …" : ""}` : "valeur absente";
  };
  // Une version sans aucune valeur n'a pas de courbe : sa raison est écrite ici (l'infobulle ne la montre que pour un mois survolé).
  const empty = d ? d.series.filter((s) => s.values.every((v) => v === null)) : [];
  const partial = d ? d.series.map((s) => ({ name: s.name, n: s.values.filter((v) => v === null).length, all: s.values.length })).filter((x) => x.n > 0 && x.n < x.all) : [];
  // L'aire teintée sous un scénario n'est tracée que depuis zéro : sur un axe ajusté elle partirait du bas de l'axe et agrandirait
  // l'écart à l'œil.
  const series = d ? d.series.map((s) => (zero ? s : { ...s, area: false })) : [];
  const shaded = zero && series.some((s) => s.area);
  // Deux messages distincts : la lecture du graphique (au-dessus) et ses limites (en dessous, avec la mention d'axe du composant).
  const reading = `Trait plein : version 1 · pointillés : versions suivantes${shaded ? " · zone teintée : scénario" : ""}. Chaque point est la valeur du mois, chaque version étant lue sur sa propre année à rang de mois égal.`;
  const note = [
    "Le tableau donne la valeur de la période (moyenne des ETP de fin de mois, inscrits en fin de période, somme pour les entrées, les sorties et les montants), pas celle du mois.",
    partial.length ? `Mois sans valeur (n.d. ou rubrique sans objet ; courbe interrompue, raison au survol) : ${partial.map((x) => `${x.name} : ${x.n} mois`).join(" ; ")}.` : null,
    empty.length ? `Aucune valeur à tracer : ${empty.map((s) => `${s.name} (${reasonsOf(s)})`).join(" ; ")}.` : null,
  ].filter(Boolean).join(" ");

  return (
    <div className="ecart-chart" data-testid={`${p.testid}-zone`}>
      <div className="ecart-chart-controls">
        <div className="field-row">
          <label htmlFor={`${uid}-rub`}>Rubrique</label>
          <select className="select" id={`${uid}-rub`} value={rub} onChange={(e) => pick(e.target.value)} data-testid={`${p.testid}-rubrique`}>
            {p.groups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <label className="check">
          <input type="checkbox" checked={zero} onChange={(e) => setZero(e.target.checked)} />
          <span>Axe vertical à partir de zéro</span>
        </label>
      </div>
      {d && drawn && <p className="ecart-reading" data-testid={`${p.testid}-lecture`}>{reading}</p>}
      {d && drawn ? (
        <LineChart
          testid={p.testid}
          label={`${label}, ${p.period}, ${p.scope} : une courbe mensuelle par version comparée (${d.series.length})`}
          title={`${label} — par mois, ${p.period}`}
          categories={p.categories}
          categoryTitles={p.categoryTitles}
          series={series}
          unit={d.unit}
          zero={zero}
          note={note}
        />
      ) : (
        <div className="ecart-nd-block" data-testid={`${p.testid}-nd`}>
          <p className="nd">n.d. — aucune valeur à tracer pour « {label} » : chaque version est n.d. ou sans objet sur la période.</p>
          <ul className="list">
            {(d?.series ?? []).map((s) => <li key={s.key} className="desc">{s.name} : {reasonsOf(s)}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
