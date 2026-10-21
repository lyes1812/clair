"use client";
import { Banknote, BriefcaseBusiness, ChevronDown, Database, FileText, Gauge, SlidersHorizontal, Users, type LucideIcon } from "lucide-react";
import { usePathname } from "next/navigation";
import { DATA_ITEM, STUDIO_RH_ITEMS } from "@/lib/nav";

const ICONS: Record<string, LucideIcon> = {
  donnees: Database,
  "studio-rh/collaborateurs": Users,
  "studio-rh/kpi": Gauge,
  "studio-rh/masse-salariale": Banknote,
  "studio-rh/hypotheses": SlidersHorizontal,
  "studio-rh/reporting-social": FileText,
};

export function WorkspaceNav({ slug }: { slug: string }) {
  const pathname = usePathname();
  const inStudio = pathname.startsWith(`/e/${slug}/studio-rh/`);
  const link = (path: string, label: string) => {
    const href = `/e/${slug}/${path}`;
    const Icon = ICONS[path];
    const active = pathname === href || pathname.startsWith(`${href}/`);
    return (
      <a href={href} aria-current={active ? "page" : undefined}>
        <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
        {label}
      </a>
    );
  };
  return (
    <nav className="nav" aria-label="Menu principal" data-testid="main-menu">
      <span className="label">Votre atelier</span>
      {link(DATA_ITEM.path, DATA_ITEM.label)}
      {/* Studio RH : groupe dépliable, ouvert par défaut ; ses cinq sous-modules en retrait. */}
      <details className="nav-group" open>
        <summary className={inStudio ? "in-group" : undefined}>
          <BriefcaseBusiness size={16} strokeWidth={1.75} aria-hidden="true" />
          <span>Studio RH</span>
          <ChevronDown className="chevron" size={14} strokeWidth={1.75} aria-hidden="true" />
        </summary>
        <div className="nav-sub">
          {STUDIO_RH_ITEMS.map((item) => (
            <span key={item.path} style={{ display: "contents" }}>{link(item.path, item.label)}</span>
          ))}
        </div>
      </details>
    </nav>
  );
}
