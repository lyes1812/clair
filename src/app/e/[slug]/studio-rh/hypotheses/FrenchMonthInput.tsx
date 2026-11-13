"use client";
import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { isMonth } from "@/lib/connectors/months";

const MONTH_LABELS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"] as const;
type Props = Pick<InputHTMLAttributes<HTMLInputElement>, "name" | "required" | "disabled" | "readOnly" | "form" | "className" | "aria-describedby" | "aria-labelledby" | "aria-label"> & { id: string; defaultValue: string };

export function monthFromParts(year: string, month: string): string {
  const value = `${year}-${month}`;
  return /^\d{4}$/.test(year) && isMonth(value) ? value : "";
}

// Un choix entièrement français, au clavier comme à l’écran ; seul le mois ISO attendu par le serveur est soumis.
export function FrenchMonthInput({ id, name, defaultValue, required, disabled, readOnly, form, className, "aria-describedby": describedBy, "aria-labelledby": labelledBy, "aria-label": label }: Props) {
  const initial = isMonth(defaultValue) ? defaultValue.split("-") : ["", ""];
  const [year, setYear] = useState(initial[0]);
  const [month, setMonth] = useState(initial[1]);
  const monthControl = useRef<HTMLSelectElement>(null);
  const yearControl = useRef<HTMLInputElement>(null);
  const value = monthFromParts(year, month);
  const hintId = `${id}-fr`;
  const description = [describedBy, hintId].filter(Boolean).join(" ");
  useEffect(() => {
    monthControl.current?.setCustomValidity(year && !month ? "Choisis un mois." : "");
    yearControl.current?.setCustomValidity(month && !year ? "Renseigne une année." : year && !/^\d{4}$/.test(year) ? "Saisis une année sur quatre chiffres." : "");
  }, [month, year]);
  return <>
    <div className="hs-month-picker">
      <select ref={monthControl} className="select" id={id} lang="fr" form={form} value={month} required={required} disabled={disabled || readOnly} aria-describedby={description} aria-labelledby={labelledBy} aria-label={label} onChange={(event) => setMonth(event.target.value)}>
        <option value="">Choisir le mois…</option>
        {MONTH_LABELS.map((text, index) => <option key={text} value={String(index + 1).padStart(2, "0")}>{text}</option>)}
      </select>
      <div className="hs-month-year"><label htmlFor={`${id}-year`}>Année</label><input ref={yearControl} className={["input", className].filter(Boolean).join(" ")} id={`${id}-year`} type="number" inputMode="numeric" min={0} max={9999} step={1} form={form} value={year} required={required} disabled={disabled} readOnly={readOnly} aria-describedby={description} onChange={(event) => setYear(event.target.value)} /></div>
    </div>
    <input type="hidden" name={name} form={form} value={value} disabled={disabled} />
    <small className="hint hs-month-fr" id={hintId} aria-live="polite">{value ? `${MONTH_LABELS[Number(month) - 1]} ${year}` : "Choisir un mois et une année"}</small>
  </>;
}
