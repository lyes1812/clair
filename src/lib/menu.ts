import { TABS as COLLAB_TABS } from "@/app/e/[slug]/studio-rh/collaborateurs/tabs";
import { KPI_VUES } from "@/app/e/[slug]/studio-rh/kpi/tabs";
import { MS_PREVU } from "@/app/e/[slug]/studio-rh/masse-salariale/tabs";
import { VUES as HYP_VUES } from "@/app/e/[slug]/studio-rh/hypotheses/tabs";
import { STUDIO_RH_ITEMS } from "@/lib/nav";

// Menu général : les cinq familles du Studio RH avec toutes leurs entrées, construit à partir des listes d'onglets de chaque
// famille (une seule source par famille : l'onglet et l'entrée du menu ne peuvent pas diverger). Données sérialisables
// (le menu est un composant client).
export type MenuEntry = { label: string; href: string; soon?: boolean };
export type MenuFamily = { label: string; href: string; entries: MenuEntry[] };

export function menuFamilies(slug: string): MenuFamily[] {
  const root = (path: string) => `/e/${slug}/${path}`;
  const entries: Record<string, MenuEntry[]> = {
    "studio-rh/collaborateurs": COLLAB_TABS.map((t) => ({ label: t.label, href: `${root("studio-rh/collaborateurs")}${t.path}`, soon: "soon" in t ? t.soon : undefined })),
    "studio-rh/kpi": KPI_VUES.map((v) => ({ label: v.label, href: `${root("studio-rh/kpi")}?vue=${v.key}`, soon: "soon" in v ? v.soon : undefined })),
    "studio-rh/masse-salariale": [
      { label: "Synthèse", href: root("studio-rh/masse-salariale") },
      { label: "Fixe & variable", href: `${root("studio-rh/masse-salariale")}?vue=fixe-variable` },
      { label: "Paie & comptabilité", href: `${root("studio-rh/masse-salariale")}?vue=paie-compta` },
      ...MS_PREVU.map((t) => ({ label: t.label, href: `${root("studio-rh/masse-salariale")}${t.path}`, soon: t.soon })),
      { label: "Écart budgétaire", href: `${root("studio-rh/masse-salariale")}/ecart` },
      { label: "Analyse des écarts", href: `${root("studio-rh/masse-salariale")}/analyse` },
    ],
    "studio-rh/hypotheses": HYP_VUES.map((v) => ({ label: v.label, href: `${root("studio-rh/hypotheses")}?vue=${v.key}`, soon: "soon" in v ? v.soon : undefined })),
    "studio-rh/reporting-social": [
      { label: "Index égalité FH", href: `${root("studio-rh/reporting-social")}?vue=index`, soon: true },
      { label: "BDESE", href: `${root("studio-rh/reporting-social")}?vue=bdese`, soon: true },
    ],
  };
  return STUDIO_RH_ITEMS.map((i) => ({ label: i.label, href: root(i.path), entries: entries[i.path] ?? [] }));
}
