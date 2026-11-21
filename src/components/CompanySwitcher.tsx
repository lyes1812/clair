"use client";

import { useActionState } from "react";
import { selectCompanyAction } from "@/app/e/[slug]/company-actions";

export function CompanySwitcher({ slug, companies, selectedId }: { slug: string; companies: { id: string; name: string }[]; selectedId: string | null }) {
  const [state, action, pending] = useActionState(selectCompanyAction.bind(null, slug), undefined);
  return <div className="company-scope-bar" data-testid="company-switcher">
    <p className="company-print-label">Société : {companies.find(company => company.id === selectedId)?.name ?? "non sélectionnée"}</p>
    <form action={action} className="company-switch-form" key={selectedId ?? "unselected"}>
      <label htmlFor="active-company">Société</label>
      <select className="select" id="active-company" name="companyId" defaultValue={selectedId ?? ""} required>
        {!selectedId && <option value="">Choisir une société</option>}
        {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
      </select>
      <button className="btn" type="submit" disabled={pending}>{pending ? "Ouverture…" : "Afficher"}</button>
      <a href={`/e/${slug}/studio-rh/hypotheses?vue=societes${selectedId ? `&societe=${encodeURIComponent(selectedId)}` : ""}`}>Sociétés de l’espace</a>
    </form>
    {state?.error && <p className="error" role="alert">{state.error}</p>}
  </div>;
}
