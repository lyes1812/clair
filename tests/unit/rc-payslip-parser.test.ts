import { describe, expect, it } from "vitest";
import { extractRcPayslip, parseRcPayslipRows, inspectRcPayslipRows, inspectRcPayslipFormat, RC_PARSER_VERSION, type RcPayslipTextItem, type RcPayslipTextRow } from "@/lib/payroll/rc-payslip-parser";

const item = (text: string, x: number, width = 40): RcPayslipTextItem => ({ text, x, y: 500, width, height: 10 });
const row = (line: number, items: RcPayslipTextItem[], page = 1): RcPayslipTextRow => ({ page, line, items });
const header = (page = 1) => row(1, [item("Libellé", 20), item("Base", 280), item("Taux", 350), item("À payer", 420, 50), item("Charges patronales", 520, 65)], page);
const rc = (label: string, value: string, line = 2, extra: RcPayslipTextItem[] = [], page = 1) => row(line, [item(label, 20, 225), ...extra, item(value, 420, 50)], page);
const groupedHeader = () => [
  row(1, [item("DÉSIGNATION", 20, 150), item("BASE", 280, 40), item("PART SALARIÉ", 380, 60), item("PART EMPLOYEUR", 525, 70)]),
  row(2, [item("TAUX OU %", 360, 50), item("MONTANT", 450, 50), item("MONTANT", 535, 50)]),
];
const groupedRc = (line = 3, value = "1 234,56") => row(line, [item("Indemnité de rupture conventionnelle", 20, 225), item("9 000,00", 280, 40), item("20,00", 360, 50), item(value, 450, 50), item("999,99", 535, 50)]);
const atY = (label: string, x: number, y: number, width = 50) => ({ ...item(label, x, width), y });
const staggeredHeader = () => [
  row(1, [atY("PART SALARIÉ", 340, 620, 60)]),
  row(2, [atY("DÉSIGNATION", 30, 612, 120), atY("BASE", 245, 612), atY("PART EMPLOYEUR", 480, 612, 90)]),
  row(3, [atY("NOTE_FICTIVE", 30, 608)]),
  row(4, [atY("TAUX OU %", 325, 604), atY("MONTANT", 400, 604)]),
];
const staggeredRc = (line = 5) => row(line, [atY("Indemnité de rupture conventionnelle", 25, 580, 225), atY("1 234,56", 410, 580)]);
// PDF minimal créé en mémoire : aucune fixture contenant des données clients.
function fictionalPdf(grouped = false, staggered = false): Uint8Array {
  const text = (label: string, x: number, y: number) => `BT /F1 9 Tf 1 0 0 1 ${x} ${y} Tm (${label}) Tj ET\n`;
  const content = staggered
    ? text("PART SALARIE", 340, 720) + text("DESIGNATION", 30, 712) + text("BASE", 245, 712) + text("PART EMPLOYEUR", 480, 712)
      + text("NOTE_FICTIVE", 30, 708) + text("TAUX OU %", 325, 704) + text("MONTANT", 400, 704)
      + text("Indemnite de rupture conventionnelle", 25, 680) + text("9000,00", 245, 680) + text("20,00", 325, 680) + text("1234,56", 410, 680) + text("999,99", 500, 680)
    : grouped
    ? text("DESIGNATION", 20, 720) + text("BASE", 280, 720) + text("PART SALARIE", 380, 720) + text("PART EMPLOYEUR", 525, 720)
      + text("TAUX OU %", 360, 700) + text("MONTANT", 450, 700) + text("MONTANT", 535, 700)
      + text("Indemnite de rupture conventionnelle", 20, 680) + text("9000,00", 280, 680) + text("20,00", 360, 680) + text("1234,56", 450, 680) + text("999,99", 535, 680)
    : text("Libelle", 20, 700) + text("Base", 280, 700) + text("Taux", 350, 700) + text("A payer", 420, 700) + text("Charges patronales", 520, 700)
      + text("Indemnite de rupture conventionnelle", 20, 680) + text("9000,00", 280, 680) + text("20,00", 350, 680) + text("1234,56", 420, 680) + text("300,00", 520, 680);
  return pdfFromContent(content);
}
function pdfFromContent(content: string): Uint8Array {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 650 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${content.length} >>\nstream\n${content}endstream`];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((body, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("") + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

describe("extraction RC : bulletin fictif, colonne salariale vérifiée", () => {
  it("cas manuel : lit 1 234,56 € d’indemnité, pas la base, le taux ni les charges patronales", () => {
    const parsed = parseRcPayslipRows([header(), rc("Indemnité de rupture conventionnelle", "1 234,56", 2, [item("9 000,00", 280), item("20,00", 350), item("300,00", 520)])]);
    expect(parsed).toMatchObject({ status: "identified", code: "explicit-rc-amount", indemnityCents: 123456, components: [{ label: "Indemnité de rupture conventionnelle", amountCents: 123456, page: 1, line: 2 }], parserVersion: RC_PARSER_VERSION, cost: { status: "review", code: "rc-exemption-unconfirmed", chargedCents: null, employerChargesCents: null, components: [] } });
    expect(JSON.stringify(parsed)).not.toMatch(/900000|2000|30000/);
  });
  it("additionne uniquement les parts soumise et exonérée explicitement distinctes", () => {
    const parsed = parseRcPayslipRows([header(), rc("Indemnité rupture conventionnelle soumise", "234,56"), rc("Indemnité rupture conventionnelle exonérée", "1 000,00", 3)]);
    expect(parsed).toMatchObject({ status: "identified", indemnityCents: 123456 });
    expect(parsed.components).toHaveLength(2);
  });
  it("une somme explicitement nulle est zéro, l’absence de ligne n’est pas zéro", () => {
    expect(parseRcPayslipRows([header(), rc("Indemnité de rupture conventionnelle", "0,00")])).toMatchObject({ status: "identified", indemnityCents: 0 });
    expect(parseRcPayslipRows([header(), row(2, [item("Salaire fictif", 20), item("1 000,00", 420)])])).toMatchObject({ status: "none", indemnityCents: null, components: [] });
  });
  it.each(["Indemnité compensatrice de congés payés", "Indemnité de licenciement", "Contribution patronale sur indemnité rupture conventionnelle", "CSG sur indemnité rupture conventionnelle", "Cumul annuel indemnité rupture conventionnelle", "Total indemnité rupture conventionnelle"])("ne classe pas comme RC : %s", (label) => {
    expect(parseRcPayslipRows([header(), rc(label, "100,00")])).toMatchObject({ status: "none", indemnityCents: null });
  });
  it("une colonne inconnue, un montant seulement en base ou deux valeurs salariales sont à vérifier", () => {
    expect(parseRcPayslipRows([rc("Indemnité rupture conventionnelle", "100,00")])).toMatchObject({ status: "review", code: "amount-column-unrecognized", indemnityCents: null });
    expect(parseRcPayslipRows([header(), row(2, [item("Indemnité rupture conventionnelle", 20, 225), item("100,00", 280)])])).toMatchObject({ status: "review", code: "amount-column-ambiguous" });
    expect(parseRcPayslipRows([header(), rc("Indemnité rupture conventionnelle", "100,00", 2, [item("200,00", 430)])])).toMatchObject({ status: "review", code: "amount-column-ambiguous" });
  });
  it("ne reprend jamais le coût de l’employeur quand la colonne salarié est absente", () => {
    expect(parseRcPayslipRows([header(), row(2, [item("Indemnité rupture conventionnelle", 20, 225), item("999,00", 520)])])).toMatchObject({ status: "review", indemnityCents: null });
  });
  it.each(["Indemnité de licenciement ou de rupture conventionnelle", "Indemnité de licenciement et rupture conventionnelle", "Indemnité de rupture conventionnelle - assiette", "Indemnité de rupture conventionnelle - base", "Indemnité de rupture conventionnelle CSG", `Indemnité de rupture conventionnelle ${"x".repeat(160)}`])("un libellé mixte ou une assiette reste à vérifier : %s", (label) => {
    expect(parseRcPayslipRows([header(), rc(label, "100,00")])).toMatchObject({ status: "review", code: "ambiguous-rc-label", indemnityCents: null, components: [] });
  });
  it.each(["-123,45", "−123,45", "(123,45)"])("une correction négative reste à vérifier : %s", (value) => {
    expect(parseRcPayslipRows([header(), rc("Indemnité rupture conventionnelle", value)])).toMatchObject({ status: "review", indemnityCents: null, components: [] });
  });
  it("une ligne rectificative, un doublon et un total mêlé aux parts ne sont pas additionnés", () => {
    expect(parseRcPayslipRows([header(), rc("Régularisation indemnité rupture conventionnelle", "100,00")])).toMatchObject({ status: "review", code: "signed-or-corrected-rc" });
    expect(parseRcPayslipRows([header(), rc("Indemnité rupture conventionnelle", "100,00"), rc("Indemnité rupture conventionnelle", "100,00", 3)])).toMatchObject({ status: "review", code: "duplicate-rc-line" });
    expect(parseRcPayslipRows([header(), rc("Indemnité rupture conventionnelle", "100,00"), rc("Indemnité rupture conventionnelle exonérée", "100,00", 3)])).toMatchObject({ status: "review", code: "overlapping-rc-components" });
  });
  it("garde les montants de pages différentes uniquement avec leurs propres entêtes", () => {
    expect(parseRcPayslipRows([header(), rc("Indemnité rupture conventionnelle soumise", "100,00"), header(2), rc("Indemnité rupture conventionnelle exonérée", "200,00", 2, [], 2)])).toMatchObject({ status: "identified", indemnityCents: 30000 });
    expect(parseRcPayslipRows([header(), rc("Indemnité rupture conventionnelle", "200,00", 2, [], 2)])).toMatchObject({ status: "review", code: "amount-column-unrecognized" });
  });
  it("recompose le libellé coupé et les fragments d’un même nombre", () => {
    const split = [header(), row(2, [item("Indemnité de rupture", 20, 180)]), row(3, [item("conventionnelle", 20, 160), item("1", 420, 5), item("234,56", 428, 40)])];
    expect(parseRcPayslipRows(split)).toMatchObject({ status: "identified", indemnityCents: 123456 });
  });
  it("reconnaît Gains et une entête À payer fragmentée", () => {
    const gains = header(); gains.items[3].text = "Gains";
    expect(parseRcPayslipRows([gains, rc("Indemnité rupture conventionnelle", "100,00")])).toMatchObject({ status: "identified", indemnityCents: 10000 });
    const split = header(); split.items.splice(3, 1, item("À", 420, 7), item("payer", 431, 30));
    expect(parseRcPayslipRows([split, rc("Indemnité rupture conventionnelle", "100,00")])).toMatchObject({ status: "identified", indemnityCents: 10000 });
  });
  it("entête PayFit à deux niveaux : le groupe salarié dépasse la largeur de son libellé", () => {
    const parsed = parseRcPayslipRows([...groupedHeader(), groupedRc()]);
    expect(parsed).toMatchObject({ status: "identified", indemnityCents: 123456, components: [{ label: "Indemnité de rupture conventionnelle", amountCents: 123456, page: 1, line: 3 }] });
    expect(JSON.stringify(parsed)).not.toMatch(/900000|99999/);
  });
  it("les indemnités exonérées sous les cotisations gardent la colonne du tableau principal", () => {
    const parsed = parseRcPayslipRows([...groupedHeader(), row(3, [item("Cotisations fictives", 20), item("100,00", 450, 50)]), row(4, [item("Impôts", 20), item("Base", 280, 40), item("Taux", 360, 50), item("Montant", 515, 50)]), groupedRc(5)]);
    expect(parsed).toMatchObject({ status: "identified", indemnityCents: 123456 });
  });
  it("BASE centrée verticalement entre les deux niveaux reste une borne de groupe vérifiée", () => {
    const headers = groupedHeader();
    const base = headers[0].items.find(item => item.text === "BASE")!;
    headers[0].items = headers[0].items.filter(item => item.text !== "BASE");
    const source = [headers[0], row(2, [base]), { ...headers[1], line: 3 }, groupedRc(4)];
    expect(parseRcPayslipRows(source)).toMatchObject({ status: "identified", indemnityCents: 123456 });
  });
  it("une sous-colonne manquante ou deux montants dans le groupe salarié restent ambigus", () => {
    const missing = groupedHeader(); missing[1].items = missing[1].items.filter(item => item.text !== "TAUX OU %");
    expect(parseRcPayslipRows([...missing, groupedRc()])).toMatchObject({ status: "review", code: "amount-column-unrecognized", indemnityCents: null });
    const duplicate = groupedHeader(); duplicate[1].items.push(item("MONTANT", 420, 10));
    expect(parseRcPayslipRows([...duplicate, groupedRc()])).toMatchObject({ status: "review", code: "amount-column-unrecognized", indemnityCents: null });
  });
  it("la part employeur ne remplace jamais le montant salarié manquant sous l’entête groupée", () => {
    const onlyEmployer = groupedRc(); onlyEmployer.items = onlyEmployer.items.filter(item => item.x !== 450);
    expect(parseRcPayslipRows([...groupedHeader(), onlyEmployer])).toMatchObject({ status: "review", code: "amount-column-ambiguous", indemnityCents: null });
  });
  it("regroupe des parents adjacents décalés verticalement et une sous-entête trois lignes plus bas", () => {
    expect(parseRcPayslipRows([...staggeredHeader(), staggeredRc()])).toMatchObject({ status: "identified", indemnityCents: 123456, components: [{ amountCents: 123456, page: 1, line: 5 }] });
  });
  it.each(["PART SALARIÉ", "PART EMPLOYEUR"])("plusieurs parents voisins %s restent à vérifier", (label) => {
    const headers = staggeredHeader();
    headers[1].items.push(atY(label, label === "PART SALARIÉ" ? 345 : 490, 612, 60));
    expect(parseRcPayslipRows([...headers, staggeredRc()])).toMatchObject({ status: "review", code: "amount-column-unrecognized", indemnityCents: null, components: [] });
  });
  it("sans groupe employeur, aucune sous-colonne MONTANT n’est présumée salariale", () => {
    const headers = staggeredHeader(); headers[1].items = headers[1].items.filter(item => item.text !== "PART EMPLOYEUR");
    expect(parseRcPayslipRows([...headers, staggeredRc()])).toMatchObject({ status: "review", code: "amount-column-unrecognized", indemnityCents: null });
  });
  it("plusieurs MONTANT dans le groupe salarié empêchent le choix d’une valeur", () => {
    const headers = staggeredHeader(); headers[3].items.push(atY("MONTANT", 380, 604, 20));
    expect(parseRcPayslipRows([...headers, staggeredRc()])).toMatchObject({ status: "review", code: "amount-column-unrecognized", indemnityCents: null });
  });
  it("le taux et le montant employeur ne remplacent pas l’indemnité manquante", () => {
    const missing = staggeredRc(); missing.items.pop();
    missing.items.push(atY("20,00", 325, 580), atY("999,99", 500, 580));
    expect(parseRcPayslipRows([...staggeredHeader(), missing])).toMatchObject({ status: "review", code: "amount-column-ambiguous", indemnityCents: null });
  });
  it("une sous-entête fiscale plus bas ne remplace pas les groupes principal vérifiés", () => {
    const tax = row(8, [atY("Impôts", 30, 550), atY("BASE", 245, 550), atY("TAUX", 325, 550), atY("MONTANT", 500, 550)]);
    expect(parseRcPayslipRows([...staggeredHeader(), tax, staggeredRc(12)])).toMatchObject({ status: "identified", indemnityCents: 123456 });
  });
  it("les titres de groupes de pages différentes ne sont jamais assemblés", () => {
    const headers = staggeredHeader(); headers[0].page = 2;
    expect(parseRcPayslipRows([...headers, staggeredRc()])).toMatchObject({ status: "review", code: "amount-column-unrecognized", indemnityCents: null });
  });
  it("ne renvoie aucun autre texte du bulletin ni montant partiel en cas de doute", () => {
    const value = parseRcPayslipRows([header(), row(2, [item("NOM_FICTIF_CONFIDENTIEL", 20)]), rc("Indemnité rupture conventionnelle", "123,45", 3), rc("Indemnité rupture conventionnelle", "", 4)]);
    expect(value.status).toBe("review");
    expect(value.components).toEqual([]);
    expect(JSON.stringify(value)).not.toMatch(/NOM_FICTIF|12345/);
  });
  it("PDF vide, faux PDF et PDF sans texte exploitable restent n.d.", async () => {
    for (const bytes of [new Uint8Array(), new TextEncoder().encode("NOT-PDF"), new TextEncoder().encode("%PDF-1.7\nFICTIF INVALIDE")]) {
      expect(await extractRcPayslip(bytes)).toMatchObject({ status: "review", indemnityCents: null, components: [] });
    }
    expect(parseRcPayslipRows([])).toMatchObject({ status: "review", code: "unreadable-text" });
  });
  it("lit un vrai PDF fictif en mémoire, avec le montant de sa colonne salarié", async () => {
    const parsed = await extractRcPayslip(fictionalPdf());
    expect(parsed).toMatchObject({ status: "identified", indemnityCents: 123456, components: [{ label: "Indemnite de rupture conventionnelle", amountCents: 123456, page: 1, line: 2 }] });
  });
  it("lit le format groupé PayFit dans un PDF fictif complet en mémoire", async () => {
    expect(await extractRcPayslip(fictionalPdf(true))).toMatchObject({ status: "identified", indemnityCents: 123456, components: [{ label: "Indemnite de rupture conventionnelle", amountCents: 123456, page: 1, line: 3 }] });
  });
  it("lit un PDF fictif avec parents sur deux lignes de base et sous-entête décalée", async () => {
    expect(await extractRcPayslip(fictionalPdf(false, true))).toMatchObject({ parserVersion: RC_PARSER_VERSION, status: "identified", indemnityCents: 123456, components: [{ label: "Indemnite de rupture conventionnelle", amountCents: 123456, page: 1, line: 5 }] });
  });
  it("le diagnostic conserve seulement les mots d’entête autorisés et la géométrie, jamais noms, identifiants ou montants", () => {
    const source = [...groupedHeader(), row(3, [item("NOM_FICTIF_CONFIDENTIEL IDENTIFIANT_SECRET", 20), item("314159,26", 450, 50)]), row(4, [item("MONTANT MOTPRIVE 987654,32", 450, 50)]), groupedRc(5)];
    const inspected = inspectRcPayslipRows(source);
    const encoded = JSON.stringify(inspected);
    expect(encoded).not.toMatch(/NOM_FICTIF|CONFIDENTIEL|IDENTIFIANT_SECRET|MOTPRIVE|314159|987654|123456|99999|Indemnité|rupture/);
    expect(inspected).toMatchObject({ parserVersion: RC_PARSER_VERSION, extractionStatus: "identified", extractionCode: "explicit-rc-amount" });
    expect(inspected.headers[0].cells).toContainEqual({ tokens: ["PART", "SALARIE"], x: 380, y: 500, width: 60 });
    expect(inspected.headers.flatMap(row => row.cells).find(cell => cell.tokens.includes("MONTANT") && cell.y === 500 && cell.x === 450)?.tokens).toEqual(["MONTANT"]);
    expect(inspected.rcRows).toEqual([{ page: 1, line: 5, monetaryCellCount: 4, cells: [{ x: 280, y: 500, width: 40 }, { x: 360, y: 500, width: 50 }, { x: 450, y: 500, width: 50 }, { x: 535, y: 500, width: 50 }] }]);
    expect(inspected).not.toHaveProperty("indemnityCents");
    expect(inspected).not.toHaveProperty("components");
  });
  it("l’inspection PDF utilise le même lecteur borné, sans exposer les données extraites", async () => {
    const inspected = await inspectRcPayslipFormat(fictionalPdf(true));
    expect(inspected).toMatchObject({ extractionStatus: "identified", extractionCode: "explicit-rc-amount", pageCount: 1, rowCount: 3 });
    expect(JSON.stringify(inspected)).not.toMatch(/1234,56|123456|9000,00|999,99|Indemnite/);
    expect(await inspectRcPayslipFormat(new Uint8Array())).toMatchObject({ extractionStatus: "review", extractionCode: "invalid-pdf", headers: [], rcRows: [] });
  });
  it("le diagnostic des contributions n’expose que vocabulaire fermé, positions et qualificatifs", () => {
    const source = [header(), rc("Indemnité de rupture conventionnelle", "1 234,56"),
      row(3, [item("Contribution patronale sur indemnité de rupture conventionnelle NOMPRIVE IDENTIFIANTSECRET", 20, 225), item("25,00", 350, 40), item("321,09", 520, 50)]),
      row(4, [item("Autres contributions dues par l’employeur TEXTEPRIVE", 20, 225), item("987,65", 520, 50)]),
      row(5, [item("CSG CRDS sur indemnité de rupture conventionnelle", 20, 225), item("111,11", 420, 50)]),
      row(6, [item("Forfait social sur indemnité de rupture conventionnelle ou départ retraite", 20, 225), item("222,22", 520, 50)]),
    ];
    const inspected = inspectRcPayslipRows(source);
    expect(inspected.parserVersion).toBe(RC_PARSER_VERSION);
    expect(inspected.extractionStatus).toBe("identified");
    expect(inspected.chargeCandidates).toHaveLength(5);
    expect(inspected.chargeCandidates[1]).toMatchObject({ page: 1, line: 3, labelTokens: ["CONTRIBUTION", "PATRONALE", "SUR", "INDEMNITE", "DE", "RUPTURE", "CONVENTIONNELLE"], monetaryCells: [{ x: 350, y: 500, width: 40 }, { x: 520, y: 500, width: 50 }], qualifiers: { explicitRc: true, indemnity: true, contribution: true, employer: true, employeeDeduction: false } });
    expect(inspected.chargeCandidates[2]).toMatchObject({ qualifiers: { explicitRc: false, contribution: true, employer: true, genericOther: true } });
    expect(inspected.chargeCandidates[3]).toMatchObject({ qualifiers: { explicitRc: true, employeeDeduction: true, employer: false } });
    expect(inspected.chargeCandidates[4]).toMatchObject({ qualifiers: { explicitRc: true, forfaitSocial: true, mixedDeparture: true } });
    expect(JSON.stringify(inspected)).not.toMatch(/NOMPRIVE|IDENTIFIANTSECRET|TEXTEPRIVE|1234,56|123456|321,09|32109|987,65|98765|25,00|111,11|11111|222,22|22222/);
  });
  it("le diagnostic distingue libellé exonéré, soumis et assiette sans calculer ni restituer un taux", () => {
    const inspected = inspectRcPayslipRows([header(), rc("Indemnité de rupture conventionnelle exonérée", "1 000,00"), row(3, [item("Contribution rupture conventionnelle soumise assiette", 20, 225), item("17,77", 350, 40)])]);
    expect(inspected.chargeCandidates[0]).toMatchObject({ qualifiers: { explicitRc: true, exempt: true, liable: false } });
    expect(inspected.chargeCandidates[1]).toMatchObject({ qualifiers: { explicitRc: true, exempt: false, liable: true, basis: true } });
    expect(JSON.stringify(inspected)).not.toContain("17,77");
    expect(inspected.chargeCandidates.every(candidate => !Object.hasOwn(candidate, "amountCents") && !Object.hasOwn(candidate, "rate"))).toBe(true);
  });
});

const costNominal = (label = "Indemnité de rupture conventionnelle non soumise") => rc(label, "1 000,00");
const costCharge = (patch: { label?: string; value?: string; base?: string | null; line?: number; extra?: RcPayslipTextItem[] } = {}) => row(patch.line ?? 3, [
  item(patch.label ?? "Contribution patronale sur indemnité de rupture conventionnelle", 20, 225),
  ...(patch.base === null ? [] : [item(patch.base ?? "1 000,00", 280)]),
  item("25,00", 350), item("30,00", 420, 50), item(patch.value ?? "250,00", 520, 50), ...(patch.extra ?? []),
]);
const withCost = (charge = costCharge(), label?: string) => parseRcPayslipRows([header(), costNominal(label), charge]);

describe("coût RC strict : indemnité indépendante et charges patronales explicitement isolées", () => {
  it("lit la charge patronale RC et ajoute seulement son montant au nominal", () => {
    const parsed = parseRcPayslipRows([header(), costNominal(), costCharge(), row(4, [item("Cotisations patronales de salaire", 20, 225), item("9 999,00", 520, 50)]), row(5, [item("Autres contributions dues par l’employeur", 20, 225), item("8 888,00", 520, 50)]), row(6, [item("CSG CRDS sur indemnité de rupture conventionnelle", 20, 225), item("77,00", 420, 50)])]);
    expect(parsed).toMatchObject({ status: "identified", indemnityCents: 100000, cost: { status: "value", code: "explicit-employer-rc-cost", employerChargesCents: 25000, chargedCents: 125000, components: [{ label: "Contribution patronale sur indemnité de rupture conventionnelle", amountCents: 25000, page: 1, line: 3 }] } });
    expect(JSON.stringify(parsed.cost)).not.toMatch(/999900|888800|7700|3000/);
  });
  it.each(["Indemnité de rupture conventionnelle exonérée", "Indemnité de rupture conventionnelle non-soumise à cotisations"])("admet une exonération explicite de cotisations : %s", (label) => {
    expect(withCost(costCharge(), label)).toMatchObject({ status: "identified", cost: { status: "value", chargedCents: 125000 } });
  });
  it.each(["Indemnité de rupture conventionnelle", "Indemnité de rupture conventionnelle soumise", "Indemnité de rupture conventionnelle exonérée d’impôt"])("une qualification insuffisante conserve le nominal et bloque le coût : %s", (label) => {
    expect(withCost(costCharge(), label)).toMatchObject({ status: "identified", indemnityCents: 100000, cost: { status: "review", code: "rc-exemption-unconfirmed", chargedCents: null, employerChargesCents: null, components: [] } });
  });
  it("une partie soumise suffit à bloquer le coût complet sans effacer les composantes nominales", () => {
    const parsed = parseRcPayslipRows([header(), rc("Indemnité rupture conventionnelle exonérée", "600,00"), rc("Indemnité rupture conventionnelle soumise", "400,00", 3), costCharge({ line: 4 })]);
    expect(parsed).toMatchObject({ status: "identified", indemnityCents: 100000, cost: { status: "review", code: "rc-exemption-unconfirmed", chargedCents: null } });
    expect(parsed.components).toHaveLength(2);
  });
  it("absence de charge isolée ou libellé générique ne signifie jamais charge nulle", () => {
    for (const rows of [[header(), costNominal()], [header(), costNominal(), costCharge({ label: "Autres contributions dues par l’employeur" })], [header(), costNominal(), costCharge({ label: "Forfait social" })]]) {
      expect(parseRcPayslipRows(rows)).toMatchObject({ status: "identified", indemnityCents: 100000, cost: { status: "review", code: "no-explicit-employer-rc-charge", chargedCents: null, employerChargesCents: null } });
    }
  });
  it("un zéro patronal explicitement imprimé reste zéro confirmé", () => {
    expect(withCost(costCharge({ value: "0,00" }))).toMatchObject({ status: "identified", cost: { status: "value", chargedCents: 100000, employerChargesCents: 0, components: [{ amountCents: 0 }] } });
  });
  it("additionne des charges explicitement RC distinctes sans appliquer leur taux imprimé", () => {
    const first = costCharge({ value: "200,00" });
    const second = costCharge({ label: "Forfait social sur rupture conventionnelle", value: "50,00", line: 4 });
    expect(parseRcPayslipRows([header(), costNominal(), first, second])).toMatchObject({ status: "identified", indemnityCents: 100000, cost: { status: "value", employerChargesCents: 25000, chargedCents: 125000, components: [{ amountCents: 20000 }, { amountCents: 5000 }] } });
    second.items.find(item => item.x === 280)!.text = "600,00";
    expect(parseRcPayslipRows([header(), costNominal(), first, second])).toMatchObject({ status: "identified", cost: { status: "review", code: "rc-charge-base-mismatch", chargedCents: null, components: [] } });
  });
  it("aucun montant de base, taux ou salarié ne remplace la colonne patronale manquante", () => {
    const charge = costCharge(); charge.items = charge.items.filter(item => item.x !== 520);
    expect(withCost(charge)).toMatchObject({ status: "identified", cost: { status: "review", code: "employer-amount-ambiguous", chargedCents: null } });
    const unnamed = header(); unnamed.items[4].text = "Autre montant";
    expect(parseRcPayslipRows([unnamed, costNominal(), costCharge()])).toMatchObject({ status: "identified", cost: { status: "review", code: "employer-column-unrecognized", chargedCents: null } });
    const misleading = header(); misleading.items[4].text = "Taux patronal";
    expect(parseRcPayslipRows([misleading, costNominal(), costCharge()])).toMatchObject({ status: "identified", cost: { status: "review", code: "employer-column-unrecognized" } });
  });
  it("reconnaît un intitulé de montant patronal explicite", () => {
    const named = header(); named.items[4].text = "Montant patronal";
    expect(parseRcPayslipRows([named, costNominal(), costCharge()])).toMatchObject({ status: "identified", cost: { status: "value", employerChargesCents: 25000 } });
  });
  it("garde les bases absentes distinctes des bases présentes incohérentes", () => {
    expect(withCost(costCharge({ base: null }))).toMatchObject({ cost: { status: "value", chargedCents: 125000 } });
    for (const base of ["600,00", "-1 000,00", "1000", "(1 000,00)"]) expect(withCost(costCharge({ base }))).toMatchObject({ status: "identified", indemnityCents: 100000, cost: { status: "review", code: "rc-charge-base-mismatch", chargedCents: null } });
    expect(withCost(costCharge({ extra: [item("1 000,00", 290, 40)] }))).toMatchObject({ cost: { status: "review", code: "rc-charge-base-ambiguous" } });
  });
  it.each(["-250,00", "−250,00", "(250,00)", "250"])("un montant patronal signé ou non exact reste à vérifier : %s", (value) => {
    expect(withCost(costCharge({ value }))).toMatchObject({ status: "identified", indemnityCents: 100000, cost: { status: "review", chargedCents: null, employerChargesCents: null, components: [] } });
  });
  it.each(["Contribution patronale rupture conventionnelle ou mise à la retraite", "Contribution patronale licenciement et rupture conventionnelle", "Régularisation contribution patronale rupture conventionnelle", "Rappel contribution patronale rupture conventionnelle", "Contribution patronale annuelle rupture conventionnelle", "Contribution salariale rupture conventionnelle"])("un libellé mixte ou non patronal garde le coût à vérifier : %s", (label) => {
    expect(withCost(costCharge({ label }))).toMatchObject({ status: "identified", indemnityCents: 100000, cost: { status: "review", chargedCents: null } });
  });
  it("les charges en doublon et montants multiples n’engendrent aucun total partiel", () => {
    expect(parseRcPayslipRows([header(), costNominal(), costCharge(), costCharge({ line: 4 })])).toMatchObject({ status: "identified", cost: { status: "review", code: "duplicate-rc-charge", components: [] } });
    expect(withCost(costCharge({ extra: [item("123,45", 530, 50)] }))).toMatchObject({ cost: { status: "review", code: "employer-amount-ambiguous" } });
    expect(withCost(costCharge({ value: "1000000000001,00" }))).toMatchObject({ cost: { status: "review", code: "unsafe-rc-charge" } });
  });
  it("la colonne patronale du groupe est vérifiée sur le format à parents décalés", () => {
    const nominal = staggeredRc(); nominal.items[0].text += " non soumise";
    const charge = row(6, [atY("Contribution patronale rupture conventionnelle", 25, 560, 225), atY("1 234,56", 245, 560), atY("42,00", 325, 560), atY("10,00", 410, 560), atY("300,00", 500, 560)]);
    expect(parseRcPayslipRows([...staggeredHeader(), nominal, charge])).toMatchObject({ status: "identified", indemnityCents: 123456, cost: { status: "value", employerChargesCents: 30000, chargedCents: 153456 } });
  });
  it("lit un PDF fictif entier avec contribution RC et ignore salaires, autres cotisations et CSG salariée", async () => {
    const text = (label: string, x: number, y: number) => `BT /F1 8 Tf 1 0 0 1 ${x} ${y} Tm (${label}) Tj ET\n`;
    const content = text("Libelle", 20, 740) + text("Base", 280, 740) + text("Taux", 350, 740) + text("A payer", 420, 740) + text("Charges patronales", 520, 740)
      + text("Salaire fictif", 20, 720) + text("5000,00", 420, 720) + text("2000,00", 520, 720)
      + text("Cotisations patronales salaire", 20, 700) + text("600,00", 520, 700)
      + text("Indemnite rupture conventionnelle non soumise", 20, 680) + text("1000,00", 420, 680)
      + text("Contribution patronale rupture conventionnelle", 20, 660) + text("1000,00", 280, 660) + text("25,00", 350, 660) + text("30,00", 420, 660) + text("250,00", 520, 660)
      + text("CSG CRDS indemnite rupture conventionnelle", 20, 640) + text("100,00", 420, 640);
    expect(await extractRcPayslip(pdfFromContent(content))).toMatchObject({ parserVersion: "payfit-rc-coordinate-v4", status: "identified", indemnityCents: 100000, cost: { status: "value", employerChargesCents: 25000, chargedCents: 125000, components: [{ label: "Contribution patronale rupture conventionnelle", amountCents: 25000, page: 1, line: 5 }] } });
  });
  it("un coût confirmé ne fait pas apparaître ses montants dans le diagnostic de format", () => {
    const inspected = inspectRcPayslipRows([header(), costNominal(), costCharge()]);
    expect(inspected.extractionStatus).toBe("identified");
    expect(inspected).not.toHaveProperty("cost");
    expect(JSON.stringify(inspected)).not.toMatch(/100000|25000|125000|1 000,00|250,00|25,00|30,00/);
  });
});
