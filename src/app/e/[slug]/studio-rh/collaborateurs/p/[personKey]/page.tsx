import { notFound } from "next/navigation";
import { dateTimeFmt, PROVIDER_LABELS } from "@/lib/connectors/labels";
import { loadAbsences } from "@/lib/rh/referential/store";
import { IDENTIFIER_LABELS, KEY_RE, loadCollabContext, personLabel } from "@/lib/rh/view";
import { base, CollabHeader, Field, FindingList, Prov } from "../../components";
import { ContractPanel } from "../../ContractPanel";

export const dynamic = "force-dynamic";

export default async function PersonPage({ params }: { params: Promise<{ slug: string; personKey: string }> }) {
  const { slug, personKey: raw } = await params;
  const personKey = decodeURIComponent(raw);
  if (!KEY_RE.test(personKey)) notFound();
  const ctx = await loadCollabContext(slug);
  const keySource = personKey.split(":")[0];
  if (ctx.chosen && keySource !== ctx.chosen) {
    return (
      <CollabHeader ctx={ctx} tab={null}>
        <section className="placeholder" data-testid="other-source">
          <h3>Cette fiche appartient à la source {PROVIDER_LABELS[keySource as "payfit" | "dsn"]}, qui n'est pas la source retenue</h3>
          <p className="muted">Source retenue : {PROVIDER_LABELS[ctx.chosen]}. Les identifiants des deux sources sont distincts et ne sont jamais rapprochés. <a href={base(slug)}>Retour à la liste</a>.</p>
        </section>
      </CollabHeader>
    );
  }
  const d = ctx.data;
  if (!d) return <CollabHeader ctx={ctx} tab={null} />;
  const person = d.persons.find((p) => p.personKey === personKey);
  if (!person) notFound();
  const contracts = d.contracts.filter((c) => c.personKey === personKey).sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? "") || a.contractKey.localeCompare(b.contractKey));
  const keys = new Set(contracts.map((c) => c.contractKey));
  const findings = d.findings.filter((f) => f.personKeys.includes(personKey) || f.contractKeys.some((k) => keys.has(k)));
  const persons = new Map(d.persons.map((p) => [p.personKey, p]));
  const contractMap = new Map(d.contracts.map((c) => [c.contractKey, c]));
  const absences = d.build.source === "payfit" && d.build.inputs.source === "payfit" ? await loadAbsences(ctx.workspace.id, d.build.inputs.syncId, contracts.map((c) => c.externalId)) : null;
  const syncIds = [...new Set([...Object.values(person.provenance), ...contracts.flatMap((c) => Object.values(c.provenance))].map((p) => p.syncId))];

  return (
    <CollabHeader ctx={ctx} tab={null}>
      <section className="panel" data-testid="collab-person">
        <span className="label"><a href={base(slug)}>Collaborateurs</a> / Fiche</span>
        <h2>{personLabel(person) ?? <span className="nd">n.d. — {person.fieldsNd.familyName?.reason ?? "nom absent"}</span>} <code>{person.externalId}</code></h2>
        <dl className="facts">
          <div><dt>Nom</dt><dd><Field row={person} field="familyName" value={person.familyName} slug={slug} /></dd></div>
          <div><dt>Prénoms</dt><dd><Field row={person} field="givenNames" value={person.givenNames} slug={slug} /></dd></div>
          <div><dt>Nom d'usage</dt><dd><Field row={person} field="usageName" value={person.usageName} slug={slug} /></dd></div>
          <div><dt>Matricule</dt><dd><Field row={person} field="employeeNumber" value={person.employeeNumber} slug={slug} /></dd></div>
          <div><dt>Équipe</dt><dd><Field row={person} field="teamName" value={person.teamName} slug={slug} /></dd></div>
          <div><dt>Type d'identifiant</dt><dd>{IDENTIFIER_LABELS[person.identifierKind]} <Prov p={person.provenance.externalId} slug={slug} /></dd></div>
          <div><dt>SIREN</dt><dd>{person.siren ?? <span className="nd">n.d.</span>}</dd></div>
          <div><dt>Établissements</dt><dd>{person.establishmentIds.map((e) => <code key={e} style={{ marginRight: 6 }}>{e}</code>)}</dd></div>
          {d.build.source === "dsn" && (
            <>
              <div><dt>Première déclaration</dt><dd><Field row={person} field="firstDeclaredMonth" value={person.firstDeclaredMonth} slug={slug} /></dd></div>
              <div><dt>Dernière déclaration</dt><dd><Field row={person} field="lastDeclaredMonth" value={person.lastDeclaredMonth} slug={slug} /></dd></div>
            </>
          )}
        </dl>
        <h3>Constats</h3>
        <FindingList findings={findings} slug={slug} persons={persons} contracts={contractMap} testId="person-findings" />
      </section>

      {contracts.length === 0 && (
        <section className="placeholder" data-testid="person-no-contract">
          <h3>Aucun contrat</h3>
          <p className="muted">{d.build.source === "payfit" ? "aucun contrat connu dans la lecture PayFit appliquée" : "aucun contrat déclaré dans les déclarations retenues"}.</p>
        </section>
      )}
      {contracts.map((c) => (
        <ContractPanel
          key={c.contractKey}
          c={c}
          data={d}
          slug={slug}
          person={person}
          months={d.months.filter((m) => m.contractKey === c.contractKey)}
          events={d.events.filter((e) => e.contractKey === c.contractKey)}
          absences={absences ? absences.filter((a) => a.contractId === c.externalId) : null}
        />
      ))}

      <p className="desc" data-testid="person-foot">
        Source {PROVIDER_LABELS[d.build.source]} · {ctx.source.appliedAt ? `lecture appliquée le ${dateTimeFmt.format(ctx.source.appliedAt)}` : "date d'application n.d."} · référentiel reconstruit le {dateTimeFmt.format(d.build.builtAt)} ·{" "}
        {syncIds.map((id) => <a key={id} href={`/e/${slug}/donnees/synchro/${id}`} style={{ marginRight: 8 }}>lecture {id.slice(0, 8)}</a>)}
      </p>
    </CollabHeader>
  );
}
