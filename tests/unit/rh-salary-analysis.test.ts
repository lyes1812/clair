import { describe, expect, it } from "vitest";
import type { PayrollItemRow, PayrollItemsModel } from "@/lib/rh/payroll-items";
import { salaryAnalysis } from "@/lib/rh/salary-analysis";

// Toutes les occurrences sont fictives ; les résultats sont calculés à la main.
const row = (id: string, cents: number | null, person = "person-a", contract = "contract-a", rubricKey = "salaires"): PayrollItemRow => ({
  id, attachment: "linked", personKey: person, personLabel: "Fictif", contractKey: contract, contractLabel: "Contrat fictif",
  rubricKey, rubricLabel: "Rubrique fictive", amount: cents === null ? { kind: "nd", reason: "Montant absent fictif." } : { kind: "value", cents },
  operationDate: null, paymentDate: null, startDate: null, endDate: null, accountId: null, accountLabel: null, provenance: [],
});
const items = (rows: PayrollItemRow[], source: "payfit" | "dsn" = "payfit"): PayrollItemsModel => ({
  source, month: "2026-10", kind: "value", reason: null, readAt: null, currency: "EUR", coverage: { status: "complete", reason: null },
  rows, sourceRows: rows.length, totals: [], notices: [], filter: { q: "", rubricKey: "" },
  rubrics: source === "payfit" ? [
    { key: "salaires", label: "Salaires fictifs", role: "brut" }, { key: "primes", label: "Primes fictives", role: "brut" },
    { key: "cotisations", label: "Cotisations fictives", role: "cotisations" }, { key: "provisions-cp", label: "Provisions fictives", role: "hors-masse" },
  ] : [
    { key: "dsn:001", label: "001 · Rémunération brute non plafonnée", role: "dsn" },
    { key: "dsn:002", label: "002 · Autre rémunération fictive", role: "dsn" }, { key: "dsn:nd", label: "Type absent fictif", role: "dsn" },
  ],
});
const money = (cents: number) => ({ kind: "value", cents });

describe("Analyse des rémunérations observées", () => {
  it("additionne les contrats de chaque personne et calcule une médiane de personnes, pas de lignes", () => {
    const model = items([
      row("a1", 10_000), row("a2", 5_001, "person-a", "contract-a2"),
      row("b1", 30_000, "person-b", "contract-b"), row("c1", 9_000, "person-c", "contract-c"),
    ]);
    const before = JSON.stringify(model);
    const result = salaryAnalysis(model);
    expect(result.kind).toBe("value");
    expect(result.totalSource).toEqual(money(54_001));
    expect(result.totalLinked).toEqual(money(54_001));
    expect(result.mean).toEqual(money(18_000));
    expect(result.median).toEqual(money(15_001));
    expect(result.coverage).toEqual({ status: "complete", selectedRows: 4, linkedRows: 4, unlinkedRows: 0, missingAmountRows: 0, unknownTypeRows: 0, persons: 3, valuedPersons: 3 });
    expect(result.persons[0]).toEqual({ personKey: "person-a", contractKeys: ["contract-a", "contract-a2"], sourceRows: 2, amount: money(15_001) });
    expect(JSON.stringify(result)).not.toContain("personLabel");
    expect(JSON.stringify(result)).not.toContain("Fictif");
    expect(JSON.stringify(model)).toBe(before);
  });

  it("conserve les occurrences distinctes d’un contrat, les crédits et les zéros explicites", () => {
    const result = salaryAnalysis(items([
      row("a1", 200), row("a2", 200), row("regularisation", -100), row("zero", 0, "person-b", "contract-b"),
    ]));
    expect(result.coverage.persons).toBe(2);
    expect(result.persons[0].sourceRows).toBe(3);
    expect(result.persons[0].contractKeys).toEqual(["contract-a"]);
    expect(result.totalSource).toEqual(money(300));
    expect(result.mean).toEqual(money(150));
    expect(result.median).toEqual(money(150));
  });

  it.each([
    [100, 101, 101], [-101, -100, -101], [-1, 0, -1], [0, 1, 1], [-102, -100, -101],
  ])("arrondit moyenne et médiane de %s et %s à %s centimes", (first, second, expected) => {
    const result = salaryAnalysis(items([row("a", first), row("b", second, "person-b", "contract-b")]));
    expect(result.mean).toEqual(money(expected));
    expect(result.median).toEqual(money(expected));
  });

  it("inclut toutes et seulement les rubriques brutes PayFit ou une rubrique brute choisie", () => {
    const model = items([
      row("salary", 100), row("bonus", 20, "person-a", "contract-a", "primes"),
      row("employer", 40, "person-a", "contract-a", "cotisations"), row("provision", 50, "person-a", "contract-a", "provisions-cp"),
    ]);
    expect(salaryAnalysis(model).totalSource).toEqual(money(120));
    expect(salaryAnalysis(model, "primes")).toMatchObject({ label: "Primes fictives", totalSource: money(20), mean: money(20) });
    expect(salaryAnalysis(model, "salaires").totalSource).toEqual(money(100));
    expect(salaryAnalysis(model).rubrics.map((r) => r.key)).toEqual(["salaires", "primes"]);
    for (const key of ["absent", "cotisations", "dsn:001"]) {
      const result = salaryAnalysis(model, key);
      expect(result.kind).toBe("nd");
      expect(result.coverage.selectedRows).toBe(0);
      expect(result.totalSource.kind).toBe("nd");
    }
  });

  it("ne somme jamais les types DSN qui se recouvrent", () => {
    const model = items([
      row("001-a", 100, "person-a", "contract-a", "dsn:001"),
      row("001-b", 100, "person-a", "contract-a", "dsn:001"),
      row("001-c", 400, "person-b", "contract-b", "dsn:001"),
      { ...row("002", null, "person-c", "contract-c", "dsn:002"), attachment: "unlinked", personKey: null },
    ], "dsn");
    const result = salaryAnalysis(model);
    expect(result.kind).toBe("value");
    expect(result.totalSource).toEqual(money(600));
    expect(result.mean).toEqual(money(300));
    expect(result.median).toEqual(money(300));
    expect(result.coverage.selectedRows).toBe(3);
    expect(result.rubrics.map((r) => r.key)).toEqual(["dsn:001"]);
    expect(salaryAnalysis(model, "dsn:001").totalSource).toEqual(money(600));
    for (const key of ["dsn:002", "dsn:nd", "salaires"]) {
      const invalid = salaryAnalysis(model, key);
      expect(invalid.kind).toBe("nd");
      expect(invalid.totalSource.kind).toBe("nd");
      expect(invalid.reason).toContain("les types ne sont pas additionnés");
    }
  });

  it("un type DSN absent bloque les statistiques exhaustives, sans contaminer le total 001 connu", () => {
    const model = items([
      row("001-a", 100, "person-a", "contract-a", "dsn:001"),
      row("001-b", 200, "person-b", "contract-b", "dsn:001"),
      row("unknown", 500, "person-c", "contract-c", "dsn:nd"),
    ], "dsn");
    const result = salaryAnalysis(model);
    expect(result.kind).toBe("partial");
    expect(result.reason).toContain("Type de rémunération absent");
    expect(result.coverage).toMatchObject({ selectedRows: 2, linkedRows: 2, unknownTypeRows: 1, persons: 2 });
    expect(result.totalSource).toEqual(money(300));
    expect(result.totalLinked).toEqual(money(300));
    expect(result.mean.kind).toBe("nd");
    expect(result.median.kind).toBe("nd");
    const withoutKnown = salaryAnalysis(items([row("unknown", 500, "person-c", "contract-c", "dsn:nd")], "dsn"));
    expect(withoutKnown.kind).toBe("nd");
    expect(withoutKnown.coverage.unknownTypeRows).toBe(1);
    expect(withoutKnown.totalSource.kind).toBe("nd");
  });

  it("affiche les lignes sans rattachement dans la couverture et ferme moyenne et médiane", () => {
    const result = salaryAnalysis(items([
      row("linked", 100), { ...row("no-contract", 20), attachment: "no-contract", personKey: null, contractKey: null },
      { ...row("unlinked", 0), attachment: "unlinked", personKey: null, contractKey: null },
    ]));
    expect(result.kind).toBe("partial");
    expect(result.totalSource).toEqual(money(120));
    expect(result.totalLinked).toEqual(money(100));
    expect(result.coverage).toMatchObject({ selectedRows: 3, linkedRows: 1, unlinkedRows: 2, persons: 1 });
    expect(result.mean.kind).toBe("nd");
    expect(result.median.kind).toBe("nd");
    expect(result.reason).toContain("2 ligne(s) sans rattachement certain");
  });

  it("une identité ou un contrat manquant ne suffit pas à un rattachement même marqué linked", () => {
    for (const invalid of [{ ...row("person-absent", 100), personKey: null }, { ...row("contract-absent", 100), contractKey: null }]) {
      const result = salaryAnalysis(items([invalid]));
      expect(result.coverage).toMatchObject({ linkedRows: 0, unlinkedRows: 1, persons: 0 });
      expect(result.totalLinked.kind).toBe("nd");
      expect(result.mean.kind).toBe("nd");
    }
  });

  it("un montant manquant reste dans la population, sans devenir zéro ni disparaître des statistiques", () => {
    const result = salaryAnalysis(items([row("known", 100), row("missing", null, "person-b", "contract-b")]));
    expect(result.kind).toBe("partial");
    expect(result.coverage).toMatchObject({ selectedRows: 2, missingAmountRows: 1, persons: 2, valuedPersons: 1 });
    expect(result.persons[1].amount.kind).toBe("nd");
    for (const amount of [result.totalSource, result.totalLinked, result.mean, result.median]) expect(amount.kind).toBe("nd");
  });

  it("ne transforme pas l’absence d’occurrence, de type DSN 001 ou de personne en zéro", () => {
    for (const model of [items([]), items([row("charge", 20, "person-a", "contract-a", "cotisations")]),
      items([row("002", 20, "person-a", "contract-a", "dsn:002")], "dsn")]) {
      const result = salaryAnalysis(model);
      expect(result.kind).toBe("nd");
      expect(result.totalSource.kind).toBe("nd");
      expect(result.mean.kind).toBe("nd");
      expect(result.reason).toContain("L’absence d’occurrence ne vaut pas zéro");
    }
    const zero = salaryAnalysis(items([row("zero", 0)]));
    expect(zero.kind).toBe("value");
    expect(zero.mean).toEqual(money(0));
    expect(zero.median).toEqual(money(0));
  });

  it.each(["incomplete", "blocked", "missing"] as const)("ne calcule rien avec une couverture %s, même si des lignes partielles sont fournies", (status) => {
    const model = items([row("known", 100)]);
    model.coverage = { status, reason: "Couverture fictive non complète." };
    const result = salaryAnalysis(model);
    expect(result.kind).toBe("nd");
    expect(result.coverage.status).toBe(status);
    expect(result.persons).toEqual([]);
    for (const amount of [result.totalSource, result.totalLinked, result.mean, result.median]) expect(amount).toEqual({ kind: "nd", reason: "Couverture fictive non complète." });
  });

  it("refuse source absente, mois invalide et modèle indisponible", () => {
    const model = items([row("known", 100)]);
    expect(salaryAnalysis({ ...model, source: null }).kind).toBe("nd");
    expect(salaryAnalysis({ ...model, month: "2026-13" }).kind).toBe("nd");
    const unavailable = salaryAnalysis({ ...model, kind: "nd", reason: "Journal fictif indisponible." });
    expect(unavailable.reason).toBe("Journal fictif indisponible.");
    expect(unavailable.mean.kind).toBe("nd");
  });

  it.each([Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER - 1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])("refuse un montant individuel non entier sûr : %s", (cents) => {
    const result = salaryAnalysis(items([row("invalid", cents)]));
    expect(result.coverage.missingAmountRows).toBe(1);
    expect(result.kind).toBe("partial");
    expect(result.totalSource.kind).toBe("nd");
    expect(result.mean.kind).toBe("nd");
  });

  it("préserve les bornes sûres et les compensations sans erreur d’intermédiaire", () => {
    const maximum = salaryAnalysis(items([row("max", Number.MAX_SAFE_INTEGER)]));
    expect(maximum.totalSource).toEqual(money(Number.MAX_SAFE_INTEGER));
    expect(maximum.mean).toEqual(money(Number.MAX_SAFE_INTEGER));
    expect(maximum.median).toEqual(money(Number.MAX_SAFE_INTEGER));
    const compensated = salaryAnalysis(items([row("max", Number.MAX_SAFE_INTEGER), row("plus", 1), row("minus", -1)]));
    expect(compensated.kind).toBe("value");
    expect(compensated.mean).toEqual(money(Number.MAX_SAFE_INTEGER));
    const min = salaryAnalysis(items([row("min", Number.MIN_SAFE_INTEGER)]));
    expect(min.mean).toEqual(money(Number.MIN_SAFE_INTEGER));
    expect(min.median).toEqual(money(Number.MIN_SAFE_INTEGER));
  });

  it("ferme les statistiques si le total individuel ou collectif dépasse la précision sûre", () => {
    for (const model of [items([row("max", Number.MAX_SAFE_INTEGER), row("overflow", 1)]),
      items([row("max", Number.MAX_SAFE_INTEGER), row("overflow", 1, "person-b", "contract-b")])]) {
      const result = salaryAnalysis(model);
      expect(result.kind).toBe("partial");
      expect(result.totalSource.kind).toBe("nd");
      expect(result.mean.kind).toBe("nd");
      expect(result.median.kind).toBe("nd");
    }
  });
});
