import { createElement as h, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MoneyText } from "@/components/Money";
import { CurrencyProvider, CurrencySwitch } from "@/components/CurrencyPreference";
import { formatMoneyDisplay, moneyTextTokens } from "@/lib/money-display";
import { formatEuros, toCents } from "@/lib/money";

const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, " ");
describe("montants : préférence de lecture sans arrondir les données", () => {
  it.each([
    [123456, "eur", "1 235 €"], [123449, "eur", "1 234 €"],
    [-123450, "eur", "−1 235 €"], [49, "eur", "0 €"], [-49, "eur", "0 €"],
    [123456789, "keur", "1 235 k€"], [149999, "keur", "1 k€"],
    [150000, "keur", "2 k€"], [-150000, "keur", "−2 k€"],
    [-49999, "keur", "0 k€"], [123450.1, "eur", "1 235 €"],
    [Number.MAX_SAFE_INTEGER, "eur", "90 071 992 547 410 €"],
  ] as const)("arrondit %s en %s", (cents, unit, expected) => {
    expect(plain(formatMoneyDisplay(cents, unit))).toBe(expected);
    expect(formatMoneyDisplay(cents, unit)).not.toContain(",");
  });
  it("supprime les signes d'un écart arrondi à zéro et conserve les inconnus", () => {
    expect(plain(formatMoneyDisplay(-1, "eur", true))).toBe("0 €");
    expect(plain(formatMoneyDisplay(1, "keur", true))).toBe("0 k€");
    expect(plain(formatMoneyDisplay(150000, "keur", true))).toBe("+2 k€");
    expect(formatMoneyDisplay(NaN, "eur")).toBe("n.d.");
  });
  it("préserve le parseur de saisie et le format exact utilisé par les exports", () => {
    expect(toCents("1 234,56")).toBe(123456);
    expect(plain(formatEuros(123456))).toBe("1 234,56 €");
    formatMoneyDisplay(123456, "keur");
    expect(plain(formatEuros(123456))).toBe("1 234,56 €");
  });
});

describe("adaptation des chaînes monétaires existantes", () => {
  it("reconnaît les espaces françaises, les écarts signés et les bornes sans interpréter les autres indicateurs", () => {
    const tokens = moneyTextTokens("≥ 1\u202f234,56 € · +2 000,00 € · −40,00 € · 21,33 ETP · 3,45 % · 641");
    expect(tokens.filter((x) => x.cents !== undefined).map((x) => [x.cents, x.signed])).toEqual([[123456, false], [200000, true], [-4000, false]]);
    expect(tokens.at(-1)?.text).toBe(" · 21,33 ETP · 3,45 % · 641");
  });
  it("laisse les formats hors domaine, les inconnus et les nombres hors borne intacts", () => {
    for (const text of ["n.d.", "12,4 %", "2026-09", "1.234,56 €", "10000000000000000,00 €", "4 k€", "1,234.56 €"]) {
      expect(moneyTextTokens(text)).toEqual([{ text }]);
    }
  });
  it("adapte les cellules et phrases mais garde les attributs, champs et valeurs d'export exacts", () => {
    const html = renderToStaticMarkup(h(MoneyText, null, h(Fragment, null,
      h("p", { title: "1 234,56 €" }, "Budget : 1 234,56 € ; 21,33 ETP"),
      h("input", { defaultValue: "1234,56", "aria-label": "Montant €" }),
      h("textarea", { defaultValue: "1 234,56 €" }),
      h("select", null, h("option", { value: "123456" }, "1 234,56 €")),
      h("span", null, "n.d."),
    )));
    expect(html).toContain('title="1 234,56 €"');
    expect(html).toContain('data-money-cents="123456" data-money-exact="1 234,56 €"');
    expect(plain(html)).toContain("1 235 €</span> ; 21,33 ETP");
    expect(html).toContain('value="1234,56"');
    expect(html).toContain('<textarea>1 234,56 €</textarea>');
    expect(html).toContain('<option value="123456">1 234,56 €</option>');
    expect(html).not.toContain("data-money-cents=\"0\"");
  });
  it("sert le même défaut € au rendu initial et propose les deux choix accessibles", () => {
    const html = renderToStaticMarkup(h(CurrencyProvider, null, h(CurrencySwitch)));
    expect(html).toContain('aria-label="Affichage des montants"');
    expect(html).toContain('aria-pressed="true">€</button>');
    expect(html).toContain('aria-pressed="false">k€</button>');
  });
  it("reste idempotent avec plusieurs adaptateurs et traverse les children d'un composant de mise en page", () => {
    function Layout({ children }: { children?: React.ReactNode }) { return h("section", null, h(MoneyText, null, children)); }
    const html = renderToStaticMarkup(h(MoneyText, null, h(Layout, null, h(MoneyText, null, "1 234,56 €"), " · 2 345,67 €")));
    expect(html.match(/data-money-cents=/g)).toHaveLength(2);
    expect(plain(html)).toContain("2 346 €");
  });
});
