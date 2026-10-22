import { describe, expect, it } from "vitest";
import { monthRange } from "@/lib/connectors/months";
import { canonicalJson } from "@/lib/crypto";
import { buildFromDsn } from "@/lib/rh/referential/build-dsn";
import { DSN_EDGES, NIR } from "./helpers/edge-cases";
import { PROFILE_A } from "./helpers/reference";
import { dsnBuild, dsnFixtureBuild, dsnInput, edgeFiles, fixtureFiles } from "./helpers/rh";

// Cas de référence (PROFILE_A) sur les DSN fictives mensuelles d'octobre 2024 à septembre 2026.
describe("référentiel DSN — profil A, 24 déclarations complètes", () => {
  const b = dsnFixtureBuild();
  const contract = (id: string) => b.contracts.find((c) => c.externalId === `TEST-A-CONTRACT-${id}`)!;
  const cell = (id: string, month: string) => b.months.find((m) => m.contractKey === contract(id).contractKey && m.month === month)!;

  it("bornes : dernier mois complet 2026-09, date de référence 30/09/2026", () => {
    expect(b.build.presenceFrom).toBe("2024-10");
    expect(b.build.presenceTo).toBe("2026-09");
    expect(b.build.referenceDate).toBe("2026-09-30");
    expect(b.build.summary).toMatchObject({ persons: 8, contracts: 8 });
    expect(b.coverage.every((c) => c.presenceStatus === "complete" && c.timeStatus === "paid_only")).toBe(true);
    expect(b.coverage).toHaveLength(24);
  });

  it("personnes : identifiant = empreinte du NIR, libellés et matricule avec provenance de la dernière déclaration", () => {
    const p = b.persons.find((x) => x.personKey === contract("001").personKey)!;
    expect(p).toMatchObject({ identifierKind: "nir", familyName: "FICTIF", givenNames: "A-001", employeeNumber: "001", siren: "000000000", establishmentIds: ["00000000000011"], hasContract: true, firstDeclaredMonth: "2024-10", lastDeclaredMonth: "2026-09" });
    expect(p.externalId).toMatch(/^[0-9a-f]{32}$/);
    expect(p.provenance.familyName).toMatchObject({ path: "S21.G00.30.002", period: "2026-09", declarationKey: "dsn:00000000000011:2026-09:01:01:11:1" });
    expect(p.fieldsNd.teamName?.code).toBe("not-in-source");
    expect(JSON.stringify(b)).not.toMatch(/2990175\d{6}/);
  });

  it("contrats : dates et natures de la fixture, fin du 003 avec motif 026 et provenance de la déclaration de décembre", () => {
    for (const [id, ref] of Object.entries(PROFILE_A.contracts)) {
      const c = b.contracts.find((x) => x.externalId === id)!;
      expect(c).toMatchObject({ nature: ref.nature, startDate: ref.start, endDate: ref.end, establishmentId: "00000000000011" });
      expect(c.personKey).toBe(`dsn:${b.persons.find((p) => p.employeeNumber === id.slice(-3))!.externalId}`);
    }
    const c3 = contract("003");
    expect(c3).toMatchObject({ endDate: "2025-12-31", endReason: "026", endStatus: "known", firstDeclaredMonth: "2024-10", lastDeclaredMonth: "2025-12" });
    expect(c3.provenance.endDate).toMatchObject({ path: "S21.G00.62.001", declarationKey: "dsn:00000000000011:2025-12:01:01:11:1" });
    expect(c3.provenance.endDate?.label).toBe("DSN 2025-12 · SIRET 00000000000011 · ordre 1 · S21.G00.62.001");
    expect(contract("001").endStatus).toBe("none_cdi");
    expect(b.findings.filter((f) => f.code === "disappeared" || f.code === "declared-gap" || f.code === "declared-after-end")).toHaveLength(0);
  });

  it("événements : 8 entrées, sortie du 003 datée du 31/12/2025, non provisoire (janvier 2026 complet)", () => {
    expect(b.events.filter((e) => e.kind === "entry")).toHaveLength(8);
    const exit = b.events.find((e) => e.kind === "exit")!;
    expect(exit).toMatchObject({ contractKey: contract("003").contractKey, date: "2025-12-31", endReason: "026", flags: [] });
    expect(exit.provenance.endReason?.path).toBe("S21.G00.62.002");
  });

  it("mois déclarés : quotités de la déclaration, versements et temps payé par mois", () => {
    expect(cell("001", "2024-10")).toMatchObject({ presenceBasis: "declared", presentAnyDay: true, presentMonthEnd: true, referenceQuota: 173.33, contractQuota: 173.33, quotaUnit: "10", nature: "01" });
    expect(cell("001", "2025-06")).toMatchObject({ paidTime: 0, paymentCount: 1, timeUnit: "10" });
    expect(cell("002", "2025-07")).toMatchObject({ paymentCount: 0, paidTime: null, presentMonthEnd: true });
    expect(cell("002", "2025-07").fieldsNd.paidTime?.code).toBe("no-activity");
    expect(cell("002", "2025-07").fieldsNd.paymentCount?.code).toBe("no-payment");
    expect(cell("005", "2025-11")).toMatchObject({ paymentCount: 1, paidTime: null });
    expect(cell("005", "2025-11").fieldsNd.paidTime?.code).toBe("no-activity");
    expect(cell("004", "2026-02")).toMatchObject({ paymentCount: 0, presentAnyDay: true, presentMonthEnd: true });
    expect(cell("003", "2025-12").presentMonthEnd).toBe(true);
    expect(b.months.find((m) => m.contractKey === contract("003").contractKey && m.month === "2026-01")).toBeUndefined();
    expect(cell("001", "2024-10").fieldsNd.workedTime?.code).toBe("not-in-source");
    expect(cell("001", "2024-10").provenance.contractQuota?.path).toBe("S21.G00.40.013");
  });

  it("déterminisme : deux constructions donnent le même JSON canonique", () => {
    expect(canonicalJson(dsnFixtureBuild())).toBe(canonicalJson(b));
  });

  it("trou de couverture : 2025-11 absent ⇒ mois « missing », aucune disparition inventée", () => {
    const months = monthRange("2025-09", "2025-12").filter((m) => m !== "2025-11");
    const g = dsnBuild(fixtureFiles(months));
    expect(g.coverage.find((c) => c.month === "2025-11")).toMatchObject({ presenceStatus: "missing" });
    expect(g.coverage.find((c) => c.month === "2025-11")?.presenceReason).toContain("2025-11");
    expect(g.build.presenceTo).toBe("2025-12");
    expect(g.findings.filter((f) => f.code === "disappeared" || f.code === "declared-gap")).toHaveLength(0);
  });
});

describe("référentiel DSN — cas limites", () => {
  it("A1 : deux contrats simultanés, une seule personne", () => {
    const b = dsnBuild(edgeFiles([DSN_EDGES.simultaneous("2025-06")]));
    expect(b.persons).toHaveLength(1);
    expect(b.contracts).toHaveLength(2);
    expect(b.findings.filter((f) => f.code === "simultaneous-contracts")).toHaveLength(1);
  });

  it("A4 : NTT puis NIR pour le même contrat ⇒ deux personnes, constats, aucune fusion", () => {
    const b = dsnBuild(edgeFiles([DSN_EDGES.nttThenNir("2025-01", false), DSN_EDGES.nttThenNir("2025-02", true)]));
    expect(b.persons).toHaveLength(2);
    expect(b.persons.map((p) => p.identifierKind).sort()).toEqual(["nir", "ntt"]);
    expect(b.findings.filter((f) => f.code === "identity-change")).toHaveLength(1);
    expect(b.findings.find((f) => f.code === "identity-change")?.personKeys).toHaveLength(2);
    expect(b.findings.filter((f) => f.code === "ntt-identity")).toHaveLength(1);
    // Le contrat NTT de janvier disparaît en février (mois complet) : signalé, pas de sortie inventée.
    expect(b.contracts.filter((c) => c.endStatus === "disappeared")).toHaveLength(1);
    expect(b.events.filter((e) => e.kind === "exit")).toHaveLength(0);
  });

  it("C8 : individu sans contrat ⇒ fiche sans contrat, constat", () => {
    const b = dsnBuild(edgeFiles([DSN_EDGES.personWithoutContract("2025-03")]));
    expect(b.persons[0].hasContract).toBe(false);
    expect(b.findings.map((f) => f.code)).toContain("person-without-contract");
  });

  it("A7 : nom corrigé ⇒ libellé de la déclaration la plus récente, provenance février", () => {
    const b = dsnBuild(edgeFiles([DSN_EDGES.renamed("2025-01", "FICTIF"), DSN_EDGES.renamed("2025-02", "FICTIF-EPOUSE")]));
    expect(b.persons).toHaveLength(1);
    expect(b.persons[0].familyName).toBe("FICTIF-EPOUSE");
    expect(b.persons[0].provenance.familyName?.period).toBe("2025-02");
  });

  it("C6 : fin portée par la déclaration du mois suivant ⇒ fin et motif retenus, aucun constat « déclaré après sa fin »", () => {
    const b = dsnBuild(edgeFiles([DSN_EDGES.endInNextMonth("2025-05", undefined), DSN_EDGES.endInNextMonth("2025-06", "2025-05-31")]));
    expect(b.contracts[0]).toMatchObject({ endDate: "2025-05-31", endReason: "059", endStatus: "known" });
    expect(b.contracts[0].provenance.endDate?.period).toBe("2025-06");
    expect(b.findings.filter((f) => f.code === "declared-after-end")).toHaveLength(0);
    const may = b.months.find((m) => m.month === "2025-05")!;
    const june = b.months.find((m) => m.month === "2025-06")!;
    expect(may).toMatchObject({ presentAnyDay: true, presentMonthEnd: true });
    expect(june).toMatchObject({ presentAnyDay: false, presentMonthEnd: false, flags: [] });
    // Juin est complet : la sortie de mai n'est pas provisoire. Sans juin, elle le serait.
    expect(b.events.find((e) => e.kind === "exit")?.flags).toEqual([]);
    const alone = dsnBuild(edgeFiles([DSN_EDGES.endInNextMonth("2025-05", "2025-05-31")]));
    expect(alone.events.find((e) => e.kind === "exit")?.flags).toEqual(["provisional"]);
  });

  it("C6 bis : fin déclarée en mai puis contrat redéclaré en juillet sans bloc 62 ⇒ fin conservée, constat", () => {
    const b = dsnBuild(edgeFiles([DSN_EDGES.endInNextMonth("2025-05", "2025-05-31"), DSN_EDGES.endInNextMonth("2025-06", undefined), DSN_EDGES.endInNextMonth("2025-07", undefined)]));
    expect(b.contracts[0]).toMatchObject({ endDate: "2025-05-31", endStatus: "known" });
    expect(b.findings.filter((f) => f.code === "declared-after-end").map((f) => f.month)).toEqual(["2025-06", "2025-07"]);
    expect(b.months.filter((m) => m.flags.includes("declared_after_end"))).toHaveLength(2);
    expect(b.months.every((m) => m.presenceBasis === "declared")).toBe(true);
  });

  it("C10 : renumérotation ⇒ ancien contrat disparu, constat sur les deux, drapeau sur l'entrée du nouveau", () => {
    const b = dsnBuild(edgeFiles([DSN_EDGES.renumbered("2025-01", "OLD-1"), DSN_EDGES.renumbered("2025-02", "NEW-1")]));
    const old = b.contracts.find((c) => c.externalId === "OLD-1")!;
    const neu = b.contracts.find((c) => c.externalId === "NEW-1")!;
    expect(old.endStatus).toBe("disappeared");
    expect(old.fieldsNd.endDate?.code).toBe("disappeared");
    expect(b.findings.find((f) => f.code === "renumbered")?.contractKeys.sort()).toEqual([old.contractKey, neu.contractKey].sort());
    expect(b.events.find((e) => e.contractKey === neu.contractKey && e.kind === "entry")?.flags).toContain("renumbered");
    expect(b.months.find((m) => m.contractKey === old.contractKey && m.month === "2025-02")).toMatchObject({ presenceBasis: "not_declared", presentMonthEnd: false });
    expect(b.persons).toHaveLength(1);
  });

  it("C7 bis : contrat absent d'un mois complet entre deux déclarations ⇒ ligne non déclarée et constat", () => {
    const b = dsnBuild(edgeFiles([DSN_EDGES.renamed("2025-01", "FICTIF"), DSN_EDGES.personWithoutContract("2025-02"), DSN_EDGES.renamed("2025-03", "FICTIF")]));
    const k1 = b.contracts.find((c) => c.externalId === "K-1")!;
    expect(k1.endStatus).toBe("none_cdi");
    expect(b.findings.filter((f) => f.code === "declared-gap")).toMatchObject([{ month: "2025-02" }]);
    expect(b.months.find((m) => m.contractKey === k1.contractKey && m.month === "2025-02")?.presenceBasis).toBe("not_declared");
  });

  it("A4 bis : la provenance de la personne d'un contrat cite la rubrique NTT (S21.G00.30.020) pour un identifiant temporaire", () => {
    const b = dsnBuild(edgeFiles([DSN_EDGES.nttThenNir("2025-01", false)]));
    expect(b.contracts[0].provenance.personKey?.path).toBe("S21.G00.30.020");
    expect(dsnBuild(edgeFiles([DSN_EDGES.nttThenNir("2025-02", true)])).contracts[0].provenance.personKey?.path).toBe("S21.G00.30.001");
  });

  it("C4 : contrat présent dans deux fractions retenues du même mois ⇒ une ligne, versements et activités cumulés, constat fraction-duplicate", () => {
    const frac = (fraction: string, gross: string | undefined, measure?: string) => ({
      ...DSN_EDGES.renamed("2025-04", "FICTIF"),
      fraction,
      people: [{ nir: NIR.a, employeeNumber: "A", contracts: [{ number: "K-1", start: "2025-01-01", gross, activities: measure ? [{ measure }] : undefined }] }],
    });
    const b = dsnBuild(edgeFiles([frac("12", undefined), frac("22", "1000.00", "151.67")]));
    expect(b.coverage[0]).toMatchObject({ presenceStatus: "complete" });
    expect(b.months).toHaveLength(1);
    expect(b.months[0]).toMatchObject({ paymentCount: 1, paidTime: 151.67, timeUnit: "10", presentMonthEnd: true });
    expect(b.months[0].fieldsNd.paymentCount).toBeUndefined();
    expect(b.findings.filter((f) => f.code === "fraction-duplicate")).toHaveLength(1);
    expect(b.findings.filter((f) => f.code === "fraction-conflict")).toHaveLength(0);
    // Attributs différents entre fractions : la première (ordre, clé) fait foi et le désaccord est signalé.
    const quota = (fraction: string, q: string) => ({ ...DSN_EDGES.renamed("2025-04", "FICTIF"), fraction, people: [{ nir: NIR.a, employeeNumber: "A", contracts: [{ number: "K-1", start: "2025-01-01", quota: q, gross: "1000.00" }] }] });
    const conflict = dsnBuild(edgeFiles([quota("12", "151.67"), quota("22", "121.33")]));
    expect(conflict.months[0].contractQuota).toBe(151.67);
    expect(conflict.findings.filter((f) => f.code === "fraction-conflict")).toMatchObject([{ month: "2025-04", severity: "check" }]);
  });

  it("E2 : somme des activités de type 01, exclusion des autres types, unités mixtes ⇒ n.d., somme sans bruit flottant", () => {
    const decl = (activities: { type?: string; unit?: string; measure: string }[]) => ({ ...DSN_EDGES.renamed("2025-04", "FICTIF"), people: [{ nir: NIR.a, employeeNumber: "A", contracts: [{ number: "K-1", start: "2025-01-01", gross: "1000.00", activities }] }] });
    const sum = dsnBuild(edgeFiles([decl([{ measure: "100.50" }, { measure: "50.25" }, { type: "02", measure: "7.00" }])])).months[0];
    expect(sum).toMatchObject({ paidTime: 150.75, timeUnit: "10", paymentCount: 1 });
    const mixed = dsnBuild(edgeFiles([decl([{ measure: "10.00", unit: "10" }, { measure: "2.00", unit: "20" }])])).months[0];
    expect(mixed.paidTime).toBeNull();
    expect(mixed.fieldsNd.paidTime).toMatchObject({ code: "mixed-units" });
    expect(dsnBuild(edgeFiles([decl([{ measure: "1.10" }, { measure: "2.20" }])])).months[0].paidTime).toBe(3.3);
    expect(dsnBuild(edgeFiles([decl([{ type: "02", measure: "7.00" }])])).months[0].fieldsNd.paidTime?.code).toBe("no-activity");
  });

  it("C6 : deux fins différentes déclarées ⇒ la plus récente fait foi et un constat end-conflict porte les deux valeurs", () => {
    const b = dsnBuild(edgeFiles([DSN_EDGES.endInNextMonth("2025-05", "2025-05-31"), { ...DSN_EDGES.endInNextMonth("2025-06", "2025-06-15"), people: [{ nir: NIR.a, employeeNumber: "A", contracts: [{ number: "K-1", start: "2025-01-01", end: "2025-06-15", endReason: "035", gross: "1000.00" }] }] }]));
    expect(b.contracts[0]).toMatchObject({ endDate: "2025-06-15", endReason: "035" });
    const f = b.findings.find((x) => x.code === "end-conflict")!;
    expect(f.severity).toBe("check");
    expect((f.detail.values as { endDate: string }[]).map((v) => v.endDate)).toEqual(["2025-05-31", "2025-06-15"]);
  });

  it("C5 : contrat déclaré par deux établissements le même mois ⇒ deux lignes, un constat multi-establishment", () => {
    const b = dsnBuild(edgeFiles([{ ...DSN_EDGES.renamed("2025-04", "FICTIF"), nic: "00011" }, { ...DSN_EDGES.renamed("2025-04", "FICTIF"), nic: "00029" }]));
    expect(b.contracts).toHaveLength(1);
    expect(b.months.map((m) => m.establishmentId).sort()).toEqual(["00000000000011", "00000000000029"]);
    expect(b.findings.filter((f) => f.code === "multi-establishment")).toMatchObject([{ month: "2025-04" }]);
    expect(b.persons[0].establishmentIds).toEqual(["00000000000011", "00000000000029"]);
  });

  it("C5 bis : un établissement qui cesse de déclarer ⇒ mois manquants jusqu'au dernier mois vu ailleurs", () => {
    const b = dsnBuild(edgeFiles([
      { ...DSN_EDGES.renamed("2025-01", "FICTIF"), nic: "00011" },
      { ...DSN_EDGES.renamed("2025-02", "FICTIF"), nic: "00011" },
      { month: "2025-02", nic: "00029", people: [{ nir: NIR.b, employeeNumber: "B", contracts: [{ number: "K-B", start: "2025-01-01", gross: "900.00" }] }] },
      { month: "2025-03", nic: "00029", people: [{ nir: NIR.b, employeeNumber: "B", contracts: [{ number: "K-B", start: "2025-01-01", gross: "900.00" }] }] },
    ]));
    const cov = (siret: string, month: string) => b.coverage.find((c) => c.establishmentId === siret && c.month === month);
    expect(cov("00000000000011", "2025-03")).toMatchObject({ presenceStatus: "missing" });
    // Un établissement qui apparaît plus tard n'est pas réputé manquant avant sa première déclaration (décision par défaut).
    expect(cov("00000000000029", "2025-01")).toBeUndefined();
  });

  it("C12 / C9 bis : quotité modifiée entre deux mois ⇒ constat info ; contrat déclaré avant son début ⇒ absent, drapeau", () => {
    const amended = dsnBuild(edgeFiles([{ ...DSN_EDGES.renamed("2025-01", "FICTIF"), people: [{ nir: NIR.a, employeeNumber: "A", contracts: [{ number: "K-1", start: "2025-01-01", quota: "151.67", gross: "1000.00" }] }] }, { ...DSN_EDGES.renamed("2025-02", "FICTIF"), people: [{ nir: NIR.a, employeeNumber: "A", contracts: [{ number: "K-1", start: "2025-01-01", quota: "121.33", gross: "800.00" }] }] }]));
    expect(amended.findings.filter((f) => f.code === "attributes-changed")).toMatchObject([{ month: "2025-02" }]);
    expect(amended.months.find((m) => m.month === "2025-02")?.contractQuota).toBe(121.33);
    const early = dsnBuild(edgeFiles([{ month: "2025-03", people: [{ nir: NIR.a, employeeNumber: "A", contracts: [{ number: "K-E", start: "2025-04-01" }] }] }]));
    expect(early.months[0]).toMatchObject({ presentAnyDay: false, presentMonthEnd: false, flags: ["declared_before_start"] });
    expect(early.findings.map((f) => f.code)).toContain("declared-before-start");
    expect(early.events.find((e) => e.kind === "entry")?.flags).toEqual(["future"]);
  });

  it("C7 bis : fin future déclarée puis contrat absent des mois complets avant sa fin ⇒ lignes non déclarées et constats", () => {
    const b = dsnBuild(edgeFiles([DSN_EDGES.endInNextMonth("2025-05", "2025-12-31"), DSN_EDGES.personWithoutContract("2025-06"), DSN_EDGES.personWithoutContract("2025-07")]));
    const k1 = b.contracts.find((c) => c.externalId === "K-1")!;
    expect(k1).toMatchObject({ endStatus: "known", endDate: "2025-12-31", lastDeclaredMonth: "2025-05" });
    expect(b.months.filter((m) => m.contractKey === k1.contractKey && m.presenceBasis === "not_declared").map((m) => m.month)).toEqual(["2025-06", "2025-07"]);
    expect(b.findings.filter((f) => f.code === "declared-gap").map((f) => f.month)).toEqual(["2025-06", "2025-07"]);
  });

  it("entrées malformées : contrat sans identifiant de personne ⇒ erreur claire", () => {
    const input = dsnInput(edgeFiles([DSN_EDGES.renamed("2025-04", "FICTIF")]));
    for (const r of input.records) if (r.collection === "contracts") delete r.data.personId;
    expect(() => buildFromDsn(input)).toThrow(/sans identifiant de personne/);
  });

  it("C11 : natures 01, 29 et 80 conservées", () => {
    const b = dsnBuild(edgeFiles([DSN_EDGES.natures("2025-04")]));
    expect(b.contracts.map((c) => c.nature).sort()).toEqual(["01", "29", "80"]);
  });

  it("C2 : seules les déclarations retenues sont lues ; un mois bloqué n'alimente rien", () => {
    const normal = { ...DSN_EDGES.natures("2025-04"), order: "1" };
    const replace = { ...DSN_EDGES.natures("2025-04"), type: "03" as const, order: "2", people: [{ nir: NIR.a, employeeNumber: "A", contracts: [{ number: "K-1", start: "2025-01-01", nature: "01", gross: "1000.00" }] }] };
    const b = dsnBuild(edgeFiles([normal, replace]));
    expect(b.coverage[0].presenceStatus).toBe("complete");
    expect(b.contracts).toHaveLength(1);
    const blocked = dsnBuild(edgeFiles([{ ...normal, order: "5" }, { ...replace, type: "01" as const, order: "5" }]));
    expect(blocked.coverage[0].presenceStatus).toBe("blocked");
    expect(blocked.contracts).toHaveLength(0);
    expect(blocked.build.presenceTo).toBeNull();
    expect(blocked.build.referenceDate).toBeNull();
  });
});
