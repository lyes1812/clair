import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PayrollExplorationView, type PayrollExplorationProps } from "@/app/e/[slug]/studio-rh/masse-salariale/ExplorationView";
import { buildActualGap, buildPayrollOrganisation, type PayrollExplorationInput } from "@/lib/payroll/exploration";
import { DEFAULT_PREFIXES } from "@/lib/payroll/grid";
import type { LedgerLine } from "@/lib/payroll/engine";

// Journal et identités strictement fictifs, sans base, API ou accès aux contextes de l’espace.
const A = ["2026-01", "2026-02"], B = ["2025-01", "2025-02"];
function input(): PayrollExplorationInput {
  let sequence = 0;
  const line = (month: string, accountId: string, cents: number, codes = ["Équipe fictive A"], contractId: string | null = "contrat-fictif-1"): LedgerLine => ({ key: `ecriture-fictive-${++sequence}`, month, accountId, accountName: "Compte fictif", debitCents: cents >= 0 ? cents : null, creditCents: cents < 0 ? -cents : null, contractId, analytic: codes.map((code) => ({ type: "Service", code, value: code })) });
  return {
    source: "payfit", unavailable: null, read: { syncId: "lecture-fictive", readAt: "2026-11-01T23:30:00Z", closedMonths: [...A, ...B] },
    rh: { build: { source: "payfit", inputs: { source: "payfit", syncId: "lecture-fictive" } }, persons: [{ personKey: "payfit:personne-fictive", familyName: "FICTIF", givenNames: "Alice", provenance: { familyName: { collection: "collaborators", syncId: "lecture-fictive", recordKey: "personne-fictive", period: null, path: "familyName", label: "Source fictive" } } }], contracts: [{ contractKey: "payfit:contrat-fictif-1", externalId: "contrat-fictif-1", personKey: "payfit:personne-fictive" }] },
    journal: { months: [...A, ...B], openMonths: [], grid: DEFAULT_PREFIXES, lines: [
      line(A[0], "641100", 200_000), line(A[0], "645100", 60_000), line(A[0], "641100", 10_000, ["Non ventilé"], "contrat-fictif-absent"),
      line(A[0], "645100", 1_000, ["Axe fictif X", "Axe fictif Y"]), line(A[0], "641300", -5_000, [], null),
      line(A[1], "641100", 220_000), line(A[1], "645100", 66_000),
      line(B[0], "641100", 180_000), line(B[0], "645100", 54_000), line(B[1], "641100", 230_000), line(B[1], "645100", 69_000),
    ] },
  };
}
function props(mode: PayrollExplorationProps["mode"] = "organisation", source = input()): PayrollExplorationProps {
  return { slug: "espace-fictif", mode, filters: { year: "2026", from: "01", to: "02", axis: "Service", referenceYear: "2025", display: "tout" }, options: { years: ["2025", "2026"], axes: [{ value: "Service", label: "Service" }], referenceYears: ["2025", "2026"] },
    organisation: mode === "organisation" ? buildPayrollOrganisation(source, { months: A, axis: "Service" }) : undefined,
    actualGap: mode === "reel" ? buildActualGap(source, { monthsA: A, monthsB: B }) : undefined };
}
const html = (p = props()) => renderToStaticMarkup(createElement(PayrollExplorationView, p));
const table = (value: string, testid: string) => value.match(new RegExp(`<table[^>]*data-testid="${testid}"[\\s\\S]*?<\\/table>`))?.[0] ?? "";
const section = (value: string, testid: string) => value.match(new RegExp(`<section[^>]*data-testid="${testid}"[\\s\\S]*?<\\/section>`))?.[0] ?? "";
const card = (value: string, testid: string) => value.match(new RegExp(`<div[^>]*data-testid="${testid}"[\\s\\S]*?<\\/div>`))?.[0] ?? "";

describe("Masse salariale — explorations des journaux fictifs", () => {
  it("conserve les sélections explicites dans un formulaire GET sans second titre h1", () => {
    const value = html();
    expect(value).toContain('action="/e/espace-fictif/studio-rh/masse-salariale/organisation" method="get"');
    for (const name of ["annee", "de", "a", "axe", "affichage"]) expect(value).toContain(`name="${name}"`);
    expect(value).toContain('value="Service" selected=""');
    expect(value).toContain("Ventilation par organisation"); expect(value).not.toContain("<h1");
  });

  it("exige un axe explicite sans adopter le premier axe disponible", () => {
    const p = props(); p.filters.axis = ""; p.organisation = buildPayrollOrganisation(input(), { months: A, axis: null });
    const value = html(p);
    expect(value).toContain('<option value="" selected="">Choisir un axe</option>');
    expect(value).not.toContain('value="Service" selected=""');
    expect(value).toContain('data-testid="payroll-choose-axis"');
    expect(value).not.toContain('data-testid="payroll-organisation-chart"');
    expect(value).not.toContain('data-testid="payroll-organisation-table"');
  });

  it("préserve visiblement une année, un mois ou un axe explicite refusé", () => {
    const p = props(); p.filters.year = "2027"; p.filters.from = "13"; p.filters.axis = "Axe fictif absent";
    p.organisation = buildPayrollOrganisation(input(), { months: [], axis: p.filters.axis });
    const value = html(p);
    expect(value).toContain('<option value="2027" selected="">2027</option>');
    expect(value).toContain('<option value="13" selected="">Mois indisponible</option>');
    expect(value).toContain('<option value="Axe fictif absent" selected="">Axe indisponible</option>');
    expect(value).toContain('data-testid="payroll-exploration-nd"');
    expect(value).not.toContain('data-testid="payroll-organisation-monthly"');
  });

  it("affiche les trois totaux fournis sans recalcul depuis les groupes", () => {
    const value = html();
    expect(card(value, "payroll-total-brut")).toContain('data-money-cents="425000"');
    expect(card(value, "payroll-total-cotisations")).toContain('data-money-cents="127000"');
    expect(card(value, "payroll-total-masse")).toContain('data-money-cents="552000"');
    expect(table(value, "payroll-organisation-monthly")).toContain('data-money-cents="266000"');
    expect(table(value, "payroll-organisation-monthly")).toContain('data-money-cents="286000"');
  });

  it("distingue un code métier nommé Non ventilé de l’absence de code et de l’ambiguïté", () => {
    const value = section(html(), "payroll-organisation-table");
    expect(value).toContain('<tr data-group="code"><th scope="row">Non ventilé</th>');
    expect(value).toContain('<tr data-group="unallocated"><th scope="row">Non ventilé<span class="pye-kind"');
    expect(value).toContain('data-group="ambiguous"'); expect(value).toContain("À vérifier");
    expect(value).toContain('data-money-cents="-5000"');
  });

  it("les détails gardent comptes, contrats rattachés, inconnus et lignes sans contrat", () => {
    const value = html();
    expect(value).toContain('href="#pye-group-0"'); expect(value).toContain('id="pye-group-0"');
    expect(value).toContain("Par compte comptable"); expect(value).toContain("Par contrat");
    expect(value).toContain('href="/e/espace-fictif/studio-rh/collaborateurs/p/payfit%3Apersonne-fictive"');
    expect(value).toContain('href="/e/espace-fictif/studio-rh/collaborateurs/c/payfit%3Acontrat-fictif-1"');
    expect(value).toContain("Contrat non rattaché"); expect(value).toContain("Sans contrat dans la source");
    expect(value).toContain('href="/e/espace-fictif/donnees/synchro/lecture-fictive"');
  });

  it("utilise des régions de défilement accessibles et des en-têtes de tableau explicites", () => {
    const value = html();
    expect(value).toContain('tabindex="0" role="region" aria-label="Masse salariale par organisation sur la période"');
    expect(value).toContain('scope="row"'); expect(value).toContain('scope="col"');
    expect(value).toContain('aria-label="Définition du détail par organisation"');
  });

  it("garde une seule vigilance fermée et la date de lecture au calendrier de Paris", () => {
    const value = html(); const vigilance = value.match(/<details[^>]*data-testid="payroll-exploration-vigilance"[^>]*>/)?.[0] ?? "";
    expect(vigilance).toBeTruthy(); expect(vigilance).not.toContain(" open");
    expect(value.match(/data-testid="payroll-exploration-vigilance"/g)).toHaveLength(1);
    expect(value).toContain("02/11/2026 00:30"); expect(value).toContain("journal comptable de paie PayFit");
    expect(value).toContain("aucun bulletin de paie n’est reconstitué");
  });

  it("le graphique d’organisation reprend toutes les cellules mensuelles, dont la correction négative", () => {
    const value = html();
    expect(value).toContain('data-testid="payroll-organisation-chart"');
    expect(value).toContain("Non ventilé · n.d."); expect(value).toContain("Affectation ambiguë · à vérifier");
    expect(value).toContain("−50,00");
  });

  it("ne dessine aucune pile partielle lorsqu’un groupe mensuel est n.d.", () => {
    const p = props();
    p.organisation!.groups[0].monthly[0].totals.masse = { kind: "nd", reason: "Groupe fictif non déterminé." };
    const value = html(p); const chart = section(value, "payroll-organisation-graph");
    const january = chart.match(/aria-label="Janvier 2026 :[^\"]*"/)?.[0] ?? "";
    expect(january).toContain("Groupe fictif non déterminé.");
    expect(january.match(/n\.d\. \(/g)).toHaveLength(p.organisation!.groups.length);
    // Le tableau global garde le total exact fourni ; il n'est pas reconstruit depuis la pile.
    expect(table(value, "payroll-organisation-monthly")).toContain('data-money-cents="266000"');
  });

  it("refuse une pile hors précision sûre même lorsque son total net reste représentable", () => {
    const p = props(); const values = [Number.MAX_SAFE_INTEGER, 2, -Number.MAX_SAFE_INTEGER, 0];
    p.organisation!.groups.forEach((group, i) => { group.monthly[0].totals.masse = { kind: "value", cents: values[i], occurrences: 1 }; });
    p.organisation!.monthly[0].totals.masse = { kind: "value", cents: 2, occurrences: 3 };
    const chart = section(html(p), "payroll-organisation-graph");
    const january = chart.match(/aria-label="Janvier 2026 :[^\"]*"/)?.[0] ?? "";
    expect(january).toContain("Amplitude des montants hors de la précision sûre");
    expect(january.match(/n\.d\. \(/g)).toHaveLength(p.organisation!.groups.length);
  });

  it("conserve les mois connus et les trous n.d. sans reconstruire un cumul incomplet", () => {
    const source = input(); source.read!.closedMonths = source.read!.closedMonths.filter((m) => m !== A[1]);
    const p = props("organisation", source); const value = html(p);
    expect(card(value, "payroll-total-masse")).toContain("n.d.");
    const monthly = table(value, "payroll-organisation-monthly");
    expect(monthly).toContain('data-money-cents="266000"');
    const february = monthly.match(/<tr[^>]*data-month="2026-02"[\s\S]*?<\/tr>/)?.[0] ?? "";
    expect(february).toContain("n.d."); expect(february).not.toContain('data-money-cents="0"');
    expect(value).toContain("Aucune clôture completed explicite");
  });

  it("conserve les paramètres de chaque vue d’affichage sans changer ses montants", () => {
    const p = props(); p.filters.display = "tableau";
    let value = html(p);
    expect(value).not.toContain('data-testid="payroll-organisation-chart"');
    expect(value).toContain('data-testid="payroll-organisation-table"');
    expect(value).toContain("annee=2026&amp;de=01&amp;a=02&amp;affichage=graphique&amp;axe=Service");
    p.filters.display = "graphique"; value = html(p);
    expect(value).toContain('data-testid="payroll-organisation-chart"'); expect(value).not.toContain('data-testid="payroll-organisation-table"');
    expect(card(value, "payroll-total-masse")).toContain('data-money-cents="552000"');
  });

  it("écart réel : indique les périodes et le sens A − B avec référence B explicite", () => {
    const value = html(props("reel"));
    expect(value).toContain('name="reference"'); expect(value).toContain('value="2025" selected=""');
    expect(value).toContain("Janvier 2026 → Février 2026"); expect(value).toContain("Janvier 2025 → Février 2025");
    expect(value).toContain("Écart : A − B"); expect(value).toContain("Écart % / B");
    expect(card(value, "payroll-gap-masse")).toContain('data-money-cents="19000"');
    expect(value).toContain("annee=2026&amp;de=01&amp;a=02&amp;affichage=tableau&amp;reference=2025");
  });

  it("écart réel : conserve les signes et réserve rouge/vert à la variation de coût", () => {
    const value = html(props("reel")); const monthly = table(value, "payroll-gap-monthly");
    expect(monthly).toContain('class="num trend-bad" data-col="delta"><span class="money-display" data-money-cents="32000"');
    expect(monthly).toContain('class="num trend-good" data-col="delta"><span class="money-display" data-money-cents="-13000"');
    expect(monthly).toContain('data-money-exact="+320,00'); expect(monthly).toContain('data-money-exact="−130,00');
    expect(monthly).toContain('data-col="a"><span class="money-display"');
  });

  it("écart réel : propose rubriques comptables, comptes, contrats et source sans détail de bulletin inventé", () => {
    const value = html(props("reel"));
    for (const id of ["payroll-gap-rubrics", "payroll-gap-accounts", "payroll-gap-contracts"]) expect(table(value, id)).toBeTruthy();
    expect(value).toContain("Lignes source de la période A"); expect(value).toContain("Lignes source de la référence B");
    expect(value).toContain("sans reconstruction des rubriques de bulletin");
    expect(value).not.toContain("Effectif ETP");
  });

  it("un zéro sans occurrence reste qualifié et une référence nulle ne produit pas de pourcentage", () => {
    const value = html(props("reel"));
    expect(value).toContain('data-source-occurrences="0"');
    expect(value).toContain('title="Aucune ligne correspondante dans le journal complet."');
    expect(value).toContain('title="Référence nulle : pourcentage non défini."');
    expect(value).not.toContain("Infinity"); expect(value).not.toContain("NaN");
  });

  it("écart réel : les courbes interrompent le réel manquant et gardent les valeurs B connues", () => {
    const source = input(); source.read!.closedMonths = source.read!.closedMonths.filter((m) => m !== A[1]);
    const value = html(props("reel", source));
    expect(value).toContain('data-testid="payroll-gap-chart"');
    expect(value.match(/class="chart-line"/g)).toHaveLength(1); // Seule B possède deux points contigus.
    expect(value).toContain('stroke-dasharray="6 4"');
    expect(table(value, "payroll-gap-monthly")).toContain('data-money-cents="299000"');
    expect(card(value, "payroll-gap-masse")).toContain("n.d.");
  });

  it("une source DSN non ventilable reste indisponible sans emprunter le journal PayFit", () => {
    const source = input(); source.source = "dsn";
    const value = html(props("organisation", source));
    expect(value).toContain('data-testid="payroll-exploration-nd"'); expect(value).toContain("Source RH DSN");
    expect(value).not.toContain('data-testid="payroll-organisation-table"');
    expect(value).not.toContain("FICTIF Alice");
  });

  it("conserve les centimes exacts des cellules même à la limite des entiers sûrs", () => {
    const p = props(); p.filters.display = "tableau";
    p.organisation!.totals.masse = { kind: "value", cents: Number.MAX_SAFE_INTEGER, occurrences: 1 };
    const value = card(html(p), "payroll-total-masse");
    expect(value).toContain('data-money-cents="9007199254740991"');
    expect(value).toContain('data-money-exact="90\u202f071\u202f992\u202f547\u202f409,91');
  });
});
