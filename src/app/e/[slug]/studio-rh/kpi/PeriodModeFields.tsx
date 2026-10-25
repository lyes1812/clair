"use client";

import { useState } from "react";

type Option = { value: string; label: string };
export type PeriodModeFieldsProps = {
  initialMode: "glissant" | "civil";
  initialEnd: string;
  initialYear: string;
  ends: Option[];
  years: Option[];
};

/** Une période visible, les deux choix conservés dans le formulaire GET. */
export function PeriodModeFields({ initialMode, initialEnd, initialYear, ends, years }: PeriodModeFieldsProps) {
  const [mode, setMode] = useState(initialMode);
  const [end, setEnd] = useState(initialEnd);
  const [year, setYear] = useState(initialYear);
  return (
    <>
      <div className="field-row">
        <label htmlFor="mode">Période</label>
        <select className="select" id="mode" name="mode" value={mode} onChange={(event) => setMode(event.target.value === "civil" ? "civil" : "glissant")}>
          <option value="glissant">12 mois glissants</option>
          <option value="civil">Année civile</option>
        </select>
      </div>
      {mode === "glissant" ? (
        <>
          <div className="field-row">
            <label htmlFor="fin">Fin des 12 mois glissants</label>
            <select className="select" id="fin" name="fin" value={end} onChange={(event) => setEnd(event.target.value)}>
              {ends.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          <input type="hidden" name="annee" value={year} />
        </>
      ) : (
        <>
          <input type="hidden" name="fin" value={end} />
          <div className="field-row">
            <label htmlFor="annee">Année civile</label>
            <select className="select" id="annee" name="annee" value={year} onChange={(event) => setYear(event.target.value)}>
              {years.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
        </>
      )}
    </>
  );
}
