"use client";

import { useEffect, useSyncExternalStore } from "react";

type Density = "comfort" | "compact";
const STORAGE_KEY = "clair-table-density";
const CHANGE_EVENT = "clair-table-density-change";

function currentDensity(): Density {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "compact" ? "compact" : "comfort";
  } catch {
    return document.documentElement.dataset.tableDensity === "compact" ? "compact" : "comfort";
  }
}

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

function chooseDensity(density: Density) {
  document.documentElement.dataset.tableDensity = density;
  try {
    window.localStorage.setItem(STORAGE_KEY, density);
  } catch {
    // Une préférence visuelle reste utilisable quand le stockage local est bloqué.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Préférence de lecture commune aux tableaux ; ne change ni les lignes ni les exports. */
export function TableDensity() {
  const density = useSyncExternalStore(subscribe, currentDensity, () => "comfort" as const);
  useEffect(() => {
    document.documentElement.dataset.tableDensity = density;
  }, [density]);

  return (
    <div className="table-density" role="group" aria-label="Densité des tableaux">
      <button type="button" aria-pressed={density === "comfort"} onClick={() => chooseDensity("comfort")}>Confort</button>
      <button type="button" aria-pressed={density === "compact"} onClick={() => chooseDensity("compact")}>Compact</button>
    </div>
  );
}
