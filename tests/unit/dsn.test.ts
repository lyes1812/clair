import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fixtureDsnBytes, fixtureDsnText } from "@/lib/dsn/fixture";
import { DsnError, parseDsn } from "@/lib/dsn/parser";
import { selectDeclarations, type SelectableDeclaration } from "@/lib/dsn/selection";

const fp = (ws: string) => (v: string) => createHash("sha256").update(`${ws}|${v}`).digest("hex").slice(0, 32);
const parse = (text: string, ws = "ws") => parseDsn(new TextEncoder().encode(text), { fingerprint: fp(ws) });
const replaceLine = (text: string, code: string, value: string) => text.replace(new RegExp(`^${code.replace(/\./g, "\\.")},'[^\\r\\n]*'`, "m"), `${code},'${value}'`);

describe("lecture d'une DSN fictive (profil A, octobre 2024)", () => {
  const r = parseDsn(fixtureDsnBytes({ month: "2024-10" }), { fingerprint: fp("ws") });
  const d = r.declarations[0];

  it("reconnaît la norme, la déclaration et l'établissement", () => {
    expect(r.norm).toBe("P26V01");
    expect(r.encoding).toBe("utf-8");
    expect(r.declarations).toHaveLength(1);
    expect(d).toMatchObject({ month: "2024-10", siren: "000000000", siret: "00000000000011", nature: "01", type: "01", fraction: "11", order: "1", eligible: true });
    expect(d.blocking).toEqual([]);
  });

  it("cas de référence : 6 contrats actifs, rémunérations brutes = 13 840,00 € en centimes exacts", () => {
    expect(d.people).toHaveLength(6);
    expect(d.contracts).toHaveLength(6);
    expect(d.remunerations.reduce((s, x) => s + x.amountCents, 0)).toBe(1384000);
    expect(d.remunerations.find((x) => x.contractNumber === "TEST-A-CONTRACT-001")?.amountCents).toBe(300000);
  });

  it("cas de référence : contrat 001, activité 160 h et quotités 173,33 / 173,33", () => {
    expect(d.activities.find((a) => a.contractNumber === "TEST-A-CONTRACT-001")?.measure).toBe(160);
    expect(d.contracts.find((c) => c.contractNumber === "TEST-A-CONTRACT-001")).toMatchObject({ referenceQuota: 173.33, contractQuota: 173.33, startDate: "2024-10-01", endDate: null });
  });

  it("ne renvoie jamais le NIR ; conserve matricule et numéro de contrat pour le rapprochement", () => {
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/2990175\d{6}/);
    expect(d.people.find((p) => p.employeeNumber === "001")).toBeTruthy();
    expect(d.people.every((p) => p.identifierKind === "nir")).toBe(true);
  });

  it("identifiant de personne stable d'un mois à l'autre, différent d'un espace à l'autre", () => {
    const nov = parseDsn(fixtureDsnBytes({ month: "2024-11" }), { fingerprint: fp("ws") }).declarations[0];
    const other = parseDsn(fixtureDsnBytes({ month: "2024-10" }), { fingerprint: fp("autre") }).declarations[0];
    const idOf = (x: typeof d, n: string) => x.people.find((p) => p.employeeNumber === n)!.personId;
    expect(idOf(nov, "001")).toBe(idOf(d, "001"));
    expect(idOf(other, "001")).not.toBe(idOf(d, "001"));
  });

  it("empreinte du fichier : identique pour les mêmes octets", () => {
    expect(parseDsn(fixtureDsnBytes({ month: "2024-10" }), { fingerprint: fp("ws") }).hash).toBe(r.hash);
  });

  it("fin de contrat : le CDD 003 se termine le 31/12/2025", () => {
    const dec = parseDsn(fixtureDsnBytes({ month: "2025-12" }), { fingerprint: fp("ws") }).declarations[0];
    expect(dec.contracts.find((c) => c.contractNumber === "TEST-A-CONTRACT-003")?.endDate).toBe("2025-12-31");
  });
});

describe("contrôles", () => {
  const base = fixtureDsnText({ month: "2024-10" });

  it("Windows-1252 accepté avec avertissement, accents conservés", () => {
    // « é » encodé sur un octet (0xE9) : invalide en UTF-8, valide en Windows-1252.
    const text = base.replace("S21.G00.30.002,'FICTIF'", "S21.G00.30.002,'FICTIF\u00e9'");
    const bytes = Uint8Array.from([...text].map((c) => c.charCodeAt(0)));
    const r = parseDsn(bytes, { fingerprint: fp("ws") });
    expect(r.encoding).toBe("windows-1252");
    expect(r.warnings.some((w) => w.includes("Windows-1252"))).toBe(true);
    expect(r.declarations[0].people.some((p) => p.familyName === "FICTIF\u00e9")).toBe(true);
  });
  it("syntaxe invalide : refus du fichier avec le numéro de ligne, sans le contenu", () => {
    const bad = base.replace("S21.G00.30.002,'FICTIF'", "S21.G00.30.002,\"SECRET\"");
    expect(() => parse(bad)).toThrow(DsnError);
    try { parse(bad); } catch (e) { expect((e as Error).message).toMatch(/Ligne \d+/); expect((e as Error).message).not.toContain("SECRET"); }
  });
  it("norme inconnue : déclaration non éligible", () => {
    const d = parse(replaceLine(base, "S10.G00.00.006", "P27V01")).declarations[0];
    expect(d.eligible).toBe(false);
    expect(d.blocking.join(" ")).toContain("P27V01");
  });
  it("pied de fichier incohérent : non éligible", () => {
    expect(parse(replaceLine(base, "S90.G00.90.001", "3")).declarations[0].blocking.join(" ")).toContain("rubriques annoncées");
  });
  it.each([
    ["S20.G00.05.002", "02", "Type de déclaration"],
    ["S20.G00.05.001", "02", "Nature"],
    ["S20.G00.05.005", "15102024", "Mois principal"],
    ["S21.G00.06.001", "12345", "SIREN"],
  ])("%s = %s → bloquant (%s)", (code, value, message) => {
    expect(parse(replaceLine(base, code, value)).declarations[0].blocking.join(" ")).toContain(message);
  });
  it("rubrique dupliquée et contradictoire : bloquant", () => {
    const dup = base.replace("S21.G00.40.007,'01'", "S21.G00.40.007,'01'\r\nS21.G00.40.007,'02'").replace(/S90\.G00\.90\.001,'(\d+)'/, (_, n) => `S90.G00.90.001,'${Number(n) + 1}'`);
    expect(parse(dup).declarations[0].blocking.join(" ")).toContain("dupliquée et contradictoire");
  });
  it("rémunération sur un contrat inconnu : bloquant", () => {
    const bad = base.replace("S21.G00.51.010,'TEST-A-CONTRACT-001'", "S21.G00.51.010,'INCONNU'");
    expect(parse(bad).declarations[0].blocking.join(" ")).toContain("contrat inconnu");
  });
  it("montant négatif accepté (régularisation), en centimes exacts", () => {
    const neg = base.replace("S21.G00.51.013,'3000.00'", "S21.G00.51.013,'-0.03'");
    expect(parse(neg).declarations[0].remunerations.find((x) => x.contractNumber === "TEST-A-CONTRACT-001")?.amountCents).toBe(-3);
  });
  it("aucune déclaration : refus", () => {
    expect(() => parse("S10.G00.00.006,'P26V01'\r\nS90.G00.90.001,'2'\r\nS90.G00.90.002,'0'\r\n")).toThrow(/Aucune déclaration/);
  });
});

describe("sélection des déclarations qui font foi", () => {
  const decl = (o: Partial<SelectableDeclaration>): SelectableDeclaration => ({
    key: `k-${o.type ?? "01"}-${o.fraction ?? "11"}-${o.order ?? "1"}`, siret: "00000000000011", month: "2026-01", nature: "01",
    type: "01", fraction: "11", order: "1", eligible: true, blocking: [], sourceId: "s1", contentHash: "h1", ...o,
  });
  it("une normale seule : complète", () => {
    expect(selectDeclarations([decl({})])[0]).toMatchObject({ status: "complete" });
  });
  it("annule et remplace (03, ordre 2) après une normale (01, ordre 1) : la 03 fait foi", () => {
    const [r] = selectDeclarations([decl({}), decl({ type: "03", order: "2", sourceId: "s2", contentHash: "h2" })]);
    expect(r.selected.map((d) => d.type)).toEqual(["03"]);
    expect(r.excluded[0].reason).toContain("remplacée");
    expect(r.status).toBe("complete");
  });
  it("numéros d'ordre au-delà de 2^53 comparés exactement", () => {
    const [r] = selectDeclarations([decl({ order: "9007199254740993" }), decl({ type: "03", order: "9007199254740994", sourceId: "s2", contentHash: "h2" })]);
    expect(r.selected[0].order).toBe("9007199254740994");
  });
  it("annule et remplace sans normale : incomplète", () => {
    expect(selectDeclarations([decl({ type: "03", order: "2" })])[0].status).toBe("incomplete");
  });
  it("fraction 1/2 seule : incomplète ; 1/2 + 2/2 : complète", () => {
    expect(selectDeclarations([decl({ fraction: "12" })])[0].messages.join(" ")).toContain("manque 2/2");
    expect(selectDeclarations([decl({ fraction: "12" }), decl({ fraction: "22", sourceId: "s2", contentHash: "h2" })])[0].status).toBe("complete");
  });
  it("deux déclarations différentes avec le même numéro d'ordre : bloquée", () => {
    expect(selectDeclarations([decl({}), decl({ sourceId: "s2", contentHash: "autre" })])[0].status).toBe("blocked");
  });
  it("copie identique du même contenu : dédoublonnée", () => {
    const [r] = selectDeclarations([decl({}), decl({ sourceId: "s2" })]);
    expect(r.status).toBe("complete");
    expect(r.selected).toHaveLength(1);
  });
  it("déclaration non éligible : exclue avec sa raison", () => {
    const [r] = selectDeclarations([decl({ eligible: false, blocking: ["SIREN invalide"] })]);
    expect(r.status).toBe("blocked");
    expect(r.excluded[0].reason).toBe("SIREN invalide");
  });
});
