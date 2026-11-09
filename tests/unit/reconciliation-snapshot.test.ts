import { describe, expect, it } from "vitest";
import { opaqueId, snapshotInputHash, snapshotOf, type SnapshotInputs, type SnapshotRecord } from "@/lib/reconciliation/snapshot";

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = (n: number, collection: string, data: SnapshotRecord["data"], source: "dsn" | "payfit" = "dsn"): SnapshotRecord => ({ id: id(n), syncId: id(source === "dsn" ? 91 : 92), recordHash: `record-${n}`, collection, period: source === "dsn" ? "2026-10" : null, data });
function input(): SnapshotInputs {
  return { workspaceId: "fixture-workspace", controlMonth: "2026-10", dsnSyncs: [{ id: id(91), contentHash: "dsn-fixture" }],
    coverage: [{ id: id(90), month: "2026-10", status: "complete", selected: [{ syncId: id(91), keyHash: "declaration-fixture" }] }],
    dsnRecords: [row(1, "people", { entityId: "fixture-person", familyName: "Fictif", givenNames: "Alice" }),
      row(2, "contracts", { entityId: "fixture-contract", personId: "fixture-person", startDate: "2025-01-01", endDate: null, nature: "01" })],
    payfitSync: { id: id(92), contentHash: "payfit-fixture", referenceDate: "2026-11-05", missingCollections: [] },
    payfitRecords: [row(3, "collaborators", { entityId: "other-person", familyName: "Fictif", givenNames: "Alice" }, "payfit")],
  };
}
describe("snapshot de rapprochement", () => {
  it("conserve les champs limités et une provenance opaque, sans identifiant brut", () => {
    const snapshot = snapshotOf(input());
    expect(snapshot.dsn.persons).toHaveLength(1);
    expect(snapshot.dsn.contracts).toHaveLength(1);
    expect(snapshot.dsn.persons[0].fields.familyName).toEqual({ kind: "value", value: "Fictif", provenance: [{ recordId: id(1), recordHash: "record-1", syncId: id(91), path: "S21.G00.30.002", period: "2026-10" }] });
    expect(JSON.stringify(snapshot)).not.toContain("fixture-person");
    expect(JSON.stringify(snapshot)).not.toContain("fixture-contract");
    expect(snapshot.dsn.persons[0].id).not.toBe(snapshot.payfit.persons[0].id);
    expect(snapshot.dsn.contracts[0].fields.endDate.kind).toBe("nd");
  });
  it("ne perd ni personne isolée ni contrat orphelin ou hors période", () => {
    const source = input();
    source.dsnRecords.push(row(4, "people", { entityId: "unassigned", familyName: null, givenNames: null }));
    source.dsnRecords.push(row(5, "contracts", { entityId: "orphan", personId: "missing-person", startDate: "2027-01-01", endDate: "2027-02-01", nature: "02" }));
    source.dsnRecords.push(row(6, "contracts", { entityId: "without-parent", personId: null, startDate: null, endDate: null, nature: null }));
    const snapshot = snapshotOf(source);
    expect(snapshot.dsn.persons).toHaveLength(3);
    expect(snapshot.dsn.persons.filter((p) => p.origin === "contract-reference")).toHaveLength(1);
    expect(snapshot.dsn.contracts).toHaveLength(3);
    expect(snapshot.dsn.contracts.some((c) => c.periodRelation === "outside-period")).toBe(true);
    expect(snapshot.dsn.contracts.some((c) => c.personId.kind === "nd" && c.personId.reason === "parent-missing")).toBe(true);
  });
  it("garde les contradictions et les absences entre fractions sans choisir de valeur", () => {
    const source = input();
    source.dsnRecords.push(row(7, "people", { entityId: "fixture-person", familyName: "Fictif corrigé", givenNames: null }));
    source.dsnRecords.push(row(8, "contracts", { entityId: "fixture-contract", personId: "different-parent", startDate: "2025-02-01", endDate: null, nature: null }));
    const snapshot = snapshotOf(source);
    const person = snapshot.dsn.persons.find((p) => p.origin === "source")!;
    expect(person.fields.familyName).toMatchObject({ kind: "conflict", values: ["Fictif", "Fictif corrigé"] });
    expect(person.fields.givenNames).toMatchObject({ kind: "conflict", values: ["Alice"], missingReasons: ["not-provided"] });
    expect(snapshot.dsn.contracts[0].personId.kind).toBe("conflict");
    expect(snapshot.dsn.contracts[0].fields.startDate.kind).toBe("conflict");
    expect(snapshot.dsn.contracts[0].periodRelation).toBe("conflict");
  });
  it("rend l'empreinte et le snapshot indépendants de l'ordre", () => {
    const source = input();
    source.coverage.push({ id: id(89), month: "2026-10", status: "incomplete", selected: [{ syncId: id(91), keyHash: "other-declaration" }] });
    source.dsnSyncs.push({ id: id(93), contentHash: "second-dsn" });
    const shuffled = { ...source, dsnRecords: [...source.dsnRecords].reverse(), coverage: [...source.coverage].reverse(), dsnSyncs: [...source.dsnSyncs].reverse() };
    expect(snapshotInputHash(shuffled)).toBe(snapshotInputHash(source));
    expect(snapshotOf(shuffled)).toEqual(snapshotOf(source));
  });
  it("invalide le contrôle quand un contenu appliqué, la sélection ou le mois change", () => {
    const source = input();
    const original = snapshotInputHash(source);
    expect(snapshotInputHash({ ...source, dsnSyncs: [{ id: id(91), contentHash: "new" }] })).not.toBe(original);
    expect(snapshotInputHash({ ...source, controlMonth: "2026-09" })).not.toBe(original);
    expect(snapshotInputHash({ ...source, coverage: [{ ...source.coverage[0], status: "blocked" }] })).not.toBe(original);
    expect(snapshotInputHash({ ...source, dsnRecords: [{ ...source.dsnRecords[0], recordHash: "new" }] })).not.toBe(original);
  });
  it("exclut les horodatages de création et les clés supplémentaires de la signature", () => {
    const source = input();
    const extended = { ...source,
      dsnSyncs: source.dsnSyncs.map((s) => ({ ...s, createdAt: "2026-11-10T12:00:00Z" })),
      payfitSync: { ...source.payfitSync!, createdAt: "2026-11-10T12:00:00Z" },
      coverage: source.coverage.map((c) => ({ ...c, createdAt: "2026-11-10T12:00:00Z" })),
    };
    expect(snapshotInputHash(extended)).toBe(snapshotInputHash(source));
  });
  it("signale l'historique PayFit limité jusqu'au mois anniversaire inclus", () => {
    const source = input();
    const signature = snapshotInputHash(source);
    source.controlMonth = "2025-11";
    expect(snapshotOf(source).payfit).toMatchObject({ historyLimited: true, coverage: "incomplete" });
    expect(snapshotOf(source).payfit.persons).toEqual(snapshotOf(input()).payfit.persons);
    expect(snapshotInputHash(source)).not.toBe(signature);
    source.controlMonth = "2025-12";
    expect(snapshotOf(source).payfit).toMatchObject({ historyLimited: false, coverage: "complete" });
    source.payfitSync!.referenceDate = "2026-03-31";
    source.controlMonth = "2025-03";
    expect(snapshotOf(source).payfit.historyLimited).toBe(true);
    source.controlMonth = "2025-04";
    expect(snapshotOf(source).payfit.historyLimited).toBe(false);
  });
  it("les UUID opaques sont propres à l'espace, à la source et au type", () => {
    const key = "fixture-key";
    const ids = [opaqueId("one", "dsn", "person", key), opaqueId("two", "dsn", "person", key), opaqueId("one", "payfit", "person", key), opaqueId("one", "dsn", "contract", key)];
    expect(new Set(ids).size).toBe(4);
    for (const value of ids) expect(value).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/);
  });
  it("signale couverture bloquée, source manquante et collections non autorisées", () => {
    const source = input(); source.coverage[0].status = "blocked";
    source.payfitSync!.missingCollections = ["contracts"];
    expect(snapshotOf(source).dsn.coverage).toBe("blocked");
    expect(snapshotOf(source).payfit).toMatchObject({ coverage: "incomplete", collectionsMissing: ["contracts"] });
    source.payfitSync = null; source.payfitRecords = [];
    expect(snapshotOf(source).payfit).toMatchObject({ coverage: "missing", referenceDate: null });
  });
});
