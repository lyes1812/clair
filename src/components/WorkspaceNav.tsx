"use client";
import { usePathname } from "next/navigation";
import { DATA_ITEM, STUDIO_RH_ITEMS } from "@/lib/nav";

export function WorkspaceNav({ slug }: { slug: string }) {
  const pathname = usePathname();
  const link = (path: string, label: string) => {
    const href = `/e/${slug}/${path}`;
    return (
      <a href={href} aria-current={pathname === href ? "page" : undefined}>
        {label}
      </a>
    );
  };
  return (
    <nav className="nav" aria-label="Menu principal" data-testid="main-menu">
      {link(DATA_ITEM.path, DATA_ITEM.label)}
      <span className="label">Studio RH</span>
      {STUDIO_RH_ITEMS.map((item) => (
        <span key={item.path} style={{ display: "contents" }}>{link(item.path, item.label)}</span>
      ))}
    </nav>
  );
}
