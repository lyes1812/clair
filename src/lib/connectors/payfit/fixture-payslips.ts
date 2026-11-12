import { PAYFIT_API } from "./client";

type Contract = { id: string; personId: string; contractType?: string };
type Person = { id: string; externalId: string };
type Period = { contractId: string; month: string; grossMinor: number | null; employerChargesMinor: number | null };
type FixtureInput = { companyId: string; contracts: Contract[]; people: Person[]; periods: Period[]; enabled: boolean };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const decimal = (cents: number) => `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}`;

/** Bulletin de recette généré en mémoire, sans nom ni donnée client. */
export function fixturePayslipPdf(month: string, grossCents: number | null, contributionCents: number | null, rcCents: number | null): Uint8Array {
  const text = (label: string, x: number, y: number) => `BT /F1 9 Tf 1 0 0 1 ${x} ${y} Tm (${label}) Tj ET\n`;
  let content = text(`BULLETIN FICTIF - ${month}`, 20, 750)
    + text("Libelle", 20, 700) + text("Base", 280, 700) + text("Taux", 350, 700) + text("Gains", 420, 700) + text("Charges patronales", 520, 700)
    + text("Salaire fictif", 20, 680) + text(grossCents === null ? "n.d." : decimal(grossCents), 420, 680)
    + text(contributionCents === null ? "n.d." : decimal(contributionCents), 520, 680);
  if (rcCents !== null) content += text("Indemnite de rupture conventionnelle", 20, 660) + text(decimal(rcCents), 420, 660);
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 650 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${content.length} >>\nstream\n${content}endstream`];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((body, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("") + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

export function createFixturePayslips(input: FixtureInput): (rest: string) => Response | null {
  // Cas de recette explicites et entièrement fictifs. Ils ne modifient ni les dates du référentiel, ni le journal.
  const permanent = input.contracts.filter(contract => contract.contractType === "TEST-PERMANENT").sort((a, b) => a.id.localeCompare(b.id));
  const examples = new Map<string, number>([
    ...(permanent[0] ? [[`${permanent[0].id}|2025-12`, 123_456] as const] : []),
    ...(permanent[1] ? [[`${permanent[1].id}|2026-02`, 234_567] as const] : []),
  ]);
  const periods = input.periods.filter(period => input.contracts.some(contract => contract.id === period.contractId));
  const idOf = (period: Period) => `FICTIF-${period.contractId}-${period.month.replace("-", "")}`;
  return (rest) => {
    const list = /^collaborators\/([A-Za-z0-9_-]+)\/payslips$/.exec(rest);
    const file = /^collaborators\/([A-Za-z0-9_-]+)\/contracts\/([A-Za-z0-9_-]+)\/payslips\/([A-Za-z0-9_-]+)$/.exec(rest);
    if (!list && !file) return null;
    if (!input.enabled) return json({}, 403);
    const collaboratorId = (list ?? file)![1];
    const person = input.people.find(person => person.externalId === collaboratorId);
    if (!person) return json({}, 404);
    const known = new Set(input.contracts.filter(contract => contract.personId === person.id).map(contract => contract.id));
    const selected = periods.filter(period => known.has(period.contractId));
    if (list) return json({ payslips: selected.map(period => ({ year: period.month.slice(0, 4), month: period.month.slice(5), contractId: period.contractId, payslipId: idOf(period), payslipUrl: `${PAYFIT_API}/companies/${input.companyId}/collaborators/${collaboratorId}/contracts/${period.contractId}/payslips/${idOf(period)}` })) });
    const period = selected.find(period => period.contractId === file![2] && idOf(period) === file![3]);
    if (!period) return json({}, 404);
    const bytes = fixturePayslipPdf(period.month, period.grossMinor, period.employerChargesMinor, examples.get(`${period.contractId}|${period.month}`) ?? null);
    return new Response(new Uint8Array(bytes).buffer, { headers: { "content-type": "application/pdf" } });
  };
}
