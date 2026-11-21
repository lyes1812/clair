// La société fait partie de l'adresse, pour qu'un formulaire d'un ancien onglet
// reste rattaché à son périmètre même si le cookie change dans un autre onglet.
export const companyManagerPath = (slug: string) => `/e/${slug}/studio-rh/hypotheses?vue=societes`;

export function isCompanyManager(url: URL, slug: string): boolean {
  return url.pathname === `/e/${slug}/studio-rh/hypotheses` && url.searchParams.get("vue") === "societes";
}

export function companyAddress(relative: string, companyId: string | null | undefined): string {
  if (!companyId) return relative;
  const url = new URL(relative, "https://clair.invalid");
  url.searchParams.set("societe", companyId);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function companyRouteDecision(input: {
  slug: string; relative: string; method: string; selectedId: string | null;
  companyCount: number; error: boolean; resourceId?: string | "ambiguous" | null;
}): string | null {
  const url = new URL(input.relative, "https://clair.invalid");
  const prefix = `/e/${input.slug}`;
  if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) return null;
  const manager = isCompanyManager(url, input.slug);
  const explicit = url.searchParams.has("societe");
  const get = input.method === "GET" || input.method === "HEAD";
  if (!explicit && get && input.resourceId && input.resourceId !== "ambiguous") return companyAddress(input.relative, input.resourceId);
  if (!manager && (!input.selectedId || input.error || (!explicit && input.resourceId === "ambiguous"))) return `${companyManagerPath(input.slug)}&selection=requise`;
  if (!manager && !get && input.companyCount > 1 && !explicit) return `${companyManagerPath(input.slug)}&selection=onglet`;
  if (get && !explicit && input.selectedId) return companyAddress(input.relative, input.selectedId);
  return null;
}
