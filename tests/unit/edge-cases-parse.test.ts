import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPayFitClient, readPayFit } from "@/lib/connectors/payfit/client";
import { parseDsn } from "@/lib/dsn/parser";
import { DSN_EDGES, dsnBytes, PAYFIT_EDGES, payfitEdgeFetch } from "./helpers/edge-cases";

// Les jeux de cas limites doivent d'abord être lus correctement par les lecteurs : c'est la condition pour que
// le référentiel (module 2) puisse les traiter.
const fp = (v: string) => createHash("sha256").update(`ws|${v}`).digest("hex").slice(0, 32);
const read = (spec: Parameters<typeof dsnBytes>[0]) => parseDsn(dsnBytes(spec), { fingerprint: fp }).declarations[0];

describe("cas limites DSN lus par le lecteur", () => {
  it("A1 contrats simultanés : une personne, deux contrats, deux rémunérations rattachées", () => {
    const d = read(DSN_EDGES.simultaneous("2025-06"));
    expect(d.eligible).toBe(true);
    expect(d.people).toHaveLength(1);
    expect(d.contracts.map((c) => c.contractNumber).sort()).toEqual(["K-1", "K-2"]);
    expect(new Set(d.contracts.map((c) => c.personId)).size).toBe(1);
    expect(d.remunerations.map((r) => r.contractNumber).sort()).toEqual(["K-1", "K-2"]);
  });
  it("A4 NTT puis NIR : deux identifiants de personne différents, avertissement NTT", () => {
    const ntt = read(DSN_EDGES.nttThenNir("2025-01", false));
    const nir = read(DSN_EDGES.nttThenNir("2025-02", true));
    expect(ntt.people[0].identifierKind).toBe("ntt");
    expect(ntt.warnings.join(" ")).toContain("identifiant temporaire");
    expect(nir.people[0].identifierKind).toBe("nir");
    expect(ntt.people[0].personId).not.toBe(nir.people[0].personId);
    expect(ntt.contracts[0].contractNumber).toBe(nir.contracts[0].contractNumber);
  });
  it("C8 individu sans contrat : une personne, aucun contrat, déclaration éligible", () => {
    const d = read(DSN_EDGES.personWithoutContract("2025-03"));
    expect(d.eligible).toBe(true);
    expect(d.people).toHaveLength(1);
    expect(d.contracts).toHaveLength(0);
  });
  it("A7 libellé corrigé : même identifiant de personne, nom différent", () => {
    const a = read(DSN_EDGES.renamed("2025-01", "FICTIF"));
    const b = read(DSN_EDGES.renamed("2025-02", "FICTIF-EPOUSE"));
    expect(a.people[0].personId).toBe(b.people[0].personId);
    expect(a.people[0].familyName).not.toBe(b.people[0].familyName);
  });
  it("C6 fin en M+1 : même identifiant de contrat, fin et motif 059 (démission) portés par le second mois", () => {
    const m = read(DSN_EDGES.endInNextMonth("2025-05", undefined));
    const n = read(DSN_EDGES.endInNextMonth("2025-06", "2025-05-31"));
    expect(m.contracts[0].contractId).toBe(n.contracts[0].contractId);
    expect(m.contracts[0].endDate).toBeNull();
    expect(n.contracts[0]).toMatchObject({ endDate: "2025-05-31", endReason: "059" });
  });
  it("C10 renumérotation : même personne, identifiant de contrat différent", () => {
    const a = read(DSN_EDGES.renumbered("2025-01", "OLD-1"));
    const b = read(DSN_EDGES.renumbered("2025-02", "NEW-1"));
    expect(a.people[0].personId).toBe(b.people[0].personId);
    expect(a.contracts[0].contractId).not.toBe(b.contracts[0].contractId);
  });
  it("C11 natures : codes conservés tels quels (01, 29, 80)", () => {
    const d = read(DSN_EDGES.natures("2025-01"));
    expect(d.contracts.map((c) => c.nature).sort()).toEqual(["01", "29", "80"]);
  });
});

describe("cas limites PayFit lus par le client", () => {
  const readEdge = async (name: keyof typeof PAYFIT_EDGES) =>
    readPayFit(createPayFitClient("edge-key-123456", { fetchImpl: payfitEdgeFetch("edge-key-123456", PAYFIT_EDGES[name]), minIntervalMs: 0 }), ["2025-06"]);
  const contracts = (r: Awaited<ReturnType<typeof readEdge>>) => r.records.filter((x) => x.collection === "contracts").map((x) => x.data);

  it("A1 simultanés et A2/A3 réembauche, continuité : tous les contrats lus avec leur collaborateur", async () => {
    expect(contracts(await readEdge("simultaneous")).map((c) => c.collaboratorId)).toEqual(["P-SIM", "P-SIM"]);
    const r = contracts(await readEdge("rehire"));
    expect(r.map((c) => c.contractId).sort()).toEqual(["C-CONT-1", "C-CONT-2", "C-REH-1", "C-REH-2"]);
  });
  it("B2/B3/B5/B6/B7/B8 : PENDING, début nul, contrat sans personne, CDD à fin future ou sans fin, personne sans contrat", async () => {
    const r = await readEdge("incomplete");
    const c = contracts(r);
    expect(c.find((x) => x.contractId === "C-PEND")).toMatchObject({ status: "PENDING", startDate: "2026-12-01" });
    expect(c.find((x) => x.contractId === "C-NOSTART")?.startDate).toBeNull();
    expect(c.find((x) => x.contractId === "C-ORPHAN")?.collaboratorId).toBeNull();
    expect(c.find((x) => x.contractId === "C-CDDFUT")).toMatchObject({ endDate: "2027-03-31", natureContratDsn: "02" });
    expect(c.find((x) => x.contractId === "C-CDDNULL")).toMatchObject({ endDate: null, natureContratDsn: "02" });
    expect(r.records.filter((x) => x.collection === "collaborators").some((x) => x.key === "P-ALONE")).toBe(true);
  });
  it("C11 natures hors salariat conservées (29, 80)", async () => {
    expect(contracts(await readEdge("natures")).map((c) => c.natureContratDsn).sort()).toEqual(["01", "29", "80"]);
  });
});
