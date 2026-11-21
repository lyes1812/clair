import { describe, expect, it } from "vitest";
import { parseCamt053 } from "@/lib/bank/camt";
import { detectCsvProfile, parseBankCsv, splitCsvLine } from "@/lib/bank/csv";
import { fixtureCamt, fixtureCsv, fixtureIban, fixtureMonths, fixtureOfx } from "@/lib/bank/fixture";
import { BankError, decimalToCents, isValidIban, maskIdentifier, normalizeLabel, occurrenceRanks } from "@/lib/bank/model";
import { parseOfx } from "@/lib/bank/ofx";
import { decodeBankBytes, detectBankFormat, parseBankFile } from "@/lib/bank/parser";
import { parseXml } from "@/lib/bank/xml";

const enc = (s: string) => new TextEncoder().encode(s);
const IBAN = fixtureIban();
const csvAccount = { identifier: IBAN, identifierKind: "iban" as const };

describe("outils communs", () => {
  it("montants décimaux en centimes exacts", () => {
    expect(decimalToCents("1 234,56")).toBe(123456);
    expect(decimalToCents("1.234,56")).toBe(123456);
    expect(decimalToCents("-12.5")).toBe(-1250);
    expect(decimalToCents("0,07")).toBe(7);
    expect(decimalToCents("12,345")).toBeNull();
    expect(decimalToCents("")).toBeNull();
    expect(decimalToCents("abc")).toBeNull();
    // 0,1 + 0,2 en flottant donnerait 0,30000000000000004 : ici 10 + 20 = 30 centimes.
    expect(decimalToCents("0,1")! + decimalToCents("0,2")!).toBe(30);
  });
  it("IBAN : clé de contrôle et affichage masqué", () => {
    expect(isValidIban(IBAN)).toBe(true);
    expect(isValidIban("FR7630001000010000000123457")).toBe(false);
    expect(isValidIban("FR76 3000 6000 0112 3456 7890 189")).toBe(true); // exemple public de la norme
    expect(maskIdentifier("FR7630006000011234567890189", "iban")).toBe("FR76 … 0189");
    expect(maskIdentifier("30001000010000000123", "national")).toBe("… 0123");
  });
  it("libellé normalisé et rang d'apparition le même jour", () => {
    expect(normalizeLabel("  Vir. SEPA  émis – Café ")).toBe("VIR SEPA EMIS CAFE");
    const m = (label: string, amountCents = -100, bookingDate = "2026-01-05") => ({ bookingDate, valueDate: null, amountCents, label, counterparty: null, reference: null });
    expect(occurrenceRanks([m("A"), m("a"), m("A", -200), m("A", -100, "2026-01-06"), m("A")])).toEqual([1, 2, 1, 1, 3]);
  });
  it("lecteur XML : DTD refusée, entités prédéfinies décodées", () => {
    expect(() => parseXml("<!DOCTYPE x [<!ENTITY e SYSTEM \"file:///etc/passwd\">]><a>&e;</a>")).toThrow(/DTD/);
    const doc = parseXml("<a:x xmlns:a=\"u\"><b k='1'>A &amp; B &#233;</b></a:x>");
    expect(doc.children[0].name).toBe("x");
    expect(doc.children[0].children[0].text).toBe("A & B é");
    expect(doc.children[0].children[0].attrs.k).toBe("1");
  });
  it("encodage : UTF-8 sinon Windows-1252", () => {
    expect(decodeBankBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x41])).text).toBe("A");
    const w = decodeBankBytes(new Uint8Array([0x4c, 0x69, 0x62, 0x65, 0x6c, 0x6c, 0xe9]));
    expect(w).toEqual({ text: "Libellé", encoding: "windows-1252" });
  });
  it("format reconnu par le contenu ; CFONB 120 refusé avec un message clair", () => {
    expect(detectBankFormat("<?xml version='1.0'?><Document><BkToCstmrStmt>")).toBe("camt053");
    expect(detectBankFormat("OFXHEADER:100\n<OFX>")).toBe("ofx");
    expect(detectBankFormat("Date;Libellé;Montant\n")).toBe("csv");
    const cfonb = `01${"3".repeat(118)}\n`;
    expect(detectBankFormat(cfonb)).toBe("cfonb");
    expect(() => parseBankFile(enc(cfonb), { csvAccount: null })).toThrow(/CFONB 120/);
  });
});

// Cas de référence écrit à la main : relevé du 1er au 3 février 2026, ouverture 1 000,00 €, trois écritures
// (+250,00 ; −40,10 ; virement groupé −300,00 = −100,00 − 200,00), clôture 1 000,00 + 250,00 − 40,10 − 300,00 = 909,90 €.
const HAND_CAMT = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><GrpHdr><MsgId>M</MsgId></GrpHdr>
<Stmt><Id>S1</Id><FrToDt><FrDtTm>2026-02-01T00:00:00</FrDtTm><ToDtTm>2026-02-03T23:59:59</ToDtTm></FrToDt>
<Acct><Id><IBAN>${IBAN}</IBAN></Id><Ccy>EUR</Ccy></Acct>
<Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">1000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-02-01</Dt></Dt></Bal>
<Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">909.90</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-02-03</Dt></Dt></Bal>
<Ntry><Amt Ccy="EUR">250.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-02-01</Dt></BookgDt><ValDt><Dt>2026-02-02</Dt></ValDt><AcctSvcrRef>R1</AcctSvcrRef>
 <NtryDtls><TxDtls><RltdPties><Dbtr><Nm>CLIENT ALPHA</Nm></Dbtr></RltdPties><RmtInf><Ustrd>FACTURE F-12</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
<Ntry><Amt Ccy="EUR">40.10</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts><BookgDt><Dt>2026-02-02</Dt></BookgDt><AddtlNtryInf>PRLV ENERGIE</AddtlNtryInf></Ntry>
<Ntry><Amt Ccy="EUR">300.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-02-03</Dt></BookgDt>
 <NtryDtls>
  <TxDtls><Amt Ccy="EUR">100.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><RltdPties><Cdtr><Nm>FOURNISSEUR UN</Nm></Cdtr></RltdPties><RmtInf><Ustrd>FACT 1</Ustrd></RmtInf></TxDtls>
  <TxDtls><Amt Ccy="EUR">200.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><RltdPties><Cdtr><Pty><Nm>FOURNISSEUR DEUX</Nm></Pty></Cdtr></RltdPties><RmtInf><Ustrd>FACT 2</Ustrd></RmtInf></TxDtls>
 </NtryDtls></Ntry>
<Ntry><Amt Ccy="EUR">5.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>PDNG</Sts><BookgDt><Dt>2026-02-03</Dt></BookgDt></Ntry>
</Stmt></BkToCstmrStmt></Document>`;

describe("CAMT.053", () => {
  it("cas de référence : soldes, mouvements signés, virement groupé éclaté, écriture en attente ignorée", () => {
    const { statements, warnings } = parseCamt053(HAND_CAMT);
    expect(statements).toHaveLength(1);
    const s = statements[0];
    expect(s).toMatchObject({ identifier: IBAN, identifierKind: "iban", from: "2026-02-01", to: "2026-02-03", opening: { date: "2026-02-01", cents: 100000 }, closing: { date: "2026-02-03", cents: 90990 } });
    expect(s.movements.map((m) => [m.bookingDate, m.amountCents, m.label, m.counterparty])).toEqual([
      ["2026-02-01", 25000, "FACTURE F-12", "CLIENT ALPHA"],
      ["2026-02-02", -4010, "PRLV ENERGIE", null],
      ["2026-02-03", -10000, "FACT 1", "FOURNISSEUR UN"],
      ["2026-02-03", -20000, "FACT 2", "FOURNISSEUR DEUX"],
    ]);
    expect(s.movements[0]).toMatchObject({ valueDate: "2026-02-02", reference: "R1" });
    expect(100000 + s.movements.reduce((t, m) => t + m.amountCents, 0)).toBe(90990);
    expect(warnings.join(" ")).toMatch(/1 écriture\(s\) non comptabilisée/);
  });
  it("virement groupé au détail incomplet : gardé entier", () => {
    const xml = HAND_CAMT.replace("<Amt Ccy=\"EUR\">200.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><RltdPties>", "<RltdPties>");
    const { statements, warnings } = parseCamt053(xml);
    expect(statements[0].movements.filter((m) => m.bookingDate === "2026-02-03").map((m) => m.amountCents)).toEqual([-30000]);
    expect(warnings.join(" ")).toMatch(/groupée/);
  });
  it("plusieurs relevés par fichier (un par mois)", () => {
    const months = fixtureMonths("2026-03", 3);
    const { statements } = parseCamt053(fixtureCamt(months, 5_000_000));
    expect(statements.map((s) => [s.from, s.to])).toEqual([["2026-01-01", "2026-01-31"], ["2026-02-01", "2026-02-28"], ["2026-03-01", "2026-03-31"]]);
    for (const s of statements) expect(s.opening!.cents + s.movements.reduce((t, m) => t + m.amountCents, 0)).toBe(s.closing!.cents);
  });
  it("refus : devise étrangère, IBAN faux, montant ou sens absent", () => {
    expect(() => parseCamt053(HAND_CAMT.replace("<Ccy>EUR</Ccy>", "<Ccy>USD</Ccy>"))).toThrow(/USD/);
    expect(() => parseCamt053(HAND_CAMT.replace(IBAN, IBAN.slice(0, -1) + "9"))).toThrow(/IBAN invalide/);
    expect(() => parseCamt053(HAND_CAMT.replace("<CdtDbtInd>DBIT</CdtDbtInd><Sts><Cd>BOOK", "<Sts><Cd>BOOK"))).toThrow(BankError);
    expect(() => parseCamt053("<Document></Document>")).toThrow(/BkToCstmrStmt/);
  });
});

// Cas de référence OFX : deux opérations (+1 500,00 et −249,99), solde de clôture 3 210,55 € au 31/01/2026.
const OFX1 = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20260201</SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><TRNUID>1<STMTRS><CURDEF>EUR
<BANKACCTFROM><BANKID>30001<BRANCHID>00001<ACCTID>00000001234<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20260101<DTEND>20260131
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260110120000[+1:CET]<TRNAMT>1500,00<FITID>A1<NAME>VIR CLIENT BETA</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260115<TRNAMT>-249.99<FITID>A1<NAME>CB FOURNITURES<MEMO>CARTE 1234 FOURNITURES</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>3210.55<DTASOF>20260131</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

describe("OFX", () => {
  it("OFX 1.x (SGML sans balises fermantes) : cas de référence", () => {
    const { statements } = parseOfx(OFX1);
    expect(statements).toHaveLength(1);
    const s = statements[0];
    expect(s).toMatchObject({ identifier: "300010000100000001234", identifierKind: "national", from: "2026-01-01", to: "2026-01-31", opening: null, closing: { date: "2026-01-31", cents: 321055 } });
    expect(s.movements.map((m) => [m.bookingDate, m.amountCents, m.label, m.reference])).toEqual([
      ["2026-01-10", 150000, "VIR CLIENT BETA", "A1"],
      ["2026-01-15", -24999, "CB FOURNITURES CARTE 1234 FOURNITURES", "A1"],
    ]);
  });
  it("OFX 2.x (XML, balises fermées) donne le même résultat", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><?OFX OFXHEADER="200" VERSION="211"?><OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>EUR</CURDEF>
<BANKACCTFROM><BANKID>30001</BANKID><BRANCHID>00001</BRANCHID><ACCTID>00000001234</ACCTID></BANKACCTFROM>
<BANKTRANLIST><DTSTART>20260101</DTSTART><DTEND>20260131</DTEND>
<STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20260110</DTPOSTED><TRNAMT>1500.00</TRNAMT><FITID>A1</FITID><NAME>VIR CLIENT BETA</NAME></STMTTRN>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260115</DTPOSTED><TRNAMT>-249.99</TRNAMT><FITID>A1</FITID><NAME>CB FOURNITURES</NAME><MEMO>CARTE 1234 FOURNITURES</MEMO></STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>3210.55</BALAMT><DTASOF>20260131</DTASOF></LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    expect(parseOfx(xml).statements).toEqual(parseOfx(OFX1).statements);
  });
  it("fichier généré : toutes les opérations lues, solde de clôture = ouverture + mouvements", () => {
    const months = fixtureMonths("2026-02", 2);
    const s = parseOfx(fixtureOfx(months, 1_000_000)).statements[0];
    expect(s.movements).toHaveLength(months.flatMap((m) => m.movements).length);
    expect(s.closing!.cents).toBe(1_000_000 + s.movements.reduce((t, m) => t + m.amountCents, 0));
  });
  it("refus : devise étrangère, montant illisible", () => {
    expect(() => parseOfx(OFX1.replace("<CURDEF>EUR", "<CURDEF>CHF"))).toThrow(/CHF/);
    expect(() => parseOfx(OFX1.replace("<TRNAMT>1500,00", "<TRNAMT>mille"))).toThrow(/TRNAMT/);
  });
});

describe("CSV", () => {
  it("guillemets et séparateur dans un champ", () => {
    expect(splitCsvLine("01/02/2026;\"VIR \"\"A\"\"; B\";-1,00", ";")).toEqual(["01/02/2026", "VIR \"A\"; B", "-1,00"]);
  });
  it("profil reconnu après des lignes de titre", () => {
    const p = detectCsvProfile(["Titre", "", "Date opération;Date valeur;Libellé;Montant en euros;Solde"])!;
    expect(p).toMatchObject({ delimiter: ";", headerLine: 3, columns: { date: 0, valueDate: 1, label: 2, amount: 3, debit: null, credit: null, balance: 4 } });
    expect(detectCsvProfile(["a;b;c", "1;2;3"])).toBeNull();
  });
  // Cas de référence : export inversé (plus récent en premier), débit/crédit séparés, solde après chaque opération.
  // Chronologique : 02/03 +1 000,00 → 5 000,00 ; 03/03 −250,50 → 4 749,50 ; 03/03 −250,50 → 4 499,00. Ouverture 4 000,00.
  const HAND_CSV = "Compte fictif\r\nDate;Libellé;Débit;Crédit;Solde\r\n03/03/2026;PRLV ASSURANCE;250,50;;4 499,00\r\n03/03/2026;PRLV ASSURANCE;250,50;;4 749,50\r\n02/03/2026;VIR RECU;;1 000,00;5 000,00\r\n\r\nTotal;;501,00;1000,00;\r\n";
  it("cas de référence : ordre rétabli, soldes, pied de fichier ignoré", () => {
    const { statement: s, profile, warnings } = parseBankCsv(HAND_CSV, csvAccount);
    expect(profile.order).toBe("reverse");
    expect(s.movements.map((m) => [m.bookingDate, m.amountCents])).toEqual([["2026-03-02", 100000], ["2026-03-03", -25050], ["2026-03-03", -25050]]);
    expect(s.opening).toEqual({ date: "2026-03-02", cents: 400000 });
    expect(s.closing).toEqual({ date: "2026-03-03", cents: 449900 });
    expect(s.rowBreaks).toEqual([]);
    expect(warnings.join(" ")).toMatch(/pied de fichier/);
  });
  it("rupture de solde ligne à ligne : écart chiffré", () => {
    const { statement } = parseBankCsv(HAND_CSV.replace("4 499,00", "4 489,00"), csvAccount);
    expect(statement.rowBreaks).toEqual([{ line: 3, gapCents: -1000 }]);
  });
  it("ligne illisible au milieu des opérations : fichier refusé", () => {
    expect(() => parseBankCsv(HAND_CSV.replace("03/03/2026;PRLV ASSURANCE;250,50;;4 749,50", "xx;PRLV;250,50;;4 749,50"), csvAccount)).toThrow(/ligne 4 illisible/);
  });
  it("colonne montant signée, sans solde : soldes n.d.", () => {
    const { statement } = parseBankCsv("Date,Description,Montant\n2026-01-02,\"A, B\",-12.30\n2026-01-03,C,5\n", csvAccount);
    expect(statement.movements.map((m) => m.amountCents)).toEqual([-1230, 500]);
    expect(statement.opening).toBeNull();
    expect(statement.closing).toBeNull();
    expect(statement.rowBreaks).toBeNull();
  });
  it("débit et crédit sur la même ligne : refus", () => {
    expect(() => parseBankCsv("Date;Libellé;Débit;Crédit\n02/03/2026;X;1,00;2,00\n", csvAccount)).toThrow(/ensemble/);
  });
  it("fichier généré : profil, ordre et continuité", () => {
    const months = fixtureMonths("2026-02", 2);
    const { statement, profile } = parseBankCsv(fixtureCsv(months, 2_000_000), csvAccount);
    expect(profile.order).toBe("reverse");
    expect(statement.rowBreaks).toEqual([]);
    expect(statement.closing!.cents).toBe(2_000_000 + months.flatMap((m) => m.movements).reduce((t, m) => t + m.amountCents, 0));
  });
  it("CSV sans IBAN saisi : refus explicite", () => {
    expect(() => parseBankFile(enc("Date;Libellé;Montant\n02/03/2026;X;1,00\n"), { csvAccount: null })).toThrow(/IBAN/);
  });
});
