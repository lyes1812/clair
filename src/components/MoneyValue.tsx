"use client";

import { formatEuros } from "@/lib/money";
import { formatMoneyDisplay } from "@/lib/money-display";
import { useMoneyUnit } from "./CurrencyPreference";

export function Money({ cents, signed = false, exactText, keurDecimals = 0 }: { cents: number; signed?: boolean; exactText?: string; keurDecimals?: 0 | 1 }) {
  const unit = useMoneyUnit();
  return <span className="money-display" data-money-cents={cents} data-money-exact={exactText ?? `${signed && cents > 0 ? "+" : ""}${formatEuros(cents)}`}>{formatMoneyDisplay(cents, unit, signed, keurDecimals)}</span>;
}

export function MoneyUnitLabel() { return <>{useMoneyUnit() === "keur" ? "k€" : "€"}</>; }
