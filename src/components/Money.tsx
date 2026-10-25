import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { moneyTextTokens } from "@/lib/money-display";
import { Money } from "./MoneyValue";

export { Money, MoneyUnitLabel } from "./MoneyValue";

const untouched = new Set(["input", "textarea", "select", "option", "script", "style", "svg"]);

/** Adapte les chaînes monétaires des vues, sans lire le DOM ni modifier de prop numérique. */
export function MoneyText({ children }: { children: ReactNode }): ReactNode {
  return adapt(children);
}

function adapt(child: ReactNode): ReactNode {
  if (Array.isArray(child)) return Children.map(child, adapt);
  if (typeof child === "string") {
    const tokens = moneyTextTokens(child);
    if (tokens.length === 1 && tokens[0].cents === undefined) return child;
    return tokens.map((token, index) => token.cents === undefined
      ? token.text
      : <Money key={index} cents={token.cents} signed={token.signed} exactText={token.text} />);
  }
  if (!isValidElement<{ children?: ReactNode }>(child) || child.type === MoneyText || child.type === Money || untouched.has(String(child.type)) || child.props.children === undefined) return child;
  // Préserver les enfants directs, notamment Field qui annote son input avec aria-describedby.
  return cloneElement(child as ReactElement<{ children?: ReactNode }>, { children: adapt(child.props.children) });
}
