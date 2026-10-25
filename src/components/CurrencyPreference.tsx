"use client";

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import type { MoneyDisplayUnit } from "@/lib/money-display";

const STORAGE_KEY = "clair-money-unit";
const CHANGE_EVENT = "clair-money-unit-change";
let fallback: MoneyDisplayUnit = "eur";
const CurrencyContext = createContext<MoneyDisplayUnit>("eur");

function current(): MoneyDisplayUnit {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "keur" ? "keur" : "eur";
  } catch {
    return fallback;
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

function choose(unit: MoneyDisplayUnit) {
  fallback = unit;
  try { window.localStorage.setItem(STORAGE_KEY, unit); } catch { /* La lecture reste utilisable sans stockage local. */ }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const unit = useSyncExternalStore(subscribe, current, () => "eur" as const);
  return <CurrencyContext.Provider value={unit}>{children}</CurrencyContext.Provider>;
}

export function useMoneyUnit(): MoneyDisplayUnit { return useContext(CurrencyContext); }

export function CurrencySwitch() {
  const unit = useMoneyUnit();
  return (
    <div className="table-density money-unit-switch" role="group" aria-label="Affichage des montants" title="Montants arrondis à l'écran ; saisies et exports au centime.">
      <button type="button" aria-pressed={unit === "eur"} onClick={() => choose("eur")}>€</button>
      <button type="button" aria-pressed={unit === "keur"} onClick={() => choose("keur")}>k€</button>
    </div>
  );
}
