"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

/** Divulgation native : liens et champs restent accessibles au clavier, sans recréer un menu métier. */
export function DropdownMenu({ label, children, testid, className = "" }: { label: ReactNode; children: ReactNode; testid?: string; className?: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOutside = (event: MouseEvent) => {
      if (ref.current?.open && !ref.current.contains(event.target as Node)) ref.current.open = false;
    };
    document.addEventListener("mousedown", closeOutside);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
    };
  }, []);
  return (
    <details ref={ref} className={`ui-dropdown ${className}`.trim()} data-testid={testid} onKeyDown={(event) => {
      if (event.key !== "Escape" || !event.currentTarget.open) return;
      event.currentTarget.open = false;
      event.currentTarget.querySelector("summary")?.focus();
      event.stopPropagation();
    }}>
      <summary className="btn">{label}<ChevronDown size={14} aria-hidden="true" /></summary>
      <div className="ui-dropdown-panel" onClick={(event) => {
        if ((event.target as Element).closest("a[href],button[data-dropdown-close]") && ref.current) ref.current.open = false;
      }}>{children}</div>
    </details>
  );
}
