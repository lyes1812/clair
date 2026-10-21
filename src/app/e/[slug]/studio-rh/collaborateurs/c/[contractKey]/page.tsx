import { notFound } from "next/navigation";
import { PROVIDER_LABELS } from "@/lib/connectors/labels";
import { loadAbsences } from "@/lib/rh/referential/store";
import { KEY_RE, loadCollabContext } from "@/lib/rh/view";
import { base, CollabHeader, FindingList } from "../../components";
import { ContractPanel } from "../../ContractPanel";

export const dynamic = "force-dynamic";

export default async function ContractPage({ params }: { params: Promise<{ slug: string; contractKey: string }> }) {
  const { slug, contractKey: raw } = await params;
  const contractKey = decodeURIComponent(raw);
  if (!KEY_RE.test(contractKey)) notFound();
  const ctx = await loadCollabContext(slug);
  const keySource = contractKey.split(":")[0];
  if (ctx.chosen && keySource !== ctx.chosen) {
    return (
      <CollabHeader ctx={ctx} tab={null}>
        <section className="placeholder" data-testid="other-source">
          <h3>Cette fiche appartient à la source {PROVIDER_LABELS[keySource as "payfit" | "dsn"]}, qui n'est pas la source retenue</h3>
          <p className="muted">Source retenue : {PROVIDER_LABELS[ctx.chosen]}. <a href={base(slug)}>Retour à la liste</a>.</p>
        </section>
      </CollabHeader>
    );
  }
  const d = ctx.data;
  if (!d) return <CollabHeader ctx={ctx} tab={null} />;
  const c = d.contracts.find((x) => x.contractKey === contractKey);
  if (!c) notFound();
  const person = c.personKey ? (d.persons.find((p) => p.personKey === c.personKey) ?? null) : null;
  const absences = d.build.source === "payfit" && d.build.inputs.source === "payfit" ? await loadAbsences(ctx.workspace.id, d.build.inputs.syncId, [c.externalId]) : null;
  const persons = new Map(d.persons.map((p) => [p.personKey, p]));
  const contractMap = new Map(d.contracts.map((x) => [x.contractKey, x]));
  return (
    <CollabHeader ctx={ctx} tab={null}>
      <span className="label"><a href={base(slug)}>Collaborateurs</a> / Contrat</span>
      <ContractPanel c={c} data={d} slug={slug} person={person} months={d.months.filter((m) => m.contractKey === contractKey)} events={d.events.filter((e) => e.contractKey === contractKey)} absences={absences} />
      <section className="panel">
        <h3>Constats</h3>
        <FindingList findings={d.findings.filter((f) => f.contractKeys.includes(contractKey))} slug={slug} persons={persons} contracts={contractMap} />
      </section>
    </CollabHeader>
  );
}
