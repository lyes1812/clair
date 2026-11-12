import { requireWorkspace } from "@/lib/workspace";
import { activeSync, configuredPayfitClient } from "@/lib/connectors/sync";
import { fetchPayFitPayslip } from "@/lib/connectors/payfit/payslips";
import { getRcPayslipScan } from "@/lib/payroll/rc-payslips-store";
import { inspectRcPayslipFormat, RC_PARSER_VERSION, type RcPayslipFormat } from "@/lib/payroll/rc-payslip-parser";
import { sha256 } from "@/lib/crypto";

export const dynamic = "force-dynamic";

export default async function ControleBulletinsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { workspace } = await requireWorkspace(slug, "editor");
  const scan = await getRcPayslipScan(workspace.id);
  const source = await activeSync(workspace.id, "payfit");
  const unavailable = <section className="panel"><h1>Contrôle du format des bulletins</h1><p>Lecture indisponible ou remplacée. Relance la lecture des bulletins PayFit.</p></section>;
  if (!scan || source?.id !== scan.payrollSyncId) return unavailable;
  const selected = scan.records.filter((record) => record.status === "review" && record.pdfHash).slice(0, 5);
  const inspected: { month: string; storedParserVersion: string; format: RcPayslipFormat | null; state: string }[] = [];
  try {
    const { client, companyId } = await configuredPayfitClient(workspace.id);
    if (companyId !== scan.companyId) return unavailable;
    for (const record of selected) {
      try {
        const bytes = await fetchPayFitPayslip(client, companyId, record.collaboratorId, record.contractId, record.payslipId);
        if (sha256(Buffer.from(bytes)) !== record.pdfHash) {
          inspected.push({ month: record.month, storedParserVersion: record.parserVersion, format: null, state: "Bulletin modifié : nouvelle lecture nécessaire." });
          continue;
        }
        inspected.push({ month: record.month, storedParserVersion: record.parserVersion, format: await inspectRcPayslipFormat(bytes), state: "Empreinte vérifiée" });
      } catch {
        inspected.push({ month: record.month, storedParserVersion: record.parserVersion, format: null, state: "Bulletin indisponible pour ce contrôle." });
      }
    }
  } catch { return unavailable; }
  return <div className="page-stack" data-testid="rc-payslip-format-control">
    <section className="panel"><h1>Contrôle du format des bulletins</h1><p>Lecteur actuel : <code>{RC_PARSER_VERSION}</code></p><p>Géométrie et vocabulaire d’entête uniquement. Aucun montant ou texte individuel n’est affiché.</p></section>
    {!selected.length && <p>Aucun bulletin à vérifier dans la lecture courante.</p>}
    {inspected.map((item, index) => <section className="panel" key={index} data-testid="rc-payslip-format-result">
      <h2>Bulletin {index + 1} · {item.month}</h2>
      <p>Version enregistrée : <code>{item.storedParserVersion}</code> · {item.state}</p>
      {item.format && <pre style={{ overflowX: "auto", maxWidth: "100%" }} data-testid="rc-payslip-safe-format">{JSON.stringify(item.format, null, 2)}</pre>}
    </section>)}
  </div>;
}
