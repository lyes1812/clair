"use client";

import { useState } from "react";
import { DropdownMenu } from "@/components/DropdownMenu";

type ComparisonOption = { value: string; label: string };

export function ComparisonPicker({ options, selected }: { options: ComparisonOption[]; selected: string[] }) {
  const [chosen, setChosen] = useState(() => new Set(options.filter((option) => selected.includes(option.value)).map((option) => option.value)));
  const count = chosen.size;
  return (
    <DropdownMenu
      testid="cmp-picker"
      className="comparison-picker"
      label={<>Comparer avec <span className="ui-dropdown-count" data-testid="cmp-selected-count">{count} sélectionnée{count > 1 ? "s" : ""}</span></>}
    >
      <fieldset className="checks">
        <legend className="label">Comparer avec (3 lectures au plus)</legend>
        {options.map((option) => (
          <label key={option.value} className="check">
            <input
              type="checkbox"
              name="cmp"
              value={option.value}
              checked={chosen.has(option.value)}
              disabled={count >= 3 && !chosen.has(option.value)}
              data-testid={`cmp-opt-${option.value}`}
              onChange={(event) => {
                const checked = event.currentTarget.checked;
                setChosen((current) => {
                  const next = new Set(current);
                  if (checked && next.size < 3) next.add(option.value);
                  else if (!checked) next.delete(option.value);
                  return next;
                });
              }}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </fieldset>
    </DropdownMenu>
  );
}
