import "@/styles/croisee-masse.css";
import { MoneyText } from "@/components/Money";
import { servicesModel, servicesSort, SERVICES_IDS, type ServicesModel } from "@/lib/viz/croisee-masse";
import { capital } from "@/lib/viz/masse";
import { NdState, type Affichage } from "../components";
import { Limits, MasseBlocks, type SortProps } from "./ChFixeVariable";
import type { CroiseeContext } from "./context";

// Chapitre 05 · Services. Mêmes lignes et mêmes calculs que le tableau « Services » de l'écran Masse salariale (serviceRows) : coût par
// service N et N-1, écart, part, composantes, coût par personne-mois ; tri par l'adresse (en-têtes en liens, aria-sort ; par défaut
// le coût de la période décroissant) ; un clic sur un service filtre tout le rapport. Contribution des services à l'écart (barres
// signées) et répartition du coût (anneau, barres classées au-delà de huit parts), avec le tableau exact. Le modèle vient de
// servicesModel (calculé une fois par requête), comme les exports.
export default async function ChServices({ ctx }: { ctx: CroiseeContext }) {
  const model = await servicesModel(ctx);
  return <ServicesChapter model={model} slug={ctx.slug} affichage={ctx.affichage} tableauHref={ctx.href({ affichage: "tableau" })} sort={{ base: ctx.href(), tri: ctx.query.tri, sens: ctx.query.sens }} />;
}

// Rendu synchrone du modèle (testé tel quel). Le filtre Service ne restreint pas ce chapitre : tous les services sont montrés. Sans
// tri valide dans l'adresse, le tableau annonce son tri par défaut (aria-sort sur le coût de la période), celui de ses lignes.
export function ServicesChapter({ model, slug, affichage, tableauHref, sort }: { model: ServicesModel; slug: string; affichage: Affichage; tableauHref: string; sort?: SortProps }) {
  if (model.nd) return <NdState testid="cx-services-nd" reason={capital(model.nd.reason)} action={model.nd.action} />;
  const table = model.tables.find((t) => t.id === SERVICES_IDS.table);
  const shownSort = sort && table ? { base: sort.base, ...servicesSort(table, sort.tri, sort.sens) } : sort;
  return (
    <div className="cx-masse" data-testid="cx-services">
      {model.selected && (
        <MoneyText>
          <p className="tile-foot cx-masse-filter" data-testid="cx-services-filtre">
            Service retenu : <strong>{model.selected.label}</strong> — ce chapitre montre tous les services.{" "}
            <a href={model.selected.clearHref}>Retirer le filtre Service</a>
          </p>
        </MoneyText>
      )}
      <MasseBlocks chapter="services" model={model} slug={slug} affichage={affichage} tableauHref={tableauHref} sort={shownSort} />
      <Limits chapter="services" limits={model.limits} />
    </div>
  );
}
