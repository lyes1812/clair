import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExplorationView, type ExplorationViewProps } from "@/app/e/[slug]/studio-rh/collaborateurs/ExplorationView";
import type { ExplorationCategory, ExplorationMeasure, ExplorationModel, ExplorationRow } from "@/lib/rh/exploration";
import type { ExplorationAbsenceEvent, ExplorationAbsencesModel } from "@/lib/rh/exploration-absences";
import type { PayrollItemRow, PayrollItemsModel } from "@/lib/rh/payroll-items";

// Données entièrement fictives. Aucun accès à la base, au réseau ou aux contextes authentifiés.
const category = (key: string, label: string): ExplorationCategory => ({ key, label, value: key });
const time = (value: number | null, path: string): ExplorationMeasure => ({ value, reason: value === null ? "Temps fictif non transmis" : null, trace: { source: "payfit", date: "2026-11-01", period: "2026-10", collection: "worked_time", path } });
const rows = (): ExplorationRow[] => [
  { id: "ligne-fictive-1", contractKey: "payfit:contrat-fictif-1", contractLabel: "Contrat fictif 1", personKey: "payfit:personne-fictive", personName: "COLLABORATEUR FICTIF", startDate: "2026-01-01", endDate: null,
    team: category("equipe-a", "Équipe fictive A"), nature: category("cdi", "CDI"), establishment: category("perimetre-fictif", "Périmètre fictif"), state: category("present", "Présent en fin de mois"), inScope: true,
    paidTime: time(160, "paidTime"), workedTime: time(152, "workedTime"), timeUnit: "hours", timeUnitLabel: "h", fteAtRead: time(1, "fte"), notes: [] },
  { id: "ligne-fictive-2", contractKey: "payfit:contrat-fictif-2", contractLabel: "Contrat fictif 2", personKey: "payfit:personne-fictive", personName: "COLLABORATEUR FICTIF", startDate: "2026-01-01", endDate: null,
    team: category("equipe-b", "Équipe fictive B"), nature: category("cdd", "CDD"), establishment: category("perimetre-fictif", "Périmètre fictif"), state: category("present", "Présent en fin de mois"), inScope: true,
    paidTime: time(0, "paidTime"), workedTime: time(0, "workedTime"), timeUnit: "days", timeUnitLabel: "j", fteAtRead: time(0, "fte"), notes: [] },
  { id: "ligne-fictive-3", contractKey: "payfit:contrat-fictif-3", contractLabel: "Contrat fictif 3", personKey: null, personName: null, startDate: null, endDate: null,
    team: { key: "team:missing", label: "Non renseigné", value: null }, nature: category("cdi", "CDI"), establishment: category("perimetre-fictif", "Périmètre fictif"), state: category("out_of_scope", "Hors natures comptées"), inScope: false,
    paidTime: time(0, "paidTime"), workedTime: time(null, "workedTime"), timeUnit: null, timeUnitLabel: "", fteAtRead: time(null, "fte"), notes: ["Contrat fictif sans collaborateur rattaché"] },
];
function model(): ExplorationModel {
  const r = rows();
  return { source: "payfit", month: "2026-10", referenceDate: "2026-11-01", gate: null, coverageKind: "exact", notices: ["Équipes observées à la date de lecture, sans historique d’affectation."], rows: r,
    total: { persons: 1, contracts: 3, observations: 3, withoutPerson: 1, rowIds: r.map((row) => row.id) }, teams: [], natures: [] };
}
function payroll(): PayrollItemsModel {
  const sourceRow = (id: string, cents: number, rubricKey = "primes"): PayrollItemRow => ({ id, attachment: "linked", personKey: "payfit:personne-fictive", personLabel: "COLLABORATEUR FICTIF", contractKey: "payfit:contrat-fictif-1", contractLabel: "Contrat fictif 1", rubricKey, rubricLabel: rubricKey === "primes" ? "Primes fictives" : "Cotisations fictives", amount: { kind: "value", cents }, accountId: rubricKey === "primes" ? "641300" : "645100", accountLabel: rubricKey === "primes" ? "Régularisation fictive" : "Cotisations fictives", operationDate: null, paymentDate: null, startDate: null, endDate: null, provenance: [{ recordId: id, syncId: "lecture-fictive", period: "2026-10", path: "debitCents − creditCents" }] });
  return { source: "payfit", month: "2026-10", kind: "value", reason: null, readAt: "2026-11-01T12:00:00Z", currency: "EUR", coverage: { status: "complete", reason: null },
    rubrics: [{ key: "primes", label: "Primes fictives", role: "brut" }, { key: "cotisations", label: "Cotisations fictives", role: "cotisations" }], rows: [sourceRow("ecriture-fictive-1", -125), sourceRow("ecriture-fictive-2", 0), sourceRow("ecriture-fictive-3", 9900, "cotisations")], totals: [], notices: ["Journal fictif ; rubriques comptables."], sourceRows: 3, filter: { q: "", rubricKey: "" } };
}
function props(mode: ExplorationViewProps["mode"] = "tree"): ExplorationViewProps {
  return { slug: "espace-fictif", mode, filters: { month: "2026-10", q: "", establishment: "", nature: "", team: "", rowAxis: "team", colAxis: "nature", measure: "persons", rubric: "" },
    options: { months: ["2026-09", "2026-10"], establishments: [{ value: "perimetre-fictif", label: "Périmètre fictif" }], natures: [{ value: "01", label: "CDI" }], teams: [{ value: "equipe-a", label: "Équipe fictive A" }] }, exploration: model(), payroll: mode === "rubrique" ? payroll() : undefined };
}
function absenceEvent(over: Partial<ExplorationAbsenceEvent> = {}): ExplorationAbsenceEvent {
  return { id: "absence-fictive", contractKey: "payfit:contrat-fictif-1", personKey: "payfit:personne-fictive", personName: "COLLABORATEUR FICTIF", contractLabel: "Contrat fictif 1", sourceContractId: "contrat-fictif-1", context: "observed", type: "test_maternity", typeLabel: "Congé maternité fictif", status: "approved", statusLabel: "Approuvée", start: { date: "2026-09-01", moment: "beginning-of-day", momentLabel: "Début de journée" }, end: { date: "2026-12-15", moment: "middle-of-day", momentLabel: "Mi-journée" }, position: "overlap", notes: [], ...over };
}
function absences(): ExplorationAbsencesModel {
  return { source: "payfit", month: "2026-10", kind: "value", reason: null, syncId: "lecture-fictive", contracts: rows().map((r) => ({ contractKey: r.contractKey, kind: "value", reason: null, count: 0, label: "Aucune absence remontée", events: [], unpositioned: [] })), unlinked: [], unpositioned: [], notices: [] };
}
const html = (p = props()) => renderToStaticMarkup(createElement(ExplorationView, p));
const testTable = (value: string, name: string) => value.match(new RegExp(`<table[^>]*data-testid="${name}"[\\s\\S]*?<\\/table>`))?.[0] ?? "";
const sourceRow = (value: string, id: string) => value.match(new RegExp(`<tr[^>]*data-row="${id}"[\\s\\S]*?<\\/tr>`))?.[0] ?? "";

describe("Explorations Collaborateurs — interface des observations fictives", () => {
  it("utilise un formulaire GET et préserve les filtres documentés sans ajouter de titre h1", () => {
    const p = props(); p.filters.q = "fictif"; p.filters.nature = "01";
    const value = html(p);
    expect(value).toContain('action="/e/espace-fictif/studio-rh/collaborateurs/tree" method="get"');
    for (const name of ["mois", "q", "etab", "nature", "equipe"]) expect(value).toContain(`name="${name}"`);
    const search = value.match(/<input[^>]*name="q"[^>]*>/)?.[0] ?? "";
    expect(search).toContain('type="search"'); expect(search).toContain('maxLength="80"');
    expect(value).toContain('value="2026-10" selected=""');
    expect(value).toContain('value="01" selected=""');
    expect(value).not.toContain("<h1");
  });

  it("garde la vigilance et les définitions fermées, accessibles par un contrôle natif nommé", () => {
    const value = html();
    const details = value.match(/<details[^>]*data-testid="exploration-vigilance"[^>]*>/)?.[0];
    expect(details).toBeTruthy(); expect(details).not.toContain(" open");
    expect(value).toContain("Équipes observées à la date de lecture");
    expect(value).toContain('summary aria-label="Définition de la vue en arbre"');
    expect(value).toContain("ne déduit ni manager ni lien hiérarchique");
    expect(value.match(/<details class="cxp-help"[^>]*>/)?.[0]).not.toContain(" open");
  });

  it("permet de regrouper les limites dans la vigilance de l’en-tête sans afficher un second bouton", () => {
    const p = props(); p.showVigilance = false;
    const value = html(p);
    expect(value).not.toContain('data-testid="exploration-vigilance"');
    expect(value).toContain('data-testid="exploration-tree"');
    expect(value).toContain('aria-label="Définition de la vue en arbre"');
  });

  it("déplie les regroupements avec des details natifs et conserve les contrats sans personne", () => {
    const value = html();
    expect(value).toContain('data-testid="exploration-tree-node"');
    expect(value).toContain("Équipe fictive A"); expect(value).toContain("Non renseigné");
    expect(value).toContain('href="/e/espace-fictif/studio-rh/collaborateurs/p/payfit%3Apersonne-fictive"');
    expect(value).toContain('href="/e/espace-fictif/studio-rh/collaborateurs/c/payfit%3Acontrat-fictif-3"');
    expect(value).toContain("Contrat sans collaborateur rattaché.");
    expect(value).toContain("1 contrat sans collaborateur rattaché");
  });

  it("croise les mêmes lignes et présente des totaux de personnes distinctes avec leurs constituants", () => {
    const p = props("pivot"); const value = html(p); const table = testTable(value, "exploration-pivot-table");
    expect(value).toContain('tabindex="0" role="region" aria-label="Tableau croisé mensuel des collaborateurs"');
    expect(table).toContain('scope="col"'); expect(table).toContain('scope="row"');
    expect(table).toContain("Total distinct");
    expect(table.match(/<tfoot>[\s\S]*<\/tfoot>/)?.[0]).toContain('aria-label="1 collaborateurs distincts, périmètre filtré');
    expect(table).toContain('aria-label="1 collaborateurs distincts, Équipe fictive A, CDI — voir les contrats"');
    expect(value).toContain("Les personnes sont dédupliquées dans chaque cellule et chaque total");
    expect(value).toContain('name="lignes"'); expect(value).toContain('name="colonnes"'); expect(value).toContain('name="mesure"');
  });

  it("inverse les axes en conservant mois, mesure et filtres, et propose les contrats distincts", () => {
    const p = props("pivot"); p.filters.q = "fictif"; p.filters.measure = "contracts"; p.filters.team = "equipe-a";
    const value = html(p);
    expect(value).toContain('href="?mois=2026-10&amp;q=fictif&amp;etab=&amp;nature=&amp;equipe=equipe-a&amp;lignes=nature&amp;colonnes=team&amp;mesure=contracts"');
    expect(value).toContain('value="contracts" selected=""');
    expect(testTable(value, "exploration-pivot-table").match(/<tfoot>[\s\S]*<\/tfoot>/)?.[0]).toContain('aria-label="3 contrats distincts, périmètre filtré');
  });

  it("distingue les observations d’un même contrat dans deux établissements sans doubler son total", () => {
    const p = props("pivot"); p.exploration!.source = "dsn";
    const first = p.exploration!.rows[0];
    p.exploration!.rows = [
      { ...first, id: "observation-fictive-a", establishment: category("etab-fictif-a", "Établissement fictif A") },
      { ...first, id: "observation-fictive-b", establishment: category("etab-fictif-b", "Établissement fictif B") },
    ];
    p.exploration!.total = { persons: 1, contracts: 1, observations: 2, withoutPerson: 0, rowIds: p.exploration!.rows.map((r) => r.id) };
    p.filters.measure = "contracts";
    const value = html(p); const table = testTable(value, "exploration-pivot-table");
    expect(table).toContain("Établissement fictif A"); expect(table).toContain("Établissement fictif B");
    expect(table).toContain('aria-label="Observations par contrat et périmètre source"');
    expect(table.match(/<tfoot>[\s\S]*<\/tfoot>/)?.[0]).toContain('aria-label="1 contrats distincts, périmètre filtré');
  });

  it("ouvre les observations d’un contrat sans identité même lorsque le nombre de personnes vaut zéro", () => {
    const p = props("pivot"); const orphan = p.exploration!.rows[2];
    p.exploration!.rows = [orphan];
    p.exploration!.total = { persons: 0, contracts: 1, observations: 1, withoutPerson: 1, rowIds: [orphan.id] };
    const table = testTable(html(p), "exploration-pivot-table");
    expect(table).toContain('aria-label="0 collaborateurs distincts, Non renseigné · n.d., CDI — identité manquante — voir les contrats"');
    expect(table).toContain('title="Contrat observé avec identité manquante : ouvrir pour consulter la source."');
    expect(table).toContain('href="/e/espace-fictif/studio-rh/collaborateurs/c/payfit%3Acontrat-fictif-3"');
    expect(table).toContain("Contrat sans collaborateur rattaché.");
  });

  it("distingue une catégorie métier nommée Non renseigné d’un axe réellement manquant", () => {
    const p = props("pivot");
    p.exploration!.rows[0].team = category("equipe-nom-fictif", "Non renseigné");
    p.exploration!.rows = [p.exploration!.rows[0], p.exploration!.rows[2]];
    const table = testTable(html(p), "exploration-pivot-table");
    expect(table).toContain('<th scope="row">Non renseigné</th>');
    expect(table).toContain('<th scope="row">Non renseigné<span class="cxp-category-nd" title="Valeur absente de la source">n.d.</span></th>');
    expect(table.match(/class="cxp-category-nd"/g)).toHaveLength(1);
    p.mode = "tree";
    expect(html(p)).toContain('<span class="cxp-branch-label">Non renseigné<span class="cxp-category-nd"');
  });

  it("pointage : affiche zéro, absence et écart signé sans somme globale ou conversion d’unité", () => {
    const value = html(props("pointage"));
    const first = sourceRow(value, "ligne-fictive-1"); const third = sourceRow(value, "ligne-fictive-3");
    expect(first).toContain('data-col="gap"><span>-8</span>');
    expect(third).toContain('data-col="paid"><span>0</span>');
    expect(third).toContain('data-col="worked"><span class="nd" title="Temps fictif non transmis"');
    expect(third).toContain("écart non calculable");
    expect(value).toContain("Temps payé"); expect(value).toContain("Unité source"); expect(value).toContain("01/11/2026");
    expect(testTable(value, "exploration-pointage-table")).not.toContain("<tfoot");
    expect(value).toContain('aria-label="Pointage mensuel des collaborateurs"');
  });

  it("pointage : expose les événements d’absence avec statut et bornes complètes sans déduire une durée", () => {
    const p = props("pointage"); p.absences = absences();
    p.absences.contracts[0] = { ...p.absences.contracts[0], count: 1, label: "1 événement remonté", events: [absenceEvent()] };
    const value = html(p); const row = sourceRow(value, "ligne-fictive-1");
    expect(row).toContain('data-col="absences"'); expect(row).toContain("1 événement remonté");
    expect(row).toContain('data-testid="pointage-absence-details"'); expect(row).toContain("Congé maternité fictif");
    expect(row).toContain("Approuvée"); expect(row).toContain("01/09/2026"); expect(row).toContain("15/12/2026");
    expect(row).toContain("Début de journée"); expect(row).toContain("Mi-journée");
    expect(row).toContain('href="/e/espace-fictif/donnees/synchro/lecture-fictive"');
    expect(value).toContain("sans calcul de durée ni taux d’absentéisme");
    expect(row).toContain('data-col="paid"><span>160</span>'); expect(row).toContain('data-col="worked"><span>152</span>');
  });

  it("pointage : distingue une lecture d’absences sans événement d’une collection non disponible ou non extraite", () => {
    const p = props("pointage"); p.absences = absences();
    expect(sourceRow(html(p), "ligne-fictive-1")).toContain('data-col="absences"><span>0 événements remontés</span>');
    p.absences.kind = "nd"; p.absences.reason = "Absences et arrêts non extraits de la DSN.";
    p.absences.source = "dsn"; p.absences.contracts = p.absences.contracts.map((r) => ({ ...r, kind: "nd", count: null, reason: p.absences!.reason, label: "n.d." }));
    const row = sourceRow(html(p), "ligne-fictive-1");
    expect(row).toContain('title="Absences et arrêts non extraits de la DSN."');
    expect(row).not.toContain("0 événements remontés");
  });

  it("pointage : garde visibles les dates non positionnables au lieu de les transformer en absence nulle", () => {
    const p = props("pointage"); p.absences = absences();
    const event = absenceEvent({ position: "unpositioned", start: { date: null, moment: null, momentLabel: "Moment non renseigné" }, end: { date: null, moment: null, momentLabel: "Moment non renseigné" } });
    p.absences.contracts[0] = { ...p.absences.contracts[0], kind: "uncertain", count: null, reason: "Dates fictives inconnues : rattachement au mois incertain.", unpositioned: [event] };
    p.absences.unpositioned = [event]; p.absences.notices = ["Un événement ne peut pas être positionné dans le mois."];
    const value = html(p); const row = sourceRow(value, "ligne-fictive-1");
    expect(row).toContain("n.d. — dates à vérifier"); expect(row).toContain("Rattachement au mois non déterminé");
    expect(row).toContain('title="Date de début absente ou non interprétable."');
    expect(row).not.toContain("0 événements remontés");
    expect(value).toContain("1 événement avec période non déterminée");
    expect(value).toContain("Un événement ne peut pas être positionné dans le mois.");
  });

  it("pointage : laisse inspecter un événement sans contrat affiché, sans lui inventer une personne", () => {
    const p = props("pointage"); p.absences = absences();
    p.absences.unlinked = [absenceEvent({ id: "absence-source-non-rattachee", contractKey: null, personKey: null, personName: null, contractLabel: null, sourceContractId: "contrat-source-fictif-inconnu", context: "unlinked", typeLabel: "Événement source sans rattachement" })];
    p.exploration!.rows = []; p.exploration!.total = { persons: 0, contracts: 0, observations: 0, withoutPerson: 0, rowIds: [] };
    const value = html(p);
    expect(value).toContain('data-testid="pointage-absence-exceptions"'); expect(value).toContain("1 événement sans contrat affiché");
    expect(value).toContain("Événement source sans rattachement"); expect(value).not.toContain("COLLABORATEUR FICTIF");
    expect(value).not.toContain("/collaborateurs/p/");
  });

  it("ne révèle aucun constituant lorsque la couverture mensuelle est bloquée", () => {
    const p = props("pivot"); p.exploration!.gate = { code: "month-not-covered", reason: "Mois fictif sans couverture." };
    const value = html(p);
    expect(value).toContain('data-testid="exploration-nd"'); expect(value).toContain("Mois fictif sans couverture.");
    expect(value).not.toContain('data-testid="exploration-pivot-table"');
    expect(value).not.toContain("COLLABORATEUR FICTIF");
  });

  it("rubriques : exige une sélection et limite les filtres à mois, recherche et rubrique", () => {
    const value = html(props("rubrique"));
    expect(value).toContain('data-testid="exploration-choose-rubric"');
    expect(value).toContain('name="rubrique"');
    expect(value).not.toContain('name="etab"'); expect(value).not.toContain('name="nature"'); expect(value).not.toContain('name="equipe"');
    expect(value).not.toContain('data-testid="exploration-rubrique-table"');
    expect(value).not.toContain('data-money-cents=');
  });

  it("conserve un filtre devenu indisponible et refuse une rubrique explicite inconnue", () => {
    const p = props("rubrique"); p.filters.rubric = "rubrique-fictive-absente";
    const value = html(p);
    expect(value).toContain('<option value="rubrique-fictive-absente" selected="">Filtre indisponible</option>');
    expect(value).toContain("Rubrique absente de la source pour ce mois.");
    expect(value).not.toContain('data-testid="exploration-choose-rubric"');
    expect(value).not.toContain('data-testid="exploration-rubrique-table"');
    const tree = props("tree"); tree.filters.team = "equipe-fictive-absente";
    expect(html(tree)).toContain('<option value="equipe-fictive-absente" selected="">Filtre indisponible</option>');
  });

  it("rubriques comptables : ne mélange pas les familles et conserve corrections négatives et zéro explicite", () => {
    const p = props("rubrique"); p.filters.rubric = "primes";
    const value = html(p); const table = testTable(value, "exploration-rubrique-table");
    expect(value).toContain("Rubriques comptables PayFit");
    expect(value).toContain("ne représentent pas les rubriques des bulletins");
    expect(table).toContain('data-money-cents="-125"'); expect(table).toContain('data-money-cents="0"');
    expect(table).not.toContain('data-money-cents="9900"');
    expect(value).toContain('data-money-exact="−1,25');
    expect(value).toContain("Total des lignes affichées");
  });

  it("rubriques : une absence de montant reste n.d. et un lien source manquant ne devient jamais /null", () => {
    const p = props("rubrique"); p.filters.rubric = "primes";
    p.payroll!.rows[0].amount = { kind: "nd", reason: "Montant fictif absent." };
    p.payroll!.rows[0].attachment = "no-contract"; p.payroll!.rows[0].personKey = null; p.payroll!.rows[0].contractKey = null; p.payroll!.rows[0].provenance[0].syncId = null;
    const value = html(p);
    expect(value).toContain('title="Montant fictif absent."');
    expect(value).toContain("Sans contrat dans la source"); expect(value).toContain("Lecture source non renseignée");
    expect(value).not.toContain("/synchro/null");
    const total = value.match(/<dd[^>]*data-testid="exploration-rubric-total"[\s\S]*?<\/dd>/)?.[0] ?? "";
    expect(total).toContain("n.d."); expect(total).not.toContain('data-money-cents="0"');
  });

  it("rubriques : la recherche et le total viennent du même filtre, une recherche vide n’invente pas zéro", () => {
    const p = props("rubrique"); p.filters.rubric = "primes"; p.filters.q = "introuvable-fictif";
    const value = html(p);
    expect(value).toContain('data-testid="exploration-no-payroll-row"');
    expect(value).toContain("Aucune occurrence source pour cette sélection.");
    expect(value).not.toContain('data-money-cents=');
    expect(value).not.toContain("COLLABORATEUR FICTIF");
  });

  it("DSN : nomme les types de rémunération et n’ajoute jamais un total entre types", () => {
    const p = props("rubrique"); p.payroll!.source = "dsn"; p.filters.rubric = "primes";
    const value = html(p);
    expect(value).toContain("Type de rémunération DSN"); expect(value).toContain("Rémunérations déclarées en DSN");
    expect(value).toContain("ils ne sont jamais additionnés entre eux");
    expect(testTable(value, "exploration-rubrique-table")).not.toContain('data-money-cents="9900"');
  });

  it("conserve les centimes exacts aux bornes des entiers sûrs", () => {
    const p = props("rubrique"); p.filters.rubric = "primes";
    p.payroll!.rows = [p.payroll!.rows[0]]; p.payroll!.rows[0].amount = { kind: "value", cents: Number.MAX_SAFE_INTEGER };
    const value = html(p);
    expect(value).toContain('data-money-cents="9007199254740991"');
    expect(value).toContain('data-money-exact="90\u202f071\u202f992\u202f547\u202f409,91');
  });
});
