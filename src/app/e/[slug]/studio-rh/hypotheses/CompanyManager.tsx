import "@/styles/companies.css";
import { FamilyTabs } from "@/components/FamilyTabs";
import { getCompanyContext } from "@/lib/companies";
import { companyOverview } from "@/lib/company-overview";
import { dateTimeFmt } from "@/lib/connectors/labels";
import { requireWorkspace } from "@/lib/workspace";
import { CreateCompanyForm, RenameCompanyForm } from "./CompanyForms";
import { VUES } from "./tabs";

const providers: Record<string, string> = { payfit: "PayFit", pennylane: "Pennylane", dsn: "DSN", fec: "FEC" };
export async function CompanyManagerPage({ slug }: { slug: string }) {
  const { workspace } = await requireWorkspace(slug);
  const [context, rows] = await Promise.all([getCompanyContext(workspace.id), companyOverview(workspace.id)]);
  const admin = workspace.role === "admin";
  const base = `/e/${slug}/studio-rh/hypotheses`;
  const forCompany = (path: string, id: string) => `${path}${path.includes("?") ? "&" : "?"}societe=${encodeURIComponent(id)}`;
  return <div className="company-manager" data-testid="company-manager">
    <header className="company-manager-head"><span className="label">Studio RH</span><h1>Hypothèses budgétaires</h1><p className="desc">Sociétés de l’espace</p></header>
    <FamilyTabs label="Entrées Hypothèses budgétaires" testid="hyp-tabs" current="societes" tabs={VUES.map((v) => ({ key: v.key, label: v.label, href: `${base}?vue=${v.key}`, soon: "soon" in v ? Boolean(v.soon) : false }))} />
    <div className="company-manager-title"><h2>Sociétés</h2><span className="desc">{rows.length} périmètre(s)</span></div>
    {context.selectionError && <p className="notice" data-testid="company-selection-notice">{context.selectionError} Choisis une société ci-dessous.</p>}
    <div className="company-grid">{rows.map(({ company, connections, lastRead, hasSources, scenarios }) => <section className={`panel company-card${context.selected?.id === company.id ? " is-selected" : ""}`} key={company.id} data-testid="company-card" data-company={company.id}>
      <div><h2>{company.name}</h2><p className="desc">{company.siren ? `SIREN ${company.siren}` : "SIREN non renseigné"}{context.selected?.id === company.id && " · société sélectionnée"}</p></div>
      <dl className="facts"><div><dt>Connexions</dt><dd>{connections.length ? connections.map((row) => providers[row.provider] ?? row.provider).join(" · ") : "Aucune source connectée"}</dd></div>
        <div><dt>Dernière lecture appliquée</dt><dd>{lastRead ? `${providers[lastRead.provider] ?? lastRead.provider} · ${dateTimeFmt.format(lastRead.startedAt)}` : "n.d. — aucune lecture appliquée"}</dd></div>
        <div><dt>Scénarios</dt><dd>{scenarios.length}</dd></div>
      </dl>
      {!lastRead && <p className="desc">Base n.d. — connecte une source de cette société et applique une lecture pour préparer un scénario.</p>}
      <div className="company-card-links"><a className="btn" href={forCompany(`/e/${slug}/donnees`, company.id)}>Sources de la société</a><a href={forCompany(base, company.id)}>Scénarios de la société</a></div>
      {scenarios.length > 0 && <details><summary>Voir les scénarios</summary><ul>{scenarios.map((scenario) => <li key={scenario.id}><a href={forCompany(`${base}?scenario=${scenario.id}`, company.id)}>{scenario.name}</a> · {scenario.status === "fige" ? "Figé" : "Brouillon"}</li>)}</ul></details>}
      {company.origin === "initial" && <details><summary>Vigilance · périmètre historique</summary><p className="desc">Cette société reprend le périmètre de l’espace avant l’activation du multi-sociétés. Les lectures historiques et les bases figées sont conservées avec leur provenance d’origine.</p></details>}
      {admin && <details><summary>Modifier les informations</summary><RenameCompanyForm slug={slug} company={company} sirenLocked={hasSources} /></details>}
    </section>)}</div>
    {admin && <details className="panel company-card" open={rows.length === 0}><summary>Ajouter une société</summary><CreateCompanyForm slug={slug} /><p className="desc">La nouvelle société démarre sans source et sans scénario. Ses connexions et lectures restent indépendantes des autres sociétés.</p></details>}
  </div>;
}
