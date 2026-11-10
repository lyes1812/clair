import { describe, expect, it } from "vitest";
import { buildActualGap, buildPayrollOrganisation, formatPayrollExplorationMoney, formatPayrollPercent, payrollExplorationAxes, type PayrollCell, type PayrollExplorationInput } from "@/lib/payroll/exploration";
import { monthPayroll, type Analytic, type LedgerLine } from "@/lib/payroll/engine";
import { DEFAULT_PREFIXES } from "@/lib/payroll/grid";

// Journal entièrement fictif ; références écrites à la main en centimes.
const A = ["2026-01", "2026-02"], B = ["2025-01", "2025-02"], SYNC = "lecture-fictive";
const analytic = (code: string | null, type: string | null = "Service", value: string | null = null): Analytic => ({ type, code, value });
function line(id: string, month = A[0], accountId = "641100", debitCents: number | null = 100, creditCents: number | null = null, analytics: Analytic[] = [analytic("A")], contractId: string | null = "C-1"): LedgerLine {
  return { key: `${month}#${id}`, month, accountId, accountName: `Libellé fictif ${accountId}`, debitCents, creditCents, analytic: analytics, contractId };
}
function input(lines = [line("salary")], months = [...A, ...B]): PayrollExplorationInput {
  return { source: "payfit", journal: { lines, months, openMonths: [], grid: structuredClone(DEFAULT_PREFIXES) }, read: { syncId: SYNC, readAt: "2026-03-05T12:00:00Z", closedMonths: [...months] },
    rh: { build: { source: "payfit", inputs: { source: "payfit", syncId: SYNC } },
      persons: [{ personKey: "payfit:P-1", familyName: "FICTIF", givenNames: "Alice", provenance: { familyName: { syncId: SYNC, collection: "collaborators", recordKey: "P-1", period: null, path: "lastName", label: "Photographie fictive" } } }],
      contracts: [{ contractKey: "payfit:C-1", externalId: "C-1", personKey: "payfit:P-1" }] }, unavailable: null };
}
const cents = (cell: PayrollCell) => { if (cell.kind !== "value") throw new Error(cell.reason); return cell.cents; };
function reference(): PayrollExplorationInput {
  return input([
    line("salary", A[0], "641100", 10000), line("bonus", A[0], "641300", 1000), line("intern", A[0], "641370", 500), line("indemnity", A[0], "641400", 250),
    line("charges", A[0], "645100", 3000), line("taxes", A[0], "631100", 500), line("cp", A[0], "641200", 1000), line("outside", A[0], "647600", 200), line("unclassified", A[0], "649999", 77), line("counterpart", A[0], "421000", null, 16527),
    line("salary", A[1], "641100", 20000), line("charges", A[1], "645100", 6000),
    line("salary", B[0], "641100", 8000), line("bonus", B[0], "641300", 500), line("charges", B[0], "645100", 2500),
    line("salary", B[1], "641100", 18000), line("charges", B[1], "645100", 5000),
  ]);
}
const organisation = (source = input(), months = [A[0]], axis: string | null = "Service") => buildPayrollOrganisation(source, { months, axis });

describe("Exploration de la masse : mêmes comptes et montants que la synthèse", () => {
  it("reproduit la grille, les trois totaux et garde hors-masse et non classés distincts", () => {
    const source = reference(), result = organisation(source, A);
    expect(result.kind).toBe("value");
    expect(Object.fromEntries(Object.entries(result.totals).map(([k, v]) => [k, cents(v)]))).toEqual({ brut: 31750, cotisations: 9500, masse: 41250, horsMasse: 1200, nonClasse: 77 });
    expect(result.lines).toHaveLength(11); expect(result.lines.some((l) => l.accountId === "421000")).toBe(false);
    for (const month of A) {
      const original = monthPayroll(source.journal!, month); if (original.kind !== "value") throw new Error("Référence fictive invalide");
      const actual = result.monthly.find((m) => m.month === month)!.totals;
      expect([cents(actual.brut), cents(actual.cotisations), cents(actual.masse)]).toEqual([original.brut, original.cotisations, original.masse]);
    }
  });
  it("respecte une grille paramétrée et le préfixe le plus long", () => {
    const source = input([line("base", A[0], "641100", 1000), line("override", A[0], "641110", 100)]);
    source.journal!.grid.primes = ["64111"];
    const result = organisation(source);
    expect(result.groups[0].accounts.find((a) => a.accountId === "641110")?.rubricKey).toBe("primes");
    expect(cents(result.totals.masse)).toBe(1100);
  });
  it("conserve le solde signé et le zéro explicite de la source", () => {
    const result = organisation(input([line("negative", A[0], "641100", 1023, 1478), line("zero", A[0], "641100", 0)]));
    expect(result.lines.map((l) => cents(l.amount))).toEqual([-455, 0]); expect(cents(result.totals.masse)).toBe(-455);
    expect(result.lines[1].amount).toMatchObject({ occurrences: 1 });
  });
  it("n.d. sans débit ni crédit ferme le mois et son détail, sans garder un sous-total trompeur", () => {
    const result = organisation(input([line("known"), line("missing", A[0], "641100", null)]));
    expect(result.kind).toBe("nd"); expect(result.totals.masse.kind).toBe("nd");
    expect(result.lines.every((l) => l.amount.kind === "nd")).toBe(true);
  });
  it("un zéro structurel conserve occurrences=0 dans un journal complet", () => {
    const result = organisation(input([line("salary")]));
    expect(result.totals.cotisations).toEqual({ kind: "value", cents: 0, occurrences: 0 });
    expect(result.notices.join(" ")).toContain("aucune occurrence");
  });
  it("garde les correspondances de contrat exactes et la provenance de chaque ligne", () => {
    const result = organisation(input([line("linked"), line("none", A[0], "645100", 40, null, [analytic("A")], null), line("orphan", A[0], "641100", 50, null, [analytic("A")], "C-old")]));
    expect(result.lines.map((l) => l.attachment)).toEqual(["linked", "no-contract", "unlinked"]);
    expect(result.lines[0]).toMatchObject({ personKey: "payfit:P-1", personLabel: "FICTIF Alice", contractKey: "payfit:C-1", provenance: { syncId: SYNC, recordKey: `${A[0]}#linked`, month: A[0] } });
    expect(result.groups[0].contracts).toHaveLength(3);
  });
  it("une photographie RH différente conserve tous les montants sans identité individuelle", () => {
    const source = input(); source.rh!.build!.inputs!.syncId = "different-sync";
    const result = organisation(source);
    expect(cents(result.totals.masse)).toBe(100); expect(result.lines[0].personKey).toBeNull(); expect(result.lines[0].attachment).toBe("unlinked");
    expect(result.notices.join(" ")).toContain("même lecture");
  });
});

describe("Organisation : regroupement analytique exhaustif et sans fractionnement", () => {
  it("attribue chaque ligne une fois et retrouve le global, Ambigu et Non ventilé compris", () => {
    const result = organisation(input([line("a", A[0], "641100", 10000), line("b", A[0], "641100", 5000, null, [analytic("B")]),
      line("none", A[0], "645100", 3000, null, []), line("ambiguous", A[0], "641100", 700, null, [analytic("A"), analytic("B")]), line("duplicate-code", A[0], "641100", 300, null, [analytic("A"), analytic("A")])]));
    expect(result.groups.map((g) => [g.label, g.kind, cents(g.totals.masse)])).toEqual([["A", "code", 10300], ["B", "code", 5000], ["Affectation ambiguë", "ambiguous", 700], ["Non ventilé", "unallocated", 3000]]);
    expect(result.groups.flatMap((g) => g.lineIds)).toHaveLength(5); expect(new Set(result.groups.flatMap((g) => g.lineIds)).size).toBe(5);
    expect(result.groups.reduce((s, g) => s + cents(g.totals.masse), 0)).toBe(19000); expect(cents(result.totals.masse)).toBe(19000);
    expect(result.lines.find((l) => l.id.endsWith("ambiguous"))?.analyticValues).toEqual(["A", "B"]);
  });
  it("ne confond pas les libellés métiers avec les groupes spéciaux", () => {
    const result = organisation(input([line("literal-none", A[0], "641100", 10, null, [analytic("Non ventilé")]), line("none", A[0], "641100", 20, null, []),
      line("literal-ambiguous", A[0], "641100", 30, null, [analytic("Affectation ambiguë")]), line("ambiguous", A[0], "641100", 40, null, [analytic("A"), analytic("B")])]));
    expect(result.groups).toHaveLength(4); expect(new Set(result.groups.map((g) => g.key)).size).toBe(4);
  });
  it("un code manquant parmi plusieurs affectations reste ambigu et n'utilise pas le premier", () => {
    const result = organisation(input([line("incomplete", A[0], "641100", 100, null, [analytic("A"), analytic(null)])]));
    expect(result.groups[0].kind).toBe("ambiguous"); expect(cents(result.groups[0].totals.masse)).toBe(100);
  });
  it("l'axe doit être explicitement choisi parmi ceux de la lecture", () => {
    expect(organisation(input(), [A[0]], null)).toMatchObject({ kind: "nd", groups: [] });
    expect(organisation(input(), [A[0]], "Manager inventé")).toMatchObject({ kind: "nd", groups: [] });
    const source = input([line("two", A[0], "641100", 100, null, [analytic("A", "Service"), analytic("Site X", "Site")])]);
    expect(organisation(source, [A[0]], "Site").groups[0].label).toBe("Site X");
  });
  it("les options d'axe et le moteur ignorent les axes présents uniquement sur les contreparties", () => {
    const source = input([line("salary", A[0], "641100", 100, null, [analytic("A", "Service")]), line("counterpart", A[0], "421000", null, 100, [analytic("X", "Axe contrepartie")])]);
    expect(payrollExplorationAxes(source)).toEqual(["Service"]);
    expect(organisation(source).axes).toEqual(payrollExplorationAxes(source));
    expect(organisation(source, [A[0]], "Axe contrepartie")).toMatchObject({ kind: "nd", groups: [] });
  });
  it("l'axe sans type et le libellé de secours restent des choix source explicites", () => {
    const source = input([line("no-type", A[0], "641100", 100, null, [analytic(null, null, "Valeur source")])]);
    const result = organisation(source, [A[0]], "(sans type)");
    expect(result.axes).toEqual(["(sans type)"]); expect(result.groups[0].label).toBe("Valeur source");
  });
});

describe("Clôture positive, calendrier de lecture et totaux stricts", () => {
  it("absence de not_completed ne signifie pas completed", () => {
    const source = input(); source.read!.closedMonths = [];
    const result = organisation(source); expect(result.kind).toBe("nd"); expect(result.reason).toContain("completed");
    expect(result.totals.masse.kind).toBe("nd");
  });
  it("une paie explicitement ouverte reste n.d. même avec une preuve de clôture contradictoire", () => {
    const source = input(); source.journal!.openMonths = [A[0]];
    expect(organisation(source).reason).toContain("non clôturée");
  });
  it("le calendrier de Paris fait foi, y compris au changement de mois UTC", () => {
    const source = input(); source.read!.readAt = "2026-01-30T23:30:00Z"; // 31 janvier à Paris, paie completed.
    expect(organisation(source).kind).toBe("value");
    source.read!.readAt = "2026-01-30T21:30:00Z";
    expect(organisation(source).reason).toContain("non terminé");
  });
  it("un mois futur et un mois hors scope ne deviennent pas zéro", () => {
    const source = input(); source.read!.readAt = "2025-12-31T10:00:00Z";
    expect(organisation(source).totals.masse.kind).toBe("nd");
    expect(organisation(input(), ["2024-01"]).reason).toContain("hors de la lecture");
  });
  it("le cumul refuse un mois absent, tout en gardant les autres mois lisibles", () => {
    const result = organisation(input([line("jan")]), A);
    expect(result.kind).toBe("nd"); expect(result.totals.masse.kind).toBe("nd");
    expect(cents(result.monthly[0].totals.masse)).toBe(100); expect(result.monthly[1].totals.masse.kind).toBe("nd");
    expect(result.groups[0].totals.masse.kind).toBe("nd");
  });
  it("source absente, lecture invalide et DSN chargé non extrait restent n.d.", () => {
    const source = input(); source.journal = null; source.unavailable = "Journal fictif indisponible";
    expect(organisation(source).reason).toBe("Journal fictif indisponible");
    const date = input(); date.read!.readAt = "invalid"; expect(organisation(date).kind).toBe("nd");
    const dsn = input(); dsn.source = "dsn"; expect(organisation(dsn).reason).toContain("DSN");
  });
  it("rejette période vide, trou, ordre inverse, doublons et mois invalide", () => {
    for (const months of [[], [A[1], A[0]], [A[0], A[0]], ["2026-01", "2026-03"], ["2026-99"]]) expect(organisation(input(), months).kind).toBe("nd");
  });
});

describe("Écart de deux périodes réelles", () => {
  it("calcule A−B par mois, rubrique, compte et contrat, avec le même total source", () => {
    const result = buildActualGap(reference(), { monthsA: A, monthsB: B });
    expect(result.kind).toBe("value"); expect(cents(result.totals.masse.a)).toBe(41250); expect(cents(result.totals.masse.b)).toBe(34000); expect(cents(result.totals.masse.delta)).toBe(7250);
    expect(result.monthly.map((m) => cents(m.totals.masse.delta))).toEqual([4250, 3000]);
    expect(result.rubrics.find((r) => r.key === "salaires")?.delta).toMatchObject({ kind: "value", cents: 4000 });
    expect(result.accounts.find((a) => a.accountId === "641100")?.delta).toMatchObject({ kind: "value", cents: 4000 });
    expect(cents(result.contracts[0].totals.masse.delta)).toBe(7250); expect(result.totals.masse.pct).toEqual({ num: "7250", den: "34000" });
  });
  it("les postes absents d'un journal complet valent zéro structurel avec occurrences0", () => {
    const result = buildActualGap(input([line("new", A[0], "641300", 100), line("old", B[0], "641100", 500)]), { monthsA: [A[0]], monthsB: [B[0]] });
    const prime = result.rubrics.find((r) => r.key === "primes")!;
    expect(prime.b).toEqual({ kind: "value", cents: 0, occurrences: 0 }); expect(prime.pct).toBeNull(); expect(cents(prime.delta)).toBe(100);
  });
  it("une référence nulle donne un écart connu et un pourcentage n.d.", () => {
    const result = buildActualGap(input([line("new", A[0], "641100", 100), line("zero", B[0], "641100", 0)]), { monthsA: [A[0]], monthsB: [B[0]] });
    expect(cents(result.totals.masse.delta)).toBe(100); expect(result.totals.masse.pct).toBeNull(); expect(result.totals.masse.pctReason).toContain("nulle");
  });
  it("un écart négatif et une référence négative conservent leurs signes algébriques", () => {
    const result = buildActualGap(input([line("new", A[0], "641100", 100), line("old", B[0], "641100", 200)]), { monthsA: [A[0]], monthsB: [B[0]] });
    expect(cents(result.totals.masse.delta)).toBe(-100); expect(result.totals.masse.pct).toEqual({ num: "-100", den: "200" });
    const negative = buildActualGap(input([line("new", A[0], "641100", -100), line("old", B[0], "641100", -200)]), { monthsA: [A[0]], monthsB: [B[0]] });
    expect(negative.totals.masse.pct).toEqual({ num: "-100", den: "200" });
  });
  it("compare les contrats par identifiant source, sans fusion d'homonymes ni contrat inventé", () => {
    const result = buildActualGap(input([line("new", A[0], "641100", 100), line("old", B[0], "641100", 200, null, [], "C-old")]), { monthsA: [A[0]], monthsB: [B[0]] });
    expect(result.contracts).toHaveLength(2);
    expect(result.contracts.find((c) => c.sourceContractId === "C-old")).toMatchObject({ attachment: "unlinked", contractKey: null, personKey: null });
    expect(result.contracts.reduce((s, c) => s + cents(c.totals.masse.delta), 0)).toBe(-100);
  });
  it("refuse des longueurs ou des rangs de mois différents", () => {
    expect(buildActualGap(reference(), { monthsA: A, monthsB: [B[0]] }).kind).toBe("nd");
    expect(buildActualGap(reference(), { monthsA: [A[0]], monthsB: [B[1]] }).reason).toContain("mêmes mois");
  });
  it("le mois manquant d'une période invalide son cumul et tous les écarts de rubrique", () => {
    const source = reference(); source.read!.closedMonths = source.read!.closedMonths.filter((m) => m !== B[1]);
    const result = buildActualGap(source, { monthsA: A, monthsB: B });
    expect(result.kind).toBe("nd"); expect(result.periodB.totals.masse.kind).toBe("nd");
    expect(result.rubrics.every((r) => r.delta.kind === "nd")).toBe(true);
    expect(cents(result.monthly[0].totals.masse.delta)).toBe(4250); expect(result.monthly[1].totals.masse.delta.kind).toBe("nd");
  });
});

describe("Précision et sérialisation", () => {
  it("refuse montant source, différence de ligne et somme mensuelle hors entier sûr", () => {
    for (const source of [input([line("unsafe", A[0], "641100", Number.MAX_SAFE_INTEGER + 1)]), input([line("difference", A[0], "641100", Number.MAX_SAFE_INTEGER, -1)]), input([line("max", A[0], "641100", Number.MAX_SAFE_INTEGER), line("one", A[0], "641100", 1)])]) {
      const result = organisation(source); expect(result.kind).toBe("nd"); expect(result.totals.masse.kind).toBe("nd");
    }
  });
  it("calcule les annulations en BigInt sans dépendre de l'ordre des lignes", () => {
    const ls = [line("large", A[0], "641100", Number.MAX_SAFE_INTEGER), line("one", A[0], "641100", 1), line("minus", A[0], "641100", -1)];
    expect(cents(organisation(input(ls)).totals.masse)).toBe(Number.MAX_SAFE_INTEGER);
    expect(cents(organisation(input([...ls].reverse())).totals.masse)).toBe(Number.MAX_SAFE_INTEGER);
  });
  it("refuse un cumul et un delta hors entier sûr, sans chiffre arrondi de remplacement", () => {
    const period = organisation(input([line("large", A[0], "641100", Number.MAX_SAFE_INTEGER), line("one", A[1], "641100", 1)]), A);
    expect(period.totals.masse.kind).toBe("nd");
    const gap = buildActualGap(input([line("large", A[0], "641100", Number.MAX_SAFE_INTEGER), line("negative", B[0], "641100", -1)]), { monthsA: [A[0]], monthsB: [B[0]] });
    expect(gap.totals.masse.delta.kind).toBe("nd"); expect(gap.totals.masse.pct).toBeNull();
  });
  it("formate centimes et ratios extrêmes sans division flottante ni signe zéro", () => {
    expect(formatPayrollExplorationMoney(Number.MAX_SAFE_INTEGER)).toBe("90 071 992 547 409,91 €");
    expect(formatPayrollPercent({ num: "1", den: "6" })).toBe("+16,67 %");
    expect(formatPayrollPercent({ num: "-1", den: "6" })).toBe("−16,67 %");
    expect(formatPayrollPercent({ num: "-1", den: "1000000000" })).toBe("0,00 %");
    expect(formatPayrollPercent({ num: "9007199254740991", den: "1" })).toBe("+900 719 925 474 099 100,00 %");
    expect(formatPayrollPercent({ num: "1", den: "0" })).toBe("n.d."); expect(formatPayrollPercent(null)).toBe("n.d.");
  });
  it("produit un DTO JSON réduit et ne modifie aucun journal, réglage ou référentiel", () => {
    const source = reference(), before = JSON.stringify(source);
    const org = organisation(source, A), gap = buildActualGap(source, { monthsA: A, monthsB: B });
    expect(JSON.parse(JSON.stringify(org))).toEqual(org); expect(JSON.parse(JSON.stringify(gap))).toEqual(gap); expect(JSON.stringify(source)).toBe(before);
    expect(JSON.stringify(org)).not.toContain("provenance\":{\"familyName");
    expect(gap.lines.map((l) => l.id).sort()).toEqual([...new Set(gap.lines.map((l) => l.id))].sort());
  });
});
