"use client";

import { Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ChangeEvent, type ReactNode, type SelectHTMLAttributes } from "react";

export type SelectChoice = { value: string; label: string; disabled?: boolean; title?: string; group?: string };
type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, "children" | "multiple" | "defaultValue" | "value"> & {
  options: SelectChoice[];
  searchLabel: string;
  defaultValue?: string | number;
  value?: string | number;
  "data-testid"?: string;
};

const normalize = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("fr").trim();
export function matchingChoices(options: SelectChoice[], query: string): SelectChoice[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  return words.length ? options.filter((option) => words.every((word) => normalize(`${option.label} ${option.group ?? ""}`).includes(word))) : options;
}

/** Un filtre de lecture ne retire jamais le choix courant ni l'option de remise à zéro. */
export function visibleChoices(options: SelectChoice[], query: string, selected: string, initial?: string): SelectChoice[] {
  const matches = new Set(matchingChoices(options, query));
  return options.filter((option) => matches.has(option) || option.value === selected || option.value === initial || option.value === "");
}

function optionNodes(options: SelectChoice[]): ReactNode[] {
  const nodes: ReactNode[] = [];
  const option = (item: SelectChoice) => <option key={item.value} value={item.value} disabled={item.disabled} title={item.title}>{item.label}</option>;
  for (let index = 0; index < options.length;) {
    const item = options[index];
    if (!item.group) { nodes.push(option(item)); index++; continue; }
    const group = item.group;
    const members: ReactNode[] = [];
    const start = index;
    while (index < options.length && options[index].group === group) members.push(option(options[index++]));
    nodes.push(<optgroup key={`${start}-${group}`} label={group}>{members}</optgroup>);
  }
  return nodes;
}

/** Recherche locale optionnelle ; la sélection reste native et soumet exactement le champ existant. */
export function SearchableSelect({ options, searchLabel, defaultValue = "", value, onChange, ...props }: Props) {
  const [localValue, setLocalValue] = useState(String(defaultValue));
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const select = useRef<HTMLSelectElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const uid = useId();
  const inputId = `${uid}-search`;
  const statusId = `${uid}-results`;
  const selected = value === undefined ? localValue : String(value);
  const canSearch = options.length >= 8;
  const shown = canSearch ? visibleChoices(options, query, selected, value === undefined ? String(defaultValue) : undefined) : options;
  const found = matchingChoices(options, query).filter((option) => !option.disabled && option.value !== "").length;

  useEffect(() => { setLocalValue(String(defaultValue)); setQuery(""); setOpen(false); }, [defaultValue]);
  useEffect(() => { if (open) search.current?.focus(); }, [open]);
  useEffect(() => {
    const form = select.current?.form;
    if (!form) return;
    const reset = () => { if (value === undefined) setLocalValue(String(defaultValue)); setQuery(""); setOpen(false); };
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, [defaultValue, value]);

  const choose = (event: ChangeEvent<HTMLSelectElement>) => {
    if (value === undefined) setLocalValue(event.currentTarget.value);
    onChange?.(event);
  };
  // Les formulaires existants restaurent leur saisie après un refus : garder leur sélecteur natif non contrôlé.
  const nativeValue = value === undefined ? { defaultValue: String(defaultValue) } : { value: String(value) };
  const control = <select {...props} {...nativeValue} ref={select} onChange={choose}
    aria-describedby={[props["aria-describedby"], open && query ? statusId : null].filter(Boolean).join(" ") || undefined}>
    {optionNodes(shown)}
  </select>;
  if (!canSearch) return control;

  return <div className="filter-choice">
    <div className="filter-choice-control">
      {control}
      <button ref={button} type="button" className="btn filter-choice-toggle" disabled={props.disabled}
        aria-label={`Rechercher : ${searchLabel}`} aria-expanded={open} aria-controls={inputId}
        title={`Rechercher : ${searchLabel}`} onClick={() => { setOpen(!open); setQuery(""); }}>
        <Search size={15} aria-hidden="true" />
      </button>
    </div>
    {open && <div className="filter-choice-search">
      <div className="filter-choice-query">
        <input ref={search} id={inputId} className="input" type="search" value={query} maxLength={80} autoComplete="off"
          aria-label={`Rechercher : ${searchLabel}`} aria-describedby={statusId} placeholder="Rechercher…" disabled={props.disabled}
          onChange={(event) => { if (value === undefined && select.current) setLocalValue(select.current.value); setQuery(event.currentTarget.value); }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter") event.preventDefault();
            if (event.key === "Escape") { event.preventDefault(); setQuery(""); setOpen(false); button.current?.focus(); }
          }} />
        <button type="button" className="btn filter-choice-clear" aria-label={`Fermer la recherche : ${searchLabel}`}
          onClick={() => { setQuery(""); setOpen(false); button.current?.focus(); }}><X size={14} aria-hidden="true" /></button>
      </div>
      <p id={statusId} className="hint" role="status">{query.trim() ? `${found} résultat${found > 1 ? "s" : ""} · choix conservés` : "Saisis un nom, puis choisis dans la liste."}</p>
    </div>}
  </div>;
}
