import "@/styles/masse-salariale.css";
import "@/styles/croisee.css";
import type { ReactNode } from "react";
import { GlossaryLink } from "@/components/GlossaryLink";
import { MoneyText, MoneyUnitLabel } from "@/components/Money";
import { SearchableSelect } from "@/components/SearchableSelect";
import { SourceBadge } from "@/components/SourceBadge";
import { ViewSwitch } from "@/components/ViewSwitch";
import { dateTimeFmt } from "@/lib/connectors/labels";
import type { PayrollContext } from "@/lib/payroll/context";
import { CROISEE_TERMS as T } from "@/lib/glossary/croisee";
import { STUDIO_RH_ITEMS } from "@/lib/nav";
import type { ChapterId } from "@/lib/viz/croisee";
import { MM, MONTH_NAMES, presets } from "@/lib/viz/synthese";
import { requireWorkspace } from "@/lib/workspace";
import { MsHeader, MsTabs } from "../EcartParts";
import { NdNote } from "./atomes/NdNote";
import ChAbsences from "./ChAbsences";
import { ChapterMenu } from "./ChapterMenu";
import { ChapterHead, ChapterPager, ChapterTabs } from "./ChapterNav";
import { CHAPTER_TOTAL, CHAPTERS } from "./chapitres";
import ChBudget from "./ChBudget";
import ChEffectifs from "./ChEffectifs";
import ChEffets from "./ChEffets";
import ChFixeVariable from "./ChFixeVariable";
import ChJuridique from "./ChJuridique";
import ChPaieCompta from "./ChPaieCompta";
import ChRestructuration from "./ChRestructuration";
import ChServices from "./ChServices";
import ChSynthese from "./ChSynthese";
import { loadCroiseeContext, openMonthsText, type CroiseeContext } from "./context";
import { PrintActions } from "./PrintActions";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;
const ITEM = STUDIO_RH_ITEMS.find((i) => i.path === "studio-rh/masse-salariale")!;

// Un composant serveur par chapitre ; un seul est rendu par requête et ne lit que ses propres données (lecteurs du contexte).
const CHAPTER_VIEWS: Record<ChapterId, (p: { ctx: CroiseeContext }) => ReactNode | Promise<ReactNode>> = {
  synthese: ChSynthese,
  effectifs: ChEffectifs,
  absences: ChAbsences,
  "fixe-variable": ChFixeVariable,
  services: ChServices,
  budget: ChBudget,
  "paie-compta": ChPaieCompta,
  effets: ChEffets,
  restructuration: ChRestructuration,
  juridique: ChJuridique,
};

// Lien vers un autre chapitre : mêmes période, service, budget, scénario et affichage ; le tri, propre à un tableau, est retiré.
const chapterHref = (ctx: CroiseeContext) => (id: ChapterId, hash?: string) => ctx.href({ chapitre: id, tri: null, sens: null }, hash);

// Ligne de périmètre, écrite une fois (résumé du tiroir de filtres) : période, N-1, service, budget, scénario, mois non clos.
function Scope({ ctx }: { ctx: CroiseeContext }) {
  if (!ctx.period) return <span className="cx-scope" data-testid="cx-scope">Période : <span className="nd">n.d.</span></span>;
  const b = ctx.budget.selected;
  const s = ctx.scenario.selected;
  return (
    <span className="cx-scope" data-testid="cx-scope">
      <strong>{ctx.labels.period}</strong> · N-1 : {ctx.labels.prev} · {ctx.service.label}
      {" · "}Budget : {b ? `« ${b.name} »` : <span className="nd">n.d.</span>}
      {" · "}Scénario : {s ? `« ${s.scenario.name} »` : <span className="nd">n.d.</span>}
      {ctx.openMonths.length > 0 && <> · mois non clos : {openMonthsText(ctx)}</>}
    </span>
  );
}

// Tiroir « Filtres » : période (année, premier et dernier mois, périodes rapides dérivées du dernier mois disponible), service,
// budget et scénario. Formulaire GET : l'adresse est la seule source de vérité ; « Réinitialiser » revient aux choix par défaut.
function FiltersDrawer({ ctx }: { ctx: CroiseeContext }) {
  const p = ctx.period;
  const hidden: [string, string][] = [["chapitre", ctx.chapter.id]];
  if (ctx.affichage !== "tout") hidden.push(["affichage", ctx.affichage]);
  if (ctx.query.tri) hidden.push(["tri", ctx.query.tri]);
  if (ctx.query.sens) hidden.push(["sens", ctx.query.sens]);
  const quick = p ? presets(p.last).map((x) => ({ ...x, href: ctx.href({ de: x.de, a: x.a }), current: x.de === p.from && x.a === p.to })) : [];
  const choice = (name: "budget" | "scenario", label: string, sel: { explicit: boolean; options: { value: string; label: string }[]; reason: string | null }, current: string | null, defaultName: string | null) =>
    sel.options.length > 0 ? (
      <div className="field-row">
        <label htmlFor={`cx-${name}`}>{label}</label>
        <SearchableSelect
          className="select"
          id={`cx-${name}`}
          name={name}
          defaultValue={sel.explicit && current ? current : ""}
          searchLabel={label}
          options={[{ value: "", label: defaultName ? `Le plus récent (« ${defaultName} »)` : "Le plus récent" }, ...sel.options]}
        />
      </div>
    ) : (
      <div className="field-row cx-field-nd">
        <span className="cx-field-label">{label}</span>
        <span className="tile-foot">
          <strong className="nd">n.d.</strong> — {sel.reason ?? "aucun choix possible"}
        </span>
      </div>
    );
  return (
    <details className="cx-filters" open data-testid="cx-filters">
      <summary>
        <span className="cx-filters-title">Filtres</span> <Scope ctx={ctx} />
      </summary>
      {p ? (
        <form method="get" action={ctx.base} className="filters bar ms-bar cx-filter-form" aria-label="Période et périmètre">
          {hidden.map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <div className="field-row">
            <label htmlFor="cx-annee">Année</label>
            <select className="select" id="cx-annee" name="annee" defaultValue={String(p.year)}>
              {p.years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div className="field-row">
            <label htmlFor="cx-de">
              Premier mois
              <GlossaryLink slug={ctx.slug} term={T.periodeFiltres} label="Période, service et comparaison à N-1" />
            </label>
            <select className="select" id="cx-de" name="de" defaultValue={p.from}>
              {MM.map((m, i) => (
                <option key={m} value={m}>{MONTH_NAMES[i]}</option>
              ))}
            </select>
          </div>
          <div className="field-row">
            <label htmlFor="cx-a">Dernier mois</label>
            <select className="select" id="cx-a" name="a" defaultValue={p.to}>
              {MM.map((m, i) => (
                <option key={m} value={m}>{MONTH_NAMES[i]}</option>
              ))}
            </select>
          </div>
          {ctx.service.options.length > 0 ? (
            <div className="field-row">
              <label htmlFor="cx-service">Service</label>
              <SearchableSelect className="select" id="cx-service" name="service" defaultValue={ctx.state.service ?? ""} searchLabel="Service" options={ctx.service.options} />
            </div>
          ) : (
            <div className="field-row cx-field-nd">
              <span className="cx-field-label">Service</span>
              <span className="tile-foot">
                <strong className="nd">n.d.</strong> — {ctx.service.reason ?? "aucun service"}
              </span>
            </div>
          )}
          {choice("budget", "Budget saisi", ctx.budget, ctx.state.budget ?? null, ctx.budget.explicit ? null : (ctx.budget.selected?.name ?? null))}
          {choice("scenario", "Scénario", ctx.scenario, ctx.state.scenario ?? null, ctx.scenario.explicit ? null : (ctx.scenario.selected?.scenario.name ?? null))}
          <div className="ms-bar-actions">
            <button className="btn primary" type="submit">Afficher</button>
            <a className="btn" href={ctx.href({ annee: null, de: null, a: null, service: null, budget: null, scenario: null, tri: null, sens: null, affichage: null })}>
              Réinitialiser
            </a>
          </div>
          {quick.length > 0 && (
            <div className="ms-bar-presets" data-testid="cx-presets" role="group" aria-label="Périodes rapides">
              <span className="ms-bar-label">Périodes rapides</span>
              {quick.map((x) => (
                <a key={x.label} className="btn small" href={x.href} aria-current={x.current ? "true" : undefined}>{x.label}</a>
              ))}
            </div>
          )}
        </form>
      ) : (
        <div className="cx-filters-nd">
          <NdNote label="Période" reason={ctx.periodNd ?? "aucun mois disponible"} action={{ href: `/e/${ctx.slug}/donnees`, label: ctx.canEdit ? "Choisir ou lire une source dans Données" : "Données" }} testid="cx-period-nd" />
        </div>
      )}
    </details>
  );
}

// Pied de page : unités et sources (une seule fois sur la page) ; les sources ne sont rappelées que pour un chapitre qui les lit.
function PageFoot({ ctx, pay }: { ctx: CroiseeContext; pay: PayrollContext | null }) {
  return (
    <footer className="cx-foot" data-testid="cx-foot">
      <p className="tile-foot">
        Unités : montants en <MoneyUnitLabel /> · ETP en équivalents temps plein · taux en pourcentage, écarts de taux en points
        <GlossaryLink slug={ctx.slug} term={T.unites} label="Unités" />
      </p>
      {pay && (
        <>
          <SourceBadge resolution={pay.kpi.collab.source} slug={ctx.slug} />
          <p className="tile-foot" data-testid="cx-source-paie">
            Journal de paie : {pay.read ? `lecture PayFit du ${dateTimeFmt.format(pay.read.startedAt)}` : <><span className="nd">n.d.</span> — {pay.unavailable ?? "aucune lecture appliquée"}</>}
            <GlossaryLink slug={ctx.slug} term={T.source} label="Source et date de lecture" />
          </p>
        </>
      )}
    </footer>
  );
}

export default async function CroiseePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Search> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { workspace } = await requireWorkspace(slug);
  const ctx = await loadCroiseeContext(slug, workspace, sp);
  const chapter = ctx.chapter;
  const pay = chapter.filtres ? await ctx.load.payroll() : null;
  const Chapter = CHAPTER_VIEWS[chapter.id];
  const hrefOf = chapterHref(ctx);
  const menu = CHAPTERS.map((c) => ({ id: c.id, num: c.num, title: c.title, description: c.description, href: hrefOf(c.id), prevu: c.statut === "prevu" }));
  // Emplacement des exports du chapitre (menu « Exporter », Excel puis CSV) : branché par la vague des exports.
  const exportsSlot: ReactNode = null;
  return (
    <MoneyText>
      <div className="cx-page" data-testid="cx-page" data-chapter={chapter.id}>
        <p className="cx-print-head">
          {ctx.workspace.name} · Masse salariale croisée · {chapter.num} / {CHAPTER_TOTAL} {chapter.title}
          {ctx.period && <> · {ctx.labels.period} · N-1 : {ctx.labels.prev} · {ctx.service.label}</>}
        </p>
        <MsHeader title={ITEM.label} />
        <MsTabs slug={slug} current="croisee" />
        <div className="cx-bar">
          <ChapterMenu items={menu} current={chapter.id} total={CHAPTER_TOTAL} />
          <div className="cx-bar-tools">
            {chapter.graphiques && ctx.period && (
              <ViewSwitch
                testid="cx-affichage"
                label="Affichage du chapitre"
                current={ctx.affichage}
                options={[
                  { key: "tout", label: "Afficher tout", href: ctx.href({ affichage: "tout" }) },
                  { key: "graphique", label: "Graphiques", href: ctx.href({ affichage: "graphique" }) },
                  { key: "tableau", label: "Tableaux", href: ctx.href({ affichage: "tableau" }) },
                ]}
              />
            )}
            {exportsSlot}
            <PrintActions synthese={chapter.id === "synthese"} />
            <GlossaryLink slug={slug} term={T.impression} label="Impression et PDF de la synthèse" />
          </div>
        </div>
        <ChapterTabs current={chapter.id} hrefOf={hrefOf} />
        {chapter.filtres && <FiltersDrawer ctx={ctx} />}
        {ctx.notices.map((n) => (
          <p key={n} className="notice" data-testid="cx-param-notice">{n}</p>
        ))}
        <ChapterHead chapter={chapter} slug={slug} />
        <div className="cx-chapter-body" id={`cx-${chapter.id}`}>
          <Chapter ctx={ctx} />
        </div>
        <ChapterPager chapter={chapter} hrefOf={hrefOf} />
        <PageFoot ctx={ctx} pay={pay} />
      </div>
    </MoneyText>
  );
}
