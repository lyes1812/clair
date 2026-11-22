import { describe, expect, it } from "vitest";
import { buildBankLedger, type AccountRecord, type StatementRecord } from "@/lib/bank/ledger";
import { bankCheck, controlFec, fecReport, freshnessCheck, periodCheck, type FecCheck } from "@/lib/fec/controls";
import { COMPANY_FEC_FILENAME, companyFecBytes, companyFecText, encodeWindows1252, largeFecText } from "@/lib/fec/fixture-company";

// Cap 13, lot L1 : contrôles F01 à F09 sur les cinq FEC de test du cahier des charges (tous fictifs) :
// conforme, déséquilibré, Windows-1252 à barres verticales, Montant/Sens, 200 000 lignes.
const enc = (s: string) => new TextEncoder().encode(s);
const byCode = (checks: FecCheck[]) => Object.fromEntries(checks.map((c) => [c.code, c]));
const acc = (accountKey: string): AccountRecord => ({ accountKey, masked: `FR76 … ${accountKey}`, identifierKind: "iban", bank: null });
const st = (accountKey: string, to: string, closing: number): StatementRecord => ({
  accountKey, filename: `${to}.xml`, format: "camt053", from: `${to.slice(0, 8)}01`, to, opening: null, closing: { date: to, cents: closing }, movementCount: 0, netCents: 0, continuity: { kind: "ok" },
});

describe("FEC conforme (cas de référence écrit à la main)", () => {
  const r = controlFec(companyFecBytes(), COMPANY_FEC_FILENAME);
  const c = byCode(r.controls.checks);

  it("aucun contrôle bloquant ; 33 lignes, 13 écritures, 111 000,00 € au débit et au crédit", () => {
    expect(r.blocked).toBe(false);
    expect(r.parsed!.lines).toHaveLength(33);
    expect(r.parsed!.entryCount).toBe(13);
    expect(r.parsed!.totalDebitCents).toBe(11_100_000);
    expect(r.parsed!.totalCreditCents).toBe(11_100_000);
    for (const code of ["F01", "F02", "F03", "F04", "F05", "F07"]) expect(c[code]).toMatchObject({ status: "ok" });
    expect(c.F01.severity).toBe("blocking");
    expect(c.F05.severity).toBe("warning");
  });

  it("F09 : soldes fournisseurs par auxiliaire et part non lettrée (4 000,00 € dont 3 700,00 € non lettrés, 92,5 %)", () => {
    const s = r.controls.suppliers!;
    expect(s.count).toBe(3);
    expect(s.balanceCents).toBe(400_000);
    expect(s.unletteredCents).toBe(370_000);
    expect(s.unletteredPermille).toBe(925);
    expect(s.top.map((x) => [x.auxiliary, x.balanceCents, x.unletteredCents])).toEqual([["F001", 300_000, 300_000], ["F002", 70_000, 70_000], ["F003", 30_000, 0]]);
    expect(c.F09).toMatchObject({ severity: "info", status: "ok" });
    expect(c.F09.detail).toContain("92,5 %");
  });

  it("F06 : fraîcheur mesurée à la date de référence (45 jours au plus)", () => {
    expect(freshnessCheck("2026-10-31", "2026-11-21")).toMatchObject({ code: "F06", severity: "strong", status: "ok" });
    expect(freshnessCheck("2026-10-31", "2026-12-15")).toMatchObject({ status: "ok" }); // 45 jours pile
    const stale = freshnessCheck("2026-10-31", "2026-12-16");
    expect(stale).toMatchObject({ status: "fail", severity: "strong" });
    expect(stale.detail).toContain("46 jours");
  });

  it("F08 : solde 512 au 31/10/2026 = 15 000,00 € ; relevé à 1 € près accepté, écart de 1,50 € signalé", () => {
    const at = (cents: number) => buildBankLedger([acc("K1")], [st("K1", "2026-10-31", cents)], []);
    const e = { firstDate: r.parsed!.firstDate, lastDate: r.parsed!.lastDate };
    expect(bankCheck(r.controls.bank512, e, at(1_500_000))).toMatchObject({ code: "F08", status: "ok", gapCents: 0 });
    expect(bankCheck(r.controls.bank512, e, at(1_499_920))).toMatchObject({ status: "ok", gapCents: 80 });
    const gap = bankCheck(r.controls.bank512, e, at(1_499_850));
    expect(gap).toMatchObject({ status: "fail", severity: "warning", gapCents: 150 });
    expect(gap.detail).toMatch(/1,50/);
  });

  it("F08 : n.d. avec sa raison, jamais zéro", () => {
    const e = { firstDate: "2026-01-01", lastDate: "2026-10-31" };
    expect(bankCheck(r.controls.bank512, e, [])).toMatchObject({ status: "nd", detail: expect.stringMatching(/Aucun relevé/) });
    const twoDates = buildBankLedger([acc("K1"), acc("K2")], [st("K1", "2026-10-31", 1), st("K2", "2026-10-30", 1)], []);
    expect(bankCheck(r.controls.bank512, e, twoDates)).toMatchObject({ status: "nd", detail: expect.stringMatching(/même date/) });
    const later = buildBankLedger([acc("K1")], [st("K1", "2026-11-30", 1)], []);
    expect(bankCheck(r.controls.bank512, e, later)).toMatchObject({ status: "nd" });
  });

  it("rapport complet : F01 à F09 dans l'ordre", () => {
    const report = fecReport(r.controls, { firstDate: "2026-01-01", lastDate: "2026-10-31" }, { referenceDate: "2026-11-21", ledger: [] });
    expect(report.map((x) => x.code)).toEqual(["F01", "F02", "F03", "F04", "F05", "F06", "F07", "F08", "F09"]);
  });
});

describe("FEC déséquilibré", () => {
  // Facture fictive n° 1 : 606000 passé de 1 000,00 à 1 000,10 € ; l'écriture AC 1 et le fichier sont déséquilibrés de 0,10 €.
  const r = controlFec(companyFecBytes({ mutate: (rows) => { rows[5][11] = "1000,10"; return rows; } }), COMPANY_FEC_FILENAME);
  const c = byCode(r.controls.checks);
  it("F03 et F04 bloquants, écart chiffré, écriture nommée", () => {
    expect(r.blocked).toBe(true);
    expect(c.F03).toMatchObject({ status: "fail", severity: "blocking" });
    expect(c.F03.detail).toContain("AC 1");
    expect(c.F04).toMatchObject({ status: "fail", severity: "blocking", gapCents: 10 });
    expect(c.F04.detail).toContain("0,10");
  });
});

describe("FEC Windows-1252 à barres verticales", () => {
  const r = controlFec(companyFecBytes({ delimiter: "pipe", encoding: "windows-1252" }), COMPANY_FEC_FILENAME);
  it("encodage reconnu, €, – et Œ relus, mêmes contrôles que le conforme", () => {
    expect(r.blocked).toBe(false);
    expect(r.parsed!.encoding).toBe("windows-1252");
    expect(r.parsed!.delimiter).toBe("pipe");
    expect(r.parsed!.lines.some((l) => l.label === "Facture fictive n° 1 – 1 200 € TTC")).toBe(true);
    expect(r.controls.suppliers!.top.find((s) => s.auxiliary === "F002")?.label).toBe("Fournisseur fictif Œuvre");
    expect(r.parsed!.totalDebitCents).toBe(11_100_000);
  });
  it("sans caractère de la plage 0x80–0x9F, un fichier non UTF-8 reste lu en ISO-8859-15", () => {
    const latin = controlFec(encodeWindows1252(companyFecText().replace(/[€–Œ]/g, "e")));
    expect(latin.parsed!.encoding).toBe("iso-8859-15");
  });
});

describe("FEC Montant/Sens", () => {
  const r = controlFec(companyFecBytes({ amountFormat: "montant-sens" }), COMPANY_FEC_FILENAME);
  it("mêmes montants, même rapport", () => {
    expect(r.blocked).toBe(false);
    expect(r.parsed!.amountFormat).toBe("montant-sens");
    expect(r.parsed!.totalDebitCents).toBe(11_100_000);
    expect(r.controls.suppliers!.unletteredCents).toBe(370_000);
    expect(r.controls.bank512.at(-1)).toEqual(["2026-10-31", 1_500_000]);
  });
});

describe("F01, F02 : en-tête et lignes illisibles", () => {
  it("F01 : en-tête absent, refus bloquant ; FEC XML : exporter au format texte", () => {
    const r = controlFec(enc("Compte;Libelle\n1;2\n"));
    expect(r.blocked).toBe(true);
    expect(byCode(r.controls.checks).F01).toMatchObject({ status: "fail", severity: "blocking" });
    const xml = controlFec(enc('<?xml version="1.0"?><comptabilite></comptabilite>'));
    expect(byCode(xml.controls.checks).F01.detail).toMatch(/XML.*format texte/);
  });

  it("F02 : au plus 0,1 % de lignes illisibles, elles sont listées et leur écriture est écartée en entier", () => {
    const text = largeFecText(2_000).split("\r\n");
    text[3] = text[3].replace("\t20260103\t", "\t20261303\t"); // ligne 4 : date invalide (écriture AC 2, 2 lignes)
    const r = controlFec(enc(text.join("\r\n")));
    expect(r.blocked).toBe(false);
    const f02 = byCode(r.controls.checks).F02;
    expect(f02).toMatchObject({ status: "fail", severity: "warning" });
    expect(r.controls.rejectedRows).toEqual([{ line: 4, reason: "Ligne 4 : date invalide (AAAAMMJJ attendu)." }]);
    expect(r.controls.excludedLines).toBe(1);
    expect(r.parsed!.lines).toHaveLength(1_998);
    expect(byCode(r.controls.checks).F03.status).toBe("ok");
  });

  it("F02 : au-delà de 0,1 % des lignes, refus bloquant", () => {
    const text = largeFecText(2_000).split("\r\n");
    for (const i of [3, 5, 7]) text[i] = text[i].replace(/\t(\d+),00\t0,00\t/, "\t$1,001\t0,00\t");
    const r = controlFec(enc(text.join("\r\n")));
    expect(r.blocked).toBe(true);
    expect(byCode(r.controls.checks).F02).toMatchObject({ status: "fail", severity: "blocking" });
    expect(byCode(r.controls.checks).F02.detail).toContain("3 ligne(s)");
  });
});

describe("F05 et F07", () => {
  it("F05 : 12 mois au plus ; jusqu'à 24 mois signalé comme premier exercice possible ; au-delà, plusieurs exercices", () => {
    expect(periodCheck("2026-01-01", "2026-12-31", null)).toMatchObject({ status: "ok" });
    expect(periodCheck("2026-01-01", "2027-01-01", null)).toMatchObject({ status: "fail", detail: expect.stringMatching(/premier exercice/) });
    expect(periodCheck("2025-01-01", "2026-12-31", null)).toMatchObject({ status: "fail", detail: expect.stringMatching(/premier exercice/) });
    expect(periodCheck("2025-01-01", "2027-01-01", null)).toMatchObject({ status: "fail", detail: expect.stringMatching(/plus de 24 mois/) });
    // La date de clôture du nom de fichier prolonge la période mesurée.
    expect(periodCheck("2026-01-01", "2026-06-30", "2027-01-31")).toMatchObject({ status: "fail" });
  });

  it("F07 : un avertissement par compte attendu absent", () => {
    // Retirer ces lignes déséquilibre le fichier : seul F07 est regardé ici.
    const r = controlFec(companyFecBytes({ mutate: (rows) => rows.filter((x) => !x[4].startsWith("164") && !x[4].startsWith("445")) }));
    const f07 = byCode(r.controls.checks).F07;
    expect(f07).toMatchObject({ status: "fail", severity: "warning", missing: ["44x", "164"] });
    expect(f07.detail).toMatch(/164/);
  });
});

describe("FEC de 200 000 lignes", () => {
  it("lu et contrôlé en moins de 10 secondes, équilibré", () => {
    const t0 = Date.now();
    const r = controlFec(enc(largeFecText(200_000)));
    const ms = Date.now() - t0;
    expect(r.blocked).toBe(false);
    expect(r.parsed!.lines).toHaveLength(200_000);
    expect(r.controls.suppliers!.count).toBe(50);
    expect(ms).toBeLessThan(10_000);
  }, 30_000);
});

describe("F09 : comptes fournisseurs lus", () => {
  it("401, 403, 404 et 408 comptés ; 409 (fournisseurs débiteurs) exclu", () => {
    const rows = (account: string, aux: string) => [["AC", "Achats", account, "20260115", "606000", "Achats", "", "", "P", "20260115", "Fictif", "100,00", "0,00", "", "", "20260115", "", ""], ["AC", "Achats", account, "20260115", account, "Fournisseurs", aux, `Tiers fictif ${aux}`, "P", "20260115", "Fictif", "0,00", "100,00", "", "", "20260115", "", ""]];
    const header = companyFecText().split("\r\n")[0];
    const body = ["401000", "403000", "404000", "408000", "409000"].flatMap((a, i) => rows(a, `T${i}`)).map((r) => r.join("\t"));
    const s = controlFec(enc([header, ...body].join("\r\n"))).controls.suppliers!;
    expect(s.count).toBe(4);
    expect(s.balanceCents).toBe(40_000);
  });
});
