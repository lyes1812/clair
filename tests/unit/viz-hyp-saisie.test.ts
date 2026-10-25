import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { project } from "@/lib/budget/engine";
import type { ScenarioRow } from "@/lib/budget/store";
import type { BaseContract, BaseSnapshot, Hypothesis } from "@/lib/budget/types";
import {
  checkFill,
  countByYear,
  dateFr,
  dirtyText,
  downTargets,
  fold,
  gridYears,
  matchesQuery,
  monthColumnLabel,
  pageNumber,
  paginate,
  neighborInColumn,
  reportTargets,
  rightTargets,
  rowTargets,
  scanFields,
  yearGroups,
  type GridCell,
} from "@/lib/viz/hyp-saisie";
import { ActionForm } from "@/app/e/[slug]/studio-rh/hypotheses/ActionForm";
import { BasesView } from "@/app/e/[slug]/studio-rh/hypotheses/BasesView";
import { ControlesChangements } from "@/app/e/[slug]/studio-rh/hypotheses/ControlesView";
import { EnveloppesView } from "@/app/e/[slug]/studio-rh/hypotheses/EnveloppesView";
import { GlobalesView } from "@/app/e/[slug]/studio-rh/hypotheses/GlobalesView";
import { HireForm } from "@/app/e/[slug]/studio-rh/hypotheses/HireForm";
import { PostesView } from "@/app/e/[slug]/studio-rh/hypotheses/PostesView";

// Écrans de saisie des hypothèses budgétaires : logique pure (recherche, pagination, années d'une grille, outils de copie)
// avec des cas de référence écrits à la main, puis rendu côté serveur des écrans (repères attendus, aucun « NaN »).

describe("recherche « toutes les colonnes »", () => {
  it("sans accents ni majuscules ; tous les mots doivent se retrouver, dans n'importe quelle colonne", () => {
    expect(fold("Hélène ÉTÉ")).toBe("helene ete");
    expect(matchesQuery(["Hélène DUPONT", "TECH", "CDI"], "helene tech")).toBe(true);
    expect(matchesQuery(["Hélène DUPONT", "TECH", "CDI"], "  CDI  dupont ")).toBe(true);
    expect(matchesQuery(["Hélène DUPONT", "TECH", "CDI"], "tech sales")).toBe(false);
  });
  it("une recherche vide retient tout ; une colonne vide ou absente ne correspond à rien", () => {
    expect(matchesQuery(["A"], "")).toBe(true);
    expect(matchesQuery(["A"], "   ")).toBe(true);
    expect(matchesQuery([null, undefined, ""], "x")).toBe(false);
  });
  it("un mot ne chevauche pas deux colonnes voisines", () => {
    expect(matchesQuery(["ab", "cd"], "bc")).toBe(false);
    expect(matchesQuery(["ab", "cd"], "cd")).toBe(true);
  });
  it("une date saisie sous une forme ou l'autre se retrouve si les deux formes sont dans les colonnes", () => {
    expect(matchesQuery(["2026-11-15", dateFr("2026-11-15")], "15/11/2026")).toBe(true);
    expect(matchesQuery(["2026-11-15", dateFr("2026-11-15")], "2026-11")).toBe(true);
  });
});

describe("pagination", () => {
  const items = Array.from({ length: 45 }, (_, i) => i + 1);
  it("45 lignes par 20 : trois pages, 1–20, 21–40, 41–45", () => {
    const p1 = paginate(items, 1, 20);
    expect([p1.pages, p1.from, p1.to, p1.items.length]).toEqual([3, 1, 20, 20]);
    const p2 = paginate(items, 2, 20);
    expect([p2.from, p2.to, p2.items[0], p2.items.at(-1)]).toEqual([21, 40, 21, 40]);
    const p3 = paginate(items, 3, 20);
    expect([p3.from, p3.to, p3.items]).toEqual([41, 45, [41, 42, 43, 44, 45]]);
  });
  it("page hors bornes ramenée à la dernière (ou à la première) ; liste vide : 0–0, une page", () => {
    expect(paginate(items, 99, 20).page).toBe(3);
    expect(paginate(items, 0, 20).page).toBe(1);
    expect(paginate([], 4, 20)).toEqual({ page: 1, pages: 1, total: 0, from: 0, to: 0, items: [] });
  });
  it("numéro de page lu dans l'adresse : entier à partir de 1, sinon 1", () => {
    expect(["3", "1", "0", "-2", "abc", "1.5", "", undefined, null].map(pageNumber)).toEqual([3, 1, 1, 1, 1, 1, 1, 1, 1]);
  });
});

describe("mois, dates et années d'une grille", () => {
  it("étiquette d'un mois : l'année sur deux chiffres seulement quand la grille couvre plusieurs années", () => {
    expect(monthColumnLabel("2026-03", false)).toBe("mars");
    expect(monthColumnLabel("2026-03", true)).toBe("mars 26");
    expect(monthColumnLabel("2027-01", true)).toBe("janv. 27");
  });
  it("date au format français ; une valeur qui n'est pas une date complète est rendue telle quelle, jamais inventée", () => {
    expect(dateFr("2026-11-15")).toBe("15/11/2026");
    expect(dateFr(null)).toBeNull();
    expect(dateFr("")).toBeNull();
    expect(dateFr("2026-11")).toBe("2026-11");
  });
  it("mois regroupés par année, dans l'ordre", () => {
    expect(yearGroups(["2026-11", "2026-12", "2027-01"])).toEqual([{ year: "2026", months: ["2026-11", "2026-12"] }, { year: "2027", months: ["2027-01"] }]);
    expect(yearGroups([])).toEqual([]);
  });
  it("grille de deux années : rang de l'année, étiquettes avec l'année, onglets avec le nombre de cellules renseignées", () => {
    const months = ["2026-11", "2026-12", "2027-01", "2027-02"];
    expect(countByYear(["2026-11", "2027-01", "2027-02"])).toEqual({ 2026: 1, 2027: 2 });
    const g = gridYears(months, countByYear(["2027-01", "2027-02"]));
    expect(g.multi).toBe(true);
    expect(months.map(g.index)).toEqual([0, 0, 1, 1]);
    expect(g.label("2027-01")).toBe("janv. 27");
    expect(g.tabs).toEqual([{ label: "2026", count: undefined }, { label: "2027", count: 2 }]);
  });
  it("grille d'une seule année : ni rang, ni onglets, étiquettes sans année", () => {
    const g = gridYears(["2026-10", "2026-11"]);
    expect(g.multi).toBe(false);
    expect(g.index("2026-10")).toBeUndefined();
    expect(g.tabs).toBeUndefined();
    expect(g.label("2026-11")).toBe("nov.");
  });
});

describe("outils d'une grille : copier vers la droite, vers le bas, remplir la ligne", () => {
  // Trois lignes de quatre colonnes, dans l'ordre du document : indices 0–3 (ligne r0), 4–7 (r1), 8–11 (r2).
  const grid = (hidden: number[] = []): GridCell[] => Array.from({ length: 12 }, (_, i) => ({ row: `r${Math.floor(i / 4)}`, col: `c${i % 4}`, visible: !hidden.includes(i % 4) }));
  it("vers la droite : les cellules suivantes de la même ligne", () => {
    expect(rightTargets(grid(), 5)).toEqual([6, 7]);
    expect(rightTargets(grid(), 7)).toEqual([]);
    expect(rightTargets(grid(), 0)).toEqual([1, 2, 3]);
  });
  it("vers le bas : la même colonne dans les lignes situées dessous", () => {
    expect(downTargets(grid(), 1)).toEqual([5, 9]);
    expect(downTargets(grid(), 5)).toEqual([9]);
    expect(downTargets(grid(), 9)).toEqual([]);
  });
  it("remplir la ligne : toute la ligne de la cellule active, elle comprise", () => {
    expect(rowTargets(grid(), 5)).toEqual([4, 5, 6, 7]);
    expect(rowTargets(grid(), 11)).toEqual([8, 9, 10, 11]);
  });
  it("une colonne masquée (autre année affichée) n'est jamais touchée", () => {
    expect(rightTargets(grid([3]), 5)).toEqual([6]);
    expect(rowTargets(grid([3]), 5)).toEqual([4, 5, 6]);
    expect(downTargets(grid([1]), 1)).toEqual([]);
  });
  it("clavier : Entrée ou flèche bas = cellule du dessous, Maj+Entrée ou flèche haut = cellule du dessus, dans la même colonne", () => {
    expect(neighborInColumn(grid(), 5, 1)).toBe(9);
    expect(neighborInColumn(grid(), 5, -1)).toBe(1);
    expect(neighborInColumn(grid(), 9, 1)).toBe(-1);
    expect(neighborInColumn(grid(), 1, -1)).toBe(-1);
    expect(neighborInColumn(grid(), 40, 1)).toBe(-1);
    // Une colonne masquée n'est jamais visitée.
    expect(neighborInColumn(grid([1]), 5, 1)).toBe(-1);
  });
  it("cellule active inconnue : rien", () => {
    expect([rightTargets(grid(), 99), downTargets(grid(), -1), rowTargets(grid(), 12)]).toEqual([[], [], []]);
  });
  it("reporter : la première valeur renseignée est recopiée sur toutes les cellules suivantes", () => {
    expect(reportTargets(["", "", "2,5", "", ""])).toEqual({ from: 2, value: "2,5", targets: [3, 4] });
    expect(reportTargets(["1"])).toEqual({ from: 0, value: "1", targets: [] });
    expect(reportTargets(["  ", ""])).toBeNull();
  });
  it("valeur à reporter : aucune proposée ; vide ou illisible refusée, comme à l'enregistrement", () => {
    expect(["", "  ", "2,5", "1 200,00", "1 200,5", "-3", "+4", "2,505", "abc", "2,,5", "3 %"].map(checkFill)).toEqual(["vide", "vide", "ok", "ok", "ok", "ok", "ok", "illisible", "illisible", "illisible", "illisible"]);
  });
});

describe("modifications non enregistrées et valeurs illisibles", () => {
  const fields = [
    { label: "A", raw: "2", changed: true, numeric: true },
    { label: "B", raw: "x", changed: true, numeric: true },
    { label: "Source", raw: "texte libre", changed: false, numeric: false },
    { label: "D", raw: "", changed: false, numeric: true },
  ];
  it("compte les champs modifiés ; seul un champ numérique non vide et illisible est signalé", () => {
    expect(scanFields(fields)).toEqual({ changed: 2, unreadable: [{ label: "B", raw: "x" }] });
    expect(scanFields([])).toEqual({ changed: 0, unreadable: [] });
  });
  it("texte de l'indicateur", () => {
    expect(dirtyText(0, [])).toBe("Aucune modification non enregistrée.");
    expect(dirtyText(1, [])).toBe("1 modification non enregistrée.");
    expect(dirtyText(2, [{ label: "B", raw: " x " }])).toBe("2 modifications non enregistrées · 1 valeur illisible à corriger (B : « x »).");
    expect(dirtyText(0, [{ label: "B", raw: "x" }, { label: "C", raw: "y" }])).toBe("Aucune modification non enregistrée · 2 valeurs illisibles à corriger (B : « x », …).");
  });
});

// --- Écrans rendus côté serveur ---------------------------------------------------------------------------------------
const scenarioOf = (firstMonth: string, lastMonth: string) => ({ id: "11111111-1111-1111-1111-111111111111", name: "Révisé T4", kind: "revise", status: "brouillon", firstMonth, lastMonth }) as unknown as ScenarioRow;
const clean = (html: string) => {
  expect(html).not.toContain("NaN");
  expect(html).not.toContain("undefined");
  expect(html).not.toContain("[object");
  // Compare le texte affiché ; la précision source est vérifiée séparément dans les tests monétaires.
  return html.replace(/<span class="money-display"[^>]*>([^<]*)<\/span>/g, "$1");
};
const flat = (html: string) => html.replace(/\s/g, " ");
const contract = (key: string, over: Partial<BaseContract>): BaseContract => ({
  contractKey: key, externalId: key, label: key, service: null, serviceNd: null, startDate: "2025-01-06", endDate: null, counted: true, etp4: 10000, etpNd: null, category: "cdi", executive: false, base: null, baseNd: null, ...over,
});
const baseOf = (contracts: BaseContract[]): BaseSnapshot => ({
  currency: "EUR", refMonth: "2026-09", syncId: "s", readAt: "2026-10-05", contracts,
  actuals: Array.from({ length: 9 }, (_, i) => ({ month: `2026-0${i + 1}`, kind: "value" as const, brut: 500000, cotisations: 200000, masse: 700000, headcount: 3, etp4: 25000, etpNd: null })),
  refMasse: 700000, refBaseCost: null, etpNote: null,
});
// A : 3 000,00 € de salaire, 1 200,00 € de charges (132 000 ÷ 330 000 × 3 000,00 = 1 200,00) → 4 200,00 € par mois.
const A = contract("A", { label: "Alice", service: "TECH", base: { salaryCents: 300000, refBrutCents: 330000, refCotisationsCents: 132000 } });
const B = contract("B", { label: "Bruno", service: "SALES", base: { salaryCents: 200000, refBrutCents: 200000, refCotisationsCents: 90000 } });
const C = contract("C", { label: "Chloé", service: "TECH", endDate: "2026-12-31", baseNd: "entrée en cours du mois de référence" });
const small = baseOf([A, B, C]);
const hs: Hypothesis[] = [
  { id: "d1", kind: "depart", label: "Départ Bruno", contractKey: "B", lastPaidDate: "2026-11-20", exitCost: null, motif: "Démission" },
  { id: "r1", kind: "augmentation", label: "Augmentation Alice", from: "2026-11", rateBps: 250, scope: { kind: "contrat", key: "A" } },
  { id: "g1", kind: "augmentation", label: "Générale", from: "2026-12", rateBps: 100, scope: { kind: "global" } },
  { id: "c1", kind: "changement", label: "Changement Alice", contractKey: "A", from: "2026-12", quotaBps: 5000 },
  { id: "k1", kind: "categorie", label: "Catégorie Chloé", contractKey: "C", category: "apprenti" },
];
const projOf = (b: BaseSnapshot, list: Hypothesis[]) => project(b, "2026-10", "2026-12", list, { prorata: "calendaire" });

describe("PostesView rendue", () => {
  const sc = scenarioOf("2026-10", "2026-12");
  const render = (over: Partial<Parameters<typeof PostesView>[0]> = {}) => clean(renderToStaticMarkup(h(PostesView, { slug: "demo", scenario: sc, base: small, hyps: hs, proj: projOf(small, hs), q: "", selected: "", canEdit: true, ...over })));
  it("colonnes d'effet colorées là où une hypothèse existe, « — » ailleurs ; dates au format français ; coût de base 4 200,00 €", () => {
    const html = render();
    const row = (name: string) => html.split(`data-salarie="${name}"`)[1].split("</tr>")[0];
    // Bruno : départ le 20/11/2026, motif saisi ; Alice : augmentation de contrat et changement de quotité ; Chloé : catégorie corrigée.
    expect(row("Bruno")).toContain('<td class="changed" data-col="sortie">20/11/2026</td>');
    expect(row("Bruno")).toContain("Démission");
    expect(flat(row("Alice"))).toContain("+2,50 % dès novembre 2026");
    expect(flat(row("Alice"))).toContain("quotité 50,00 % dès décembre 2026");
    expect(row("Alice")).toContain('<td data-col="sortie">—</td>');
    expect(row("Chloé")).toContain('<td class="changed">Apprenti<span class="tile-foot"> (hypothèse)</span></td>');
    expect(flat(row("Alice"))).toContain("4 200 €");
    expect(row("Alice")).toContain("06/01/2025");
    expect(row("Chloé")).toContain("31/12/2026"); // fin de contrat connue
    // Un départ de contrat ne se lit pas dans la colonne « fin connue » des autres.
    expect(row("Bruno")).not.toContain("31/12/2026");
    expect(html).toContain("Sortie (hypothèse)");
  });
  it("coût de base n.d. avec sa raison dans la fiche : jamais zéro", () => {
    const html = flat(render());
    expect(html.split('data-salarie="Chloé"')[1].split("</tr>")[0]).toContain("n.d.");
  });
  // Lignes du tableau de la liste (la saisie en masse, plus bas, répète les noms).
  const listed = (html: string) => [...html.split('data-testid="sal-table"')[1].split("</table>")[0].matchAll(/data-salarie="([^"]*)"/g)].map((m) => m[1]);
  it("recherche sur toutes les colonnes : mot de service, accent ignoré, date ; aucun résultat dit la recherche", () => {
    expect(listed(render({ q: "tech" }))).toEqual(["Alice", "Chloé"]);
    expect(listed(render({ q: "chloe" }))).toEqual(["Chloé"]);
    expect(listed(render({ q: "20/11/2026" }))).toEqual(["Bruno"]);
    expect(listed(render({ q: "démission" }))).toEqual(["Bruno"]);
    expect(listed(render({ q: "sales 2026-11-20" }))).toEqual(["Bruno"]);
    expect(listed(render({ q: "" }))).toEqual(["Alice", "Bruno", "Chloé"]);
    const none = render({ q: "zzz" });
    expect(none).toContain("Aucun salarié ne correspond à « zzz »");
    expect(none).toContain('data-testid="sal-search-clear"');
  });
  it("filtre par service : un service, « Non ventilé » seulement s'il existe, valeur inconnue ignorée, lien conservé", () => {
    expect(listed(render({ service: "SALES" }))).toEqual(["Bruno"]);
    expect(listed(render({ service: "TECH", q: "chloe" }))).toEqual(["Chloé"]);
    expect(listed(render({ service: "SALES", q: "chloe" }))).toEqual([]);
    expect(render({ service: "SALES", q: "chloe" })).toContain("Aucun salarié ne correspond à « chloe » dans ce service.");
    // « Non ventilé » n'est proposé que si un contrat est sans service ; sinon la valeur est ignorée (toute la liste).
    expect(render()).not.toContain('<option value="__nd">');
    expect(listed(render({ service: "__nd" }))).toEqual(["Alice", "Bruno", "Chloé"]);
    expect(listed(render({ service: "INCONNU" }))).toEqual(["Alice", "Bruno", "Chloé"]);
    const noSvc = baseOf([A, contract("D", { label: "Dora", service: null })]);
    const withNd = render({ base: noSvc, hyps: [], proj: projOf(noSvc, []), service: "__nd" });
    expect(listed(withNd)).toEqual(["Dora"]);
    expect(withNd).toContain('<option value="__nd" selected="">Non ventilé</option>');
    expect(render({ service: "TECH" })).toContain("&amp;service=TECH");
    expect(render({ service: "TECH" })).toContain('data-testid="sal-search-clear"');
    expect(render({ service: "TECH", selected: "A" })).toContain("salarie=A&amp;service=TECH");
  });
  it("la recherche d'un service long garde le champ GET et le service courant parmi toutes les options", () => {
    const manyServices = baseOf(Array.from({ length: 10 }, (_, i) => contract(`F${i}`, { label: `Collaborateur fictif ${i}`, service: `Service ${i}` })));
    const html = render({ base: manyServices, hyps: [], proj: projOf(manyServices, []), service: "Service 9" });
    const select = /<select[^>]*id="sal-service"[^>]*>[\s\S]*?<\/select>/.exec(html)?.[0] ?? "";
    expect(select).toContain('name="service"');
    expect(select.match(/<option/g)).toHaveLength(11);
    expect(select).toContain('<option value="Service 9" selected="">Service 9</option>');
    expect(html).toContain('aria-label="Rechercher : Service"');
    expect(select).toContain('<option value="">Tous les services</option>');
  });
  it("pagination : 45 salariés par 20 ; page 2 = 21–40 ; la recherche et le salarié ouvert sont conservés dans les liens", () => {
    const many = baseOf(Array.from({ length: 45 }, (_, i) => contract(`K${String(i + 1).padStart(2, "0")}`, { label: `Salarié ${String(i + 1).padStart(2, "0")}`, service: "TECH" })));
    const p = (over: Partial<Parameters<typeof PostesView>[0]>) => render({ base: many, hyps: [], proj: projOf(many, []), ...over });
    const page2 = p({ page: "2" });
    expect(page2).toContain("21–40 sur 45");
    const rows = listed(page2);
    expect([rows.length, rows[0], rows.at(-1)]).toEqual([20, "Salarié 21", "Salarié 40"]);
    expect(page2).toContain('data-testid="sal-pager-top"');
    expect(p({ page: "3" })).toContain("41–45 sur 45");
    expect(listed(p({ page: "3" })).length).toBe(5);
    expect(listed(p({ page: "9" })).length).toBe(5); // page hors bornes : la dernière
    const q = p({ q: "tech", page: "2", selected: "K25" });
    expect(q).toContain("href=\"/e/demo/studio-rh/hypotheses?scenario=11111111-1111-1111-1111-111111111111&amp;vue=postes&amp;salarie=K25&amp;q=tech&amp;page=3\"");
    // Une seule page : pas de pagination en haut du tableau.
    expect(render()).not.toContain('data-testid="sal-pager-top"');
    expect(render()).toContain("1–3 sur 3");
  });
  it("en-tête fixe et première colonne fixe ; le premier lien du tableau est le nom du salarié", () => {
    const html = render();
    expect(html).toContain('class="data-table sticky sticky-first hs-table" data-testid="sal-table"');
    const body = html.split('data-testid="sal-table"')[1];
    expect(body.indexOf("<a ")).toBeGreaterThan(-1);
    expect(body.slice(body.indexOf("<a "), body.indexOf("</a>"))).toContain("Alice");
  });
  it("actions par ligne : fiche, et création d'événement pour un éditeur seulement ; formulaires de saisie en masse réservés au brouillon", () => {
    const edit = render();
    expect(edit).toContain('aria-label="Créer un événement pour Alice"');
    expect(edit).toContain('data-testid="sal-bulk"');
    const read = render({ canEdit: false });
    expect(read).toContain('aria-label="Ouvrir la fiche de Alice"');
    expect(read).not.toContain("Créer un événement pour");
    expect(read).not.toContain('data-testid="sal-bulk"');
  });
  it("fiche d'un salarié : chaque formulaire d'événement n'a qu'un seul bouton ; « forme » ouvre le bon formulaire", () => {
    const html = render({ selected: "A" });
    for (const id of ["augmentation", "depart", "absence", "ponctuel", "changement", "categorie"]) {
      const block = html.split(`data-testid="sal-form-${id}"`)[1].split("</form>")[0];
      expect(block.match(/<button/g)?.length, id).toBe(1);
    }
    expect(html).toContain('data-testid="sal-fiche-close"');
    expect(html).not.toContain('<details open=""><summary>Départ');
    expect(render({ selected: "A", forme: "depart" })).toContain('<details open=""><summary>Départ');
  });
  it("événements de la fiche : taux en français (virgule), dates en JJ/MM/AAAA comme dans le tableau", () => {
    // 2 500 bps = 25 %, 5 050 bps = 50,50 %, 4 250 bps = 42,50 % ; jamais « 50.5 % » ni une date ISO.
    const list: Hypothesis[] = [
      { id: "r1", kind: "augmentation", label: "Augmentation Alice", from: "2026-11", rateBps: 250, scope: { kind: "contrat", key: "A" } },
      { id: "a2", kind: "absence", label: "Congé Alice", contractKey: "A", from: "2026-10-26", to: "2026-11-25", paidBps: 5050 },
      { id: "d9", kind: "depart", label: "Départ Alice", contractKey: "A", lastPaidDate: "2026-12-10", exitCost: { mode: "brut", brutCents: 100000, chargesBps: 4250 }, motif: null },
      { id: "p9", kind: "ponctuel", label: "Prime Alice", contractKey: "A", service: "TECH", month: "2026-12", amount: { mode: "brut", brutCents: 100000, chargesBps: 3050 }, nonRecurring: false },
    ] as unknown as Hypothesis[];
    const html = flat(render({ selected: "A", hyps: list, proj: projOf(small, list) }));
    const events = html.split('data-testid="sal-events"')[1].split("</table>")[0];
    expect(events).toContain("+2,50 % à compter de novembre 2026");
    expect(events).toContain("du 26/10/2026 au 25/11/2026 · payé à 50,50 %");
    expect(events).toContain("dernier jour payé 10/12/2026");
    expect(events).toContain("1 000 € brut + 42,50 %");
    expect(events).toContain("1 000 € brut + 30,50 %");
    expect(events).not.toMatch(/\d\.\d+ %/);
    expect(events).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
  it("champs de formulaire conservés (noms) et aides courtes reliées aux champs", () => {
    const html = render({ selected: "A" });
    for (const name of ["scope", "label", "rate", "from", "contractKey", "motif", "lastPaidDate", "exitMode", "exitBrut", "exitTaux", "exitCout", "paid", "to", "amountMode", "amountBrut", "amountTaux", "amountCout", "nonRecurring", "service", "quota", "poste", "category"]) expect(html, name).toContain(`name="${name}"`);
    expect(html).toContain('id="s-aug-r-hint"');
    expect(html).toContain('aria-describedby="s-aug-r-hint"');
    expect(html).toContain("Entre octobre 2026 et décembre 2026.");
  });
});

describe("grilles de saisie rendues", () => {
  const rateHyp: Hypothesis = { id: "g27", kind: "augmentation", label: "Générale janv.", from: "2027-01", rateBps: 300, scope: { kind: "global" } };
  const globales = (first: string, last: string, canEdit = true, list: Hypothesis[] = []) => clean(renderToStaticMarkup(h(GlobalesView, { slug: "demo", scenario: scenarioOf(first, last), base: small, hypotheses: list, canEdit })));
  it("deux années : commutateur d'année, une année affichée, toutes les cellules dans le formulaire, étiquettes avec l'année", () => {
    const html = globales("2026-11", "2027-02", true, [rateHyp]);
    expect(html).toContain('data-ys="0"');
    expect(html).toContain('data-testid="grid-year-2026"');
    expect(html).toContain('data-testid="grid-year-2027"');
    expect(html).toContain('aria-label="2027, 1 cellule renseignée"');
    for (const m of ["2026-11", "2026-12", "2027-01", "2027-02"]) expect(html).toContain(`name="rate|global|${m}"`);
    expect(html).toContain('<th class="num" data-yi="0" data-csv="2026-11">nov. 26</th>');
    expect(html).toContain('<th class="num" data-yi="1" data-csv="2027-01">janv. 27</th>');
    // La valeur enregistrée de 2027 est dans la grille (masquée par le style), jamais perdue.
    expect(html).toContain('data-row="s0" data-col="2027-01" data-yi="1" data-cell="true" inputMode="decimal" aria-label="Toute l&#x27;entreprise (hors embauches et entrées après la base), janv. 27 (%)" name="rate|global|2027-01" value="3"');
  });
  it("une seule année : ni commutateur ni rang d'année ; outils de copie et de remplissage sans valeur proposée", () => {
    const html = globales("2026-10", "2026-12");
    expect(html).not.toContain("data-ys");
    expect(html).not.toContain("data-yi");
    expect(html).not.toContain("grid-year-");
    for (const id of ["grid-copy-right", "grid-copy-down", "grid-fill-row", "grid-reset", "grid-csv", "grid-dirty", "fill-s0"]) expect(html, id).toContain(`data-testid="${id}"`);
    // Le champ « Valeur à reporter » est vide : Clair ne propose aucune valeur.
    // (toute la balise : ni attribut value, ni exemple chiffré en texte indicatif).
    const fill = /<input[^>]*data-testid="grid-fill-value"[^>]*>/.exec(html)?.[0] ?? "";
    expect(fill).not.toBe("");
    expect(fill).not.toMatch(/\bvalue=/);
    expect(fill).not.toMatch(/placeholder="[^"]*\d/);
    expect(html).toContain("Cliquez dans une cellule pour la choisir comme point de départ.");
    expect(html).not.toContain("Maj+Entrée"); // le clavier est expliqué au glossaire
  });
  it("lecture seule : tableau exact, export CSV, ni saisie ni outils de modification", () => {
    const html = globales("2026-11", "2027-02", false, [rateHyp]);
    expect(html).not.toContain("<input");
    expect(html).toContain('data-testid="grid-csv"');
    expect(html).not.toContain('data-testid="grid-reset"');
    expect(html).not.toContain('data-testid="grid-copy-down"');
    expect(html).toContain("3 %");
    expect(html).toContain('data-testid="grid-year-2027"');
  });
  it("aucun rôle « status » ni « alert » dans les outils de la grille (réservés au résultat de l'enregistrement)", () => {
    const html = globales("2026-10", "2026-12");
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain('role="alert"');
  });
  it("enveloppes : trois lignes vides à saisir, bouton « Reporter → » par ligne, champs conservés ; une ligne enregistrée garde sa valeur", () => {
    const env: Hypothesis = { id: "e1", kind: "enveloppe", label: "Enveloppe TECH", axis: "service", target: "TECH", monthly: { "2026-11": 100000 }, chargesBps: null };
    const html = clean(renderToStaticMarkup(h(EnveloppesView, { slug: "demo", scenario: scenarioOf("2026-10", "2026-12"), base: small, hypotheses: [env], axis: "service", canEdit: true })));
    expect(html).toContain('data-testid="env-service-table"');
    for (const name of ["target_0", "mode_0", "taux_0", "nr_0", "m_0_2026-11", "del_0", "target_3", "m_3_2026-12"]) expect(html, name).toContain(`name="${name}"`);
    expect(html).not.toContain('name="target_4"');
    expect(html).toContain('data-testid="fill-r0"');
    expect(html).toContain('value="1000"'); // 100 000 centimes = 1 000 €
    expect(html).toContain('<input type="hidden" name="n" value="4"/>');
  });
  it("bases individuelles : « copier vers le bas » seulement, colonnes salaire et charges distinguées", () => {
    const html = clean(renderToStaticMarkup(h(BasesView, { slug: "demo", scenario: scenarioOf("2026-10", "2026-12"), base: small, hypotheses: [], canEdit: true })));
    expect(html).toContain('data-testid="grid-copy-down"');
    for (const id of ["grid-copy-right", "grid-fill-row"]) expect(html, id).not.toContain(`data-testid="${id}"`);
    expect(html).toMatch(/<input class="input" data-cell="true" data-row="b0" data-col="salary"[^>]*name="salary_0"/);
    expect(html).toMatch(/<input class="input" data-cell="true" data-row="b2" data-col="charges"[^>]*name="charges_2"/);
    const read = clean(renderToStaticMarkup(h(BasesView, { slug: "demo", scenario: scenarioOf("2026-10", "2026-12"), base: small, hypotheses: [], canEdit: false })));
    expect(read).not.toContain('name="salary_0"');
    expect(read).not.toContain('data-testid="grid-copy-down"');
  });
});

describe("contrôles des changements rendus", () => {
  const many: Hypothesis[] = Array.from({ length: 30 }, (_, i) => ({ id: `h${i}`, kind: "augmentation", label: `Augmentation ${i + 1}`, from: "2026-11", rateBps: 100 + i, scope: { kind: "global" } }));
  const render = (over: Partial<Parameters<typeof ControlesChangements>[0]> = {}) =>
    clean(renderToStaticMarkup(h(ControlesChangements, { slug: "demo", scenario: scenarioOf("2026-10", "2026-12"), base: small, hypotheses: many, proj: projOf(small, []), canEdit: false, others: [], ...over })));
  it("30 hypothèses par 25 : 1–25 sur 30 puis 26–30 ; recherche dans le détail ; filtre par type", () => {
    expect(render()).toContain("1–25 sur 30");
    expect(render({ page: "2" })).toContain("26–30 sur 30");
    // Seule la trentième (taux de 1,29 %) porte « 1,29 » dans son détail.
    const one = render({ q: "1,29" });
    expect(one).toContain("1–1 sur 1");
    expect(one).toContain('data-hyp="Augmentation 30"');
    expect(render()).toContain('data-testid="hyp-filter"');
    expect(render({ q: "zzz" })).toContain("Aucune hypothèse ne correspond à ce filtre.");
  });
  it("filtre par type : seuls les types présents sont proposés ; un type absent de la liste est ignoré", () => {
    const mixed = [...many, hs[0]];
    const html = render({ hypotheses: mixed, type: "depart" });
    expect(html).toContain("1–1 sur 1");
    expect(html).toContain('data-hyp="Départ Bruno"');
    expect(html).toContain('<option value="depart" selected="">Départ (1)</option>');
    expect(html).toContain('<option value="augmentation">Augmentation (30)</option>');
    expect(html).not.toContain('<option value="absence"');
    expect(render({ type: "absence" })).toContain("1–25 sur 30");
  });
  it("peu d'hypothèses : pas de formulaire de filtre, toutes les lignes (comme avant)", () => {
    const html = render({ hypotheses: hs.slice(0, 4) });
    expect(html).not.toContain('data-testid="hyp-filter"');
    expect(html.match(/<tr data-hyp=/g)?.length).toBe(4);
  });
});

describe("formulaires", () => {
  const noop = async () => undefined;
  it("ActionForm : un seul bouton (le pied de formulaire n'en ajoute pas), pied après le bouton, question de confirmation sans effet sur le rendu", () => {
    const html = renderToStaticMarkup(h(ActionForm, { action: noop, submit: "Enregistrer", testid: "t", footer: h("span", { id: "pied" }, "pied"), confirm: "Sûr ?" }, h("input", { name: "x" })));
    expect(html.match(/<button/g)?.length).toBe(1);
    expect(html).toContain('</button><span id="pied">pied</span>');
    expect(html).toContain('data-testid="t"');
  });
  it("HireForm : les longues listes conservent leurs sentinelles et n'appliquent aucun profil au rendu", () => {
    const profiles = Array.from({ length: 20 }, (_, i) => ({ key: `profil-fictif-${i}`, label: `Profil fictif ${i}`, service: "FICTIF", category: "cdi" as const, grossFullTime: "3123.45", quotaPct: "80.00", chargesPct: "42.50", counted: true, note: "Profil de test" }));
    const deps = Array.from({ length: 20 }, (_, i) => ({ id: `depart-fictif-${i}`, label: `Départ fictif ${i}` }));
    const before = JSON.stringify(profiles);
    const html = clean(renderToStaticMarkup(h(HireForm, { action: noop, profiles, deps })));
    const profileSelect = /<select[^>]*id="hire-copy"[^>]*>[\s\S]*?<\/select>/.exec(html)?.[0] ?? "";
    const replacesSelect = /<select[^>]*id="hire-replaces"[^>]*>[\s\S]*?<\/select>/.exec(html)?.[0] ?? "";
    expect(profileSelect.match(/<option/g)).toHaveLength(21);
    expect(profileSelect).toContain('<option value="" selected="">— saisie libre</option>');
    expect(profileSelect).not.toContain('name="');
    expect(replacesSelect).toContain('name="replaces"');
    expect(replacesSelect.match(/<option/g)).toHaveLength(21);
    expect(replacesSelect).toContain('<option value="" selected="">— (création de poste)</option>');
    expect(html).toContain('aria-label="Rechercher : Profil de départ"');
    expect(html).toContain('aria-label="Rechercher : Poste à remplacer"');
    expect(html).toContain('name="copiedFrom" value=""');
    expect(html).not.toContain('value="3123.45"');
    expect(JSON.stringify(profiles)).toBe(before);
  });
  it("HireForm : champs groupés, aides reliées aux champs, noms de champs conservés, un seul bouton", () => {
    const html = clean(renderToStaticMarkup(h(HireForm, { action: noop, profiles: [], deps: [{ id: "d1", label: "Départ Bruno" }] })));
    expect(html.match(/<fieldset class="hs-group">/g)?.length).toBe(5);
    expect(html.match(/<button/g)?.length).toBe(1);
    for (const name of ["copiedFrom", "label", "count", "service", "category", "motif", "metier", "start", "end", "gross", "quota", "charges", "counted", "replaces"]) expect(html, name).toContain(`name="${name}"`);
    expect(html).toContain('aria-describedby="hire-quota-hint"');
    expect(html).toContain('<label for="hire-label">Poste</label>');
    expect(html).toContain("Départ Bruno");
  });
});
