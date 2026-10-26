import { describe, expect, it } from "vitest";
import { amountGap, CHARGES_LABELS, chargesOfWindow, chargesPersonnel, sumAmounts, type Amount } from "@/lib/croisee/charges-personnel";
import { windowPayroll, type JournalInput, type LedgerLine } from "@/lib/payroll/engine";
import { DEFAULT_PREFIXES, type RubricId } from "@/lib/payroll/grid";

// Passage de la masse chargée aux charges de personnel (Masse salariale croisée, chapitre 07). Montants fictifs écrits à la main, en
// centimes ; chaque résultat attendu est calculé à la main (commentaires).

const REF: Record<RubricId, number> = {
  salaires: 300000, // 3 000,00 €
  primes: 50000, // 500,00 €
  stages: 10000, // 100,00 €
  indemnites: 5000, // 50,00 €
  cotisations: 120000, // 1 200,00 €
  taxes: 8000, // 80,00 €
  "provisions-cp": -4500, // reprise nette : −45,00 €
  "autres-charges": 7000, // 70,00 €
};

describe("chargesPersonnel : cas de référence", () => {
  it("brut 3 650 €, cotisations et taxes 1 280 €, masse 4 930 €, hors masse 25 €, charges de personnel 4 955 €", () => {
    const p = chargesPersonnel(REF);
    // Brut = 3 000 + 500 + 100 + 50 = 3 650 € ; cotisations = 1 200 + 80 = 1 280 € ; masse = 4 930 € ;
    // hors masse = −45 + 70 = 25 € ; total = 4 930 + 25 = 4 955 €.
    expect(p.brut).toBe(365000);
    expect(p.cotisations).toBe(128000);
    expect(p.masse).toBe(493000);
    expect(p.horsMasse).toBe(2500);
    expect(p.total).toBe(495500);
  });

  it("lignes dans l'ordre de la grille : rubriques, sous-totaux, total ; la somme des lignes de rubrique est égale au total", () => {
    const p = chargesPersonnel(REF);
    expect(p.lines.map((l) => [l.key, l.kind])).toEqual([
      ["salaires", "rubrique"],
      ["primes", "rubrique"],
      ["stages", "rubrique"],
      ["indemnites", "rubrique"],
      ["brut", "sous-total"],
      ["cotisations", "rubrique"],
      ["taxes", "rubrique"],
      ["cotisations", "sous-total"],
      ["masse", "sous-total"],
      ["provisions-cp", "rubrique"],
      ["autres-charges", "rubrique"],
      ["total", "total"],
    ]);
    expect(p.lines.find((l) => l.kind === "total")!.label).toBe(CHARGES_LABELS.total);
    expect(p.lines[0].label).toBe("Salaires et appointements");
    const rubriques = p.lines.filter((l) => l.kind === "rubrique").map((l) => l.amount as number);
    expect(rubriques.reduce((s, v) => s + v, 0)).toBe(p.total);
    // Sous-totaux : masse = brut + cotisations ; total = masse + rubriques hors masse.
    expect(p.lines.find((l) => l.key === "masse")!.amount).toBe(365000 + 128000);
  });

  it("une rubrique n.d. rend n.d. ses sous-totaux et le total, jamais une somme partielle ; les autres restent connus", () => {
    const p = chargesPersonnel({ ...REF, primes: { nd: "primes non lues" } });
    expect(p.brut).toEqual({ nd: "primes non lues" });
    expect(p.masse).toEqual({ nd: "primes non lues" });
    expect(p.total).toEqual({ nd: "primes non lues" });
    expect(p.cotisations).toBe(128000);
    expect(p.horsMasse).toBe(2500);
    expect(p.lines.find((l) => l.key === "salaires")!.amount).toBe(300000);
    // Rubrique hors masse n.d. : la masse reste connue, le total ne l'est pas.
    const q = chargesPersonnel({ ...REF, "autres-charges": { nd: "autres non lues" } });
    expect(q.masse).toBe(493000);
    expect(q.total).toEqual({ nd: "autres non lues" });
  });

  it("fenêtre n.d. : chaque rubrique et le total portent la raison de la fenêtre", () => {
    const p = chargesOfWindow({ kind: "nd", reason: "janv. 2025 : mois hors de la lecture PayFit appliquée" });
    for (const l of p.lines) expect(l.amount).toEqual({ nd: "janv. 2025 : mois hors de la lecture PayFit appliquée" });
  });

  it("sumAmounts et amountGap : raisons distinctes, liste vide = 0, écart n.d. si l'un des deux l'est", () => {
    expect(sumAmounts([])).toBe(0);
    expect(sumAmounts([100, { nd: "a" }, { nd: "a" }, { nd: "b" }])).toEqual({ nd: "a ; b" });
    expect(amountGap(495500, 480000)).toBe(15500);
    expect(amountGap(480000, 495500)).toBe(-15500);
    expect(amountGap({ nd: "x" }, 1)).toEqual({ nd: "période n.d. (x)" });
    expect(amountGap(1, { nd: "y" } as Amount)).toEqual({ nd: "N-1 n.d. (y)" });
  });
});

describe("chargesOfWindow : mêmes soldes que le moteur du journal de paie", () => {
  // Journal fictif d'un mois (grille par défaut) : salaires 641100 1 000 € ; prime 641300 100 € ; cotisations 645000 400 € ;
  // taxe 631000 20 € ; dotation de provision 641200 60 € et reprise 641200 −50 € (crédit) ; titres-restaurant 647600 30 € ;
  // compte 649100 non classé 5 € (hors passage) ; contrepartie 421000 ignorée.
  const ln = (key: string, accountId: string, debit: number | null, credit: number | null = null): LedgerLine => ({ key, month: "2026-01", accountId, accountName: null, debitCents: debit, creditCents: credit, contractId: null });
  const input: JournalInput = {
    lines: [ln("a", "641100", 100000), ln("b", "641300", 10000), ln("c", "645000", 40000), ln("d", "631000", 2000), ln("e", "641200", 6000), ln("f", "641200", null, 5000), ln("g", "647600", 3000), ln("h", "649100", 500), ln("i", "421000", null, 156000)],
    months: ["2026-01"],
    openMonths: [],
    grid: DEFAULT_PREFIXES,
  };
  it("masse du passage = masse du moteur ; total = masse + provisions + autres charges, sans le compte non classé", () => {
    const w = windowPayroll(input, ["2026-01"]);
    expect(w.kind).toBe("value");
    if (w.kind !== "value") return;
    const p = chargesOfWindow(w);
    // Brut = 1 000 + 100 = 1 100 € ; cotisations = 400 + 20 = 420 € ; masse = 1 520 € ; provisions = 60 − 50 = 10 € ; autres = 30 € ;
    // total = 1 520 + 10 + 30 = 1 560 € (le compte 649100, non classé, n'y est pas).
    expect(p.masse).toBe(w.masse);
    expect(p.masse).toBe(152000);
    expect(p.brut).toBe(w.brut);
    expect(p.lines.find((l) => l.key === "provisions-cp")!.amount).toBe(1000);
    expect(p.total).toBe(156000);
  });
});
