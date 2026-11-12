import { requireWorkspace } from '@/lib/workspace';
import { activeSync, configuredPayfitClient } from '@/lib/connectors/sync';
import { fetchPayFitPayslip } from '@/lib/connectors/payfit/payslips';
import { getRcPayslipScan } from '@/lib/payroll/rc-payslips-store';
import { sha256 } from '@/lib/crypto';

export const dynamic = 'force-dynamic';
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const { workspace } = await requireWorkspace(slug, 'editor');
  const fail = (status: number) => new Response('Bulletin indisponible ; relance la lecture des bulletins PayFit.', { status, headers: { 'Cache-Control': 'private, no-store' } });
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return fail(404);
  const scan = await getRcPayslipScan(workspace.id);
  const matches = scan?.records.filter(row => row.payslipId === id && row.pdfHash) ?? [];
  if (!scan || matches.length !== 1 || (await activeSync(workspace.id, 'payfit'))?.id !== scan.payrollSyncId) return fail(404);
  const record = matches[0];
  try {
    const { client, companyId } = await configuredPayfitClient(workspace.id);
    if (companyId !== scan.companyId) return fail(409);
    const bytes = await fetchPayFitPayslip(client, companyId, record.collaboratorId, record.contractId, record.payslipId);
    if (sha256(Buffer.from(bytes)) !== record.pdfHash) return fail(409);
    return new Response(new Uint8Array(bytes).buffer, { headers: {
      'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="bulletin-payfit.pdf"',
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    } });
  } catch { return fail(502); }
}
