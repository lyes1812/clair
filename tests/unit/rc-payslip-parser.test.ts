import { describe, expect, it } from "vitest";
import { extractRcPayslip, parseRcPayslipRows, RC_PARSER_VERSION, type RcPayslipTextItem, type RcPayslipTextRow } from "@/lib/payroll/rc-payslip-parser";

const item = (text: string, x: number, width = 40): RcPayslipTextItem => ({ text, x, y: 500, width, height: 10 });
const row = (line: number, items: RcPayslipTextItem[], page = 1): RcPayslipTextRow => ({ page, line, items });
const header = (page = 1) => row(1, [item("Libellé", 20), item("Base", 280), item("Taux", 350), item("À payer", 420, 50), item("Charges patronales", 520, 65)], page);
const rc = (label: string, value: string, line = 2, extra: RcPayslipTextItem[] = [], page = 1) => row(line, [item(label, 20, 225), ...extra, item(value, 420, 50)], page);
const groupedHeader = () => [
  row(1, [item("DÉSIGNATION", 20, 150), item("BASE", 280, 40), item("PART SALARIÉ", 380, 60), item("PART EMPLOYEUR", 525, 70)]),
  row(2, [item("TAUX OU %", 360, 50), item("MONTANT", 450, 50), item("MONTANT", 535, 50)]),
];
const groupedRc = (line = 3, value = "1 234,56") => row(line, [item("Indemnité de rupture conventionnelle", 20, 225), item("9 000,00", 280, 40), item("20,00", 360, 50), item(value, 450, 50), item("999,99", 535, 50)]);
// PDF minimal créé en mémoire : aucune fixture contenant des données clients.
function fictionalPdf(grouped = false): Uint8Array {
  const text = (label: string, x: number, y: number) => `BT /F1 9 Tf 1 0 0 1 ${x} ${y} Tm (${label}) Tj ET\n`;
  const content = grouped
    ? text("DESIGNATION", 20, 720) + text("BASE", 280, 720) + text("PART SALARIE", 380, 720) + text("PART EMPLOYEUR", 525, 720)
      + text("TAUX OU %", 360, 700) + text("MONTANT", 450, 700) + text("MONTANT", 535, 700)
      + text("Indemnite de rupture conventionnelle", 20, 680) + text("9000,00", 280, 680) + text("20,00", 360, 680) + text("1234,56", 450, 680) + text("999,99", 535, 680)
    : text("Libelle", 20, 700) + text("Base", 280, 700) + text("Taux", 350, 700) + text("A payer", 420, 700) + text("Charges patronales", 520, 700)
      + text("Indemnite de rupture conventionnelle", 20, 680) + text("9000,00", 280, 680) + text("20,00", 350, 680) + text("1234,56", 420, 680) + text("300,00", 520, 680);
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
    expect(parsed).toEqual({ status: "identified", code: "explicit-rc-amount", indemnityCents: 123456, components: [{ label: "Indemnité de rupture conventionnelle", amountCents: 123456, page: 1, line: 2 }], parserVersion: RC_PARSER_VERSION });
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
});
