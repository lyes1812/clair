import { describe, expect, it } from "vitest";
import { fixtureFecBytes, fixtureFecFilename, fixtureFecText } from "@/lib/fec/fixture";
import { FecError, parseFec, parseFecFilename } from "@/lib/fec/parser";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("lecture d'un FEC fictif (profil A, exercice clos le 30/09/2025)", () => {
  const r = parseFec(fixtureFecBytes({ exerciseEnd: "2025-09" }));

  it("reconnaît l'en-tête, le séparateur et la période", () => {
    expect(r.delimiter).toBe("tab");
    expect(r.amountFormat).toBe("debit-credit");
    expect(r.encoding).toBe("utf-8");
    expect(r.firstDate).toBe("2024-10-31");
    expect(r.lastDate).toBe("2025-09-30");
    expect(r.journals.map((j) => j.code)).toEqual(["BQ", "PAI"]);
  });

  it("cas de référence : 641100 en octobre 2024 = 13 840,00 € (somme des bruts fictifs), fichier équilibré", () => {
    const oct = r.lines.filter((l) => l.entryDate.startsWith("2024-10") && l.accountId === "641100");
    expect(oct.reduce((s, l) => s + l.debitCents, 0)).toBe(1384000);
    expect(r.balanced).toBe(true);
    expect(r.totalDebitCents).toBe(r.totalCreditCents);
    expect(r.unbalancedEntries).toBe(0);
  });

  it("nom de fichier normalisé : SIREN et clôture déduits", () => {
    expect(fixtureFecFilename({ exerciseEnd: "2025-09" })).toBe("000000000FEC20250930.txt");
    expect(parseFecFilename("000000000FEC20250930.txt")).toEqual({ siren: "000000000", closingDate: "2025-09-30" });
    expect(parseFecFilename("export-compta.txt")).toBeNull();
    expect(parseFecFilename("123456789FEC20250231.txt")).toBeNull();
  });

  it("même contenu en « | » et en Montant/Sens : mêmes montants", () => {
    const pipe = parseFec(fixtureFecBytes({ exerciseEnd: "2025-09", delimiter: "pipe" }));
    const sens = parseFec(fixtureFecBytes({ exerciseEnd: "2025-09", amountFormat: "montant-sens" }));
    expect(pipe.delimiter).toBe("pipe");
    expect(sens.amountFormat).toBe("montant-sens");
    for (const other of [pipe, sens]) {
      expect(other.totalDebitCents).toBe(r.totalDebitCents);
      expect(other.lines.map((l) => [l.accountId, l.debitCents, l.creditCents])).toEqual(r.lines.map((l) => [l.accountId, l.debitCents, l.creditCents]));
    }
  });

  it("BOM UTF-8 et ISO-8859-15 acceptés avec avertissement", () => {
    const bom = parseFec(fixtureFecBytes({ exerciseEnd: "2025-09", bom: true }));
    expect(bom.warnings.join(" ")).toContain("BOM");
    const latin = parseFec(Uint8Array.from([...fixtureFecText({ exerciseEnd: "2025-09" }).replace("Salaires 2024-10", "Salaires décalés 2024-10")].map((c) => c.charCodeAt(0) & 0xff)));
    expect(latin.encoding).toBe("iso-8859-15");
    expect(latin.lines.some((l) => l.label === "Salaires décalés 2024-10")).toBe(true);
  });
});

describe("contrôles FEC", () => {
  const base = fixtureFecText({ exerciseEnd: "2025-09", delimiter: "pipe" });
  const lines = base.split("\r\n");
  const rebuild = (fn: (rows: string[]) => string[]) => bytes(fn([...lines]).join("\r\n"));

  it("en-tête absent ou désordonné : refus", () => {
    expect(() => parseFec(bytes("Compte|Libelle\n1|2\n"))).toThrow(FecError);
    expect(() => parseFec(rebuild((r) => [r[0].replace("EcritureNum|EcritureDate", "EcritureDate|EcritureNum"), ...r.slice(1)]))).toThrow(/En-tête/);
  });
  it("débit et crédit tous deux renseignés : refus avec le numéro de ligne", () => {
    expect(() => parseFec(rebuild((r) => { r[1] = r[1].replace("|0,00|", "|1,00|").replace(/\|0,00\|/, "|1,00|"); return r; }))).toThrow(/Ligne 2/);
  });
  it("date invalide : refus", () => {
    expect(() => parseFec(rebuild((r) => { r[1] = r[1].replace(/\|20241031\|/, "|20241331|"); return r; }))).toThrow(/date invalide/);
  });
  it("montant avec trois décimales : refus ; point décimal : avertissement", () => {
    expect(() => parseFec(rebuild((r) => { r[1] = r[1].replace(/\|(\d+),(\d\d)\|/, "|$1,$2" + "5|"); return r; }))).toThrow(/montant invalide/);
    const dot = parseFec(rebuild((r) => { r[1] = r[1].replace(/\|(\d+),(\d\d)\|/, "|$1.$2|"); return r; }));
    expect(dot.warnings.join(" ")).toContain("Séparateur décimal");
  });
  it("écriture non équilibrée : avertissement, fichier conservé", () => {
    const r = parseFec(rebuild((r) => { r[1] = r[1].replace(/\|(\d+),(\d\d)\|0,00\|/, (_, a, b) => `|${Number(a) + 1},${b}|0,00|`); return r; }));
    expect(r.balanced).toBe(false);
    expect(r.unbalancedEntries).toBe(1);
    expect(r.warnings.join(" ")).toContain("non équilibrée");
    expect(r.warnings.join(" ")).toContain("Total des débits");
  });
  it("compte sans trois chiffres initiaux : refus", () => {
    expect(() => parseFec(rebuild((r) => { r[1] = r[1].replace("|641100|", "|6A1100|"); return r; }))).toThrow(/CompteNum/);
  });
  it("montants négatifs acceptés en centimes exacts", () => {
    const r = parseFec(bytes(`${lines[0]}\r\nOD|Divers|1|20250101|641100|Salaires|||P1|20250101|Régul|-12,34|0,00|||20250101||\r\nOD|Divers|1|20250101|421000|Personnel|||P1|20250101|Régul|0,00|-12,34|||20250101||\r\n`));
    expect(r.lines[0].debitCents).toBe(-1234);
    expect(r.balanced).toBe(true);
  });
});
