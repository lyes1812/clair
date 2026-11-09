import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReconciliationView, type ReconciliationModel } from "@/app/e/[slug]/donnees/rapprochement/ReconciliationView";
import { fieldFingerprint, initialState } from "@/lib/reconciliation/compare";
import type { Cell, Contract, Person, Snapshot } from "@/lib/reconciliation/types";

// Données entièrement fictives et identifiants opaques ; aucun accès à une source ou à la base.
const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const value = (text: string): Cell => ({ kind: "value", value: text, provenance: [{ recordId: id(900), recordHash: "d".repeat(64), syncId: id(901), path: "champ-fictif", period: "2026-06" }] });
const nd = (): Cell => ({ kind: "nd", reason: "not-provided", provenance: [] });
const person = (key: number, familyName: string | null, givenNames: string | null): Person => ({ id: id(key), origin: "source", fields: { familyName: familyName === null ? nd() : value(familyName), givenNames: givenNames === null ? nd() : value(givenNames) } });
const contract = (key: number, parent: number): Contract => ({ id: id(key), personId: value(id(parent)), periodRelation: "in-period", fields: { startDate: value("2026-01-01"), endDate: nd(), nature: value("01") } });
function fixture(linked = true): ReconciliationModel {
  const snapshot: Snapshot = {
    schemaVersion: 1, inputHash: "a".repeat(64),
    dsn: { source: "dsn", version: "b".repeat(64), period: "2026-06", referenceDate: "2026-06-30", coverage: "complete", persons: [person(1, "Exemple DSN A", "Alix"), person(2, null, null), person(3, "Exemple DSN libre", "Camille"), person(4, "Exemple DSN isolé", "Sacha")], contracts: [contract(11, 1), contract(12, 1), contract(13, 3)] },
    payfit: { source: "payfit", version: "c".repeat(64), period: null, referenceDate: "2026-07-05", coverage: "incomplete", persons: [person(101, "Exemple PayFit A", "Alex"), person(102, null, null), person(103, "Exemple PayFit libre", "Charlie")], contracts: [contract(111, 101), contract(112, 101), contract(113, 103)] },
  };
  snapshot.payfit.contracts[0].fields.nature = { kind: "conflict", values: ["01", "02"], missingReasons: ["not-extracted"], provenance: [] };
  const state = initialState(snapshot);
  if (linked) {
    state.revision = 5;
    state.personLinks = [{ dsnId: id(1), payfitId: id(101), revision: 1 }, { dsnId: id(2), payfitId: id(102), revision: 2 }];
    state.contractLinks = [{ dsnId: id(11), payfitId: id(111), revision: 3 }];
    state.unmatched = [{ entity: "person", source: "dsn", id: id(4), comment: "Absence de paire vérifiée sur le contrôle fictif.", revision: 4 }];
    const target = { entity: "person" as const, dsnId: id(1), payfitId: id(101), field: "givenNames" as const };
    state.resolutions = [{ ...target, disposition: "explained", comment: "Différence de prénom documentée dans la fixture.", revision: 5, fingerprint: fieldFingerprint(snapshot, target, state) }];
  }
  const selected = { id: id(800), controlMonth: "2026-06", inputHash: snapshot.inputHash, revision: state.revision, createdAt: "2026-07-05T10:00:00.000Z", createdBy: "auteur-fictif", snapshot, state, stale: false, decisions: linked ? [{ revision: 5, inputHash: snapshot.inputHash, actorId: "auteur-fictif", createdAt: "2026-07-05T10:30:00.000Z", action: { kind: "resolve-field" as const, target: { entity: "person" as const, dsnId: id(1), payfitId: id(101), field: "givenNames" as const }, fingerprint: state.resolutions[0].fingerprint, disposition: "explained" as const, comment: "Différence de prénom documentée dans la fixture." } }] : [] };
  return { months: ["2026-06", "2026-05"], sources: { dsn: { available: true }, payfit: { available: true } }, runs: [{ id: selected.id, controlMonth: selected.controlMonth, createdAt: selected.createdAt }], selected };
}
const save = async () => undefined;
const html = (model = fixture()) => renderToStaticMarkup(createElement(ReconciliationView, { slug: "espace-fictif", model, actions: { create: save, decide: save } }));
const form = (markup: string, testid: string) => markup.match(new RegExp(`<form[^>]*data-testid="${testid}"[\\s\\S]*?<\\/form>`))?.[0] ?? "";
const table = (markup: string, testid: string) => markup.match(new RegExp(`<table[^>]*data-testid="${testid}"[\\s\\S]*?<\\/table>`))?.[0] ?? "";

describe("Rapprochement DSN / PayFit — présentation et formulaires fictifs", () => {
  it("identifie le mois déclaré et la photographie PayFit, avec vigilance fermée et provenance repliée", () => {
    const markup = html();
    expect(markup).toContain("Mois déclaré");
    expect(markup).toContain("Juin 2026");
    expect(markup).toContain("Date de la photographie");
    expect(markup).toContain("05/07/2026");
    expect(markup).toContain("La DSN décrit un mois déclaré");
    const details = markup.match(/<details[^>]*data-testid="rec-vigilance"[^>]*>/)?.[0] ?? "";
    expect(details).toBeTruthy();
    expect(details).not.toContain(" open");
    expect(markup).toContain("Provenance DSN");
    expect(markup).toContain("champ-fictif");
  });

  it("montre toutes les lignes liées, à rapprocher et sans correspondance, y compris les champs source des lignes libres", () => {
    const markup = html();
    const persons = table(markup, "rec-person-table");
    expect(persons.match(/data-testid="rec-row-person-/g)).toHaveLength(5);
    for (const label of ["Exemple DSN libre", "Exemple PayFit libre", "Exemple DSN isolé", "Liée", "À rapprocher", "Sans correspondance constatée"]) expect(persons).toContain(label);
    expect(persons).toContain("Absence de paire vérifiée sur le contrôle fictif.");
    expect(persons).toContain("Voir la ligne DSN");
    expect(table(markup, "rec-contract-table").match(/data-testid="rec-row-contract-/g)).toHaveLength(5);
  });

  it("ne transforme pas deux absences en égalité et distingue conflits, valeurs connues et qualification locale", () => {
    const markup = html();
    const absent = table(markup, "rec-fields-person-1");
    expect(absent.match(/data-status="nd"/g)).toHaveLength(2);
    expect(absent).not.toContain("Valeurs égales");
    const contractFields = table(markup, "rec-fields-contract-0");
    expect(contractFields).toContain('data-status="conflict"');
    expect(contractFields).toContain("Champ non extrait");
    expect(table(markup, "rec-fields-person-0")).toContain('data-status="different"');
    expect(markup).toContain("Écart expliqué");
    expect(markup).toContain("Différence de prénom documentée dans la fixture.");
    expect(markup).not.toContain("demande envoyée");
  });

  it("les deux choix de liaison sont manuels et vides, avec vérification des parents pour les contrats", () => {
    const markup = html(fixture(false));
    const link = form(markup, "rec-link-person");
    expect(link).toContain('<option value="" selected="">Choisir une ligne DSN</option>');
    expect(link).toContain('<option value="" selected="">Choisir d’abord la ligne DSN</option>');
    expect(link).toMatch(/name="payfitId" required="" disabled=""/);
    expect(link).not.toContain('name="fingerprint"');
    expect(link).not.toContain('name="comment"');
    expect(markup).toContain("Lie d’abord les personnes correspondantes.");
    const linked = form(html(), "rec-link-contract");
    expect(linked).toContain(`value="${id(12)}"`);
    expect(linked).not.toContain(`value="${id(13)}"`);
  });

  it("les décisions sont attachées au contrôle et à la ligne, et demandent un commentaire de 500 caractères au plus", () => {
    const markup = html();
    const unlink = form(markup, "rec-unlink-person-0");
    for (const name of ["runId", "revision", "inputHash", "kind", "fingerprint", "dsnId", "payfitId"]) expect(unlink).toContain(`name="${name}"`);
    expect(unlink).toContain('name="comment" rows="2" maxLength="500" required=""');
    expect(unlink).toContain("les liaisons de contrats et les décisions de champs qui en dépendent");
    const resolve = form(markup, "rec-resolve-field-person-0-familyName");
    for (const name of ["entity", "dsnId", "payfitId", "field", "fingerprint", "disposition"]) expect(resolve).toContain(`name="${name}"`);
    expect(resolve).toContain('<option value="" disabled="" selected="">Choisir une qualification</option>');
    expect(resolve).toContain("Correction à demander");
    expect(form(markup, "rec-reopen-field-person-0-givenNames")).toContain('name="comment"');
    expect(form(markup, "rec-reopen-unmatched-person-3")).toContain('name="comment"');
  });

  it("un contrôle obsolète reste consultable avec son journal mais ne porte plus aucune décision", () => {
    const model = fixture(); model.selected!.stale = true;
    const markup = html(model);
    expect(markup).toContain("Contrôle obsolète · consultation seule");
    expect(markup).toContain("Exemple DSN libre");
    expect(markup).toContain('data-testid="rec-journal"');
    expect(markup).toContain("Utilisateur");
    expect(markup).not.toContain("auteur-fictif");
    expect(markup).toContain("05/07/2026 12:30");
    expect(markup).not.toMatch(/data-testid="rec-(?:link|unlink|resolve-field|reopen-field|mark-unmatched|reopen-unmatched)-/);
    expect(markup).toContain('data-testid="rec-create"');
  });

  it("sans sources disponibles, renvoie vers Données et n’invente ni rapprochement ni tableau", () => {
    const model = fixture(); model.selected = null; model.runs = []; model.months = []; model.sources.dsn.available = false; model.sources.payfit.available = false;
    const markup = html(model);
    expect(markup).toContain("DSN appliquée manquante");
    expect(markup).toContain("Lecture PayFit appliquée manquante");
    expect(markup).toContain('href="/e/espace-fictif/donnees">Ouvrir Données');
    expect(markup).not.toContain('data-testid="rec-person-table"');
    expect(markup).not.toContain('data-testid="rec-create"');
    expect(markup).not.toContain("0 ligne");
  });

  it("un ancien contrôle sélectionné conserve son mois et l’historique GET sans déclencher de nouveau contrôle", () => {
    const markup = html();
    expect(form(markup, "rec-create")).toContain('name="controlMonth"');
    expect(form(markup, "rec-create")).toContain('value="2026-06" selected=""');
    expect(form(markup, "rec-history-picker")).toContain('method="get"');
    expect(form(markup, "rec-history-picker")).toContain('name="run"');
    expect(form(markup, "rec-history-picker")).toContain(`value="${id(800)}" selected=""`);
    expect(markup).not.toContain('data-testid="prevu"');
  });

  it("les formulaires des personnes et des contrats ont des identifiants distincts et des labels reliés", () => {
    const markup = html();
    const ids = [...markup.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const match of markup.matchAll(/\sfor="([^"]+)"/g)) expect(ids).toContain(match[1]);
  });

  it("une limite d’historique PayFit précise le risque sans convertir une absence en sortie", () => {
    const model = fixture(); model.selected!.snapshot.payfit.historyLimited = true;
    const markup = html(model);
    expect(markup).toContain("des contrats archivés depuis plus de 12 mois peuvent manquer");
    expect(markup).toContain("Une absence de correspondance ne prouve pas une absence historique de contrat ni une sortie.");
    const vigilance = markup.match(/<details[^>]*data-testid="rec-vigilance"[^>]*>/)?.[0] ?? "";
    expect(vigilance).not.toContain(" open");
  });

  it("le journal affiche le nom de l’auteur résolu, sans son identifiant opaque", () => {
    const model = fixture(); model.actorNames = { "auteur-fictif": "Auteur de démonstration" };
    const markup = html(model);
    expect(table(markup, "rec-journal")).toContain("Auteur de démonstration");
    expect(markup).not.toContain("auteur-fictif");
  });
});
