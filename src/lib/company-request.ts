import { cookies, headers } from "next/headers";

export const COMPANY_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const companyCookieName = (workspaceId: string) => `clair-company-${workspaceId}`;

export type CompanyRequest = {
  requestedId: string | null;
  url: string | null;
  method: string | null;
  source: "query" | "referer" | "cookie" | null;
};

// Les en-têtes sont recréés par le middleware depuis l'adresse demandée. Ils ne
// constituent jamais une autorisation : l'identifiant est ensuite vérifié en base.
export async function readCompanyRequest(workspaceId: string): Promise<CompanyRequest> {
  let url: string | null = null;
  let method: string | null = null;
  try {
    const requestHeaders = await headers();
    url = requestHeaders.get("x-clair-request-url");
    method = requestHeaders.get("x-clair-request-method");
    if (requestHeaders.has("x-clair-company-query")) return {
      requestedId: requestHeaders.get("x-clair-company-query") ?? "", url, method, source: "query",
    };
    // Les liens et formulaires GET existants n'emportent pas tous la query.
    // Une adresse canonique de la même page d'espace maintient alors le choix
    // de l'onglet courant, indépendamment d'un autre onglet ayant changé le cookie.
    const workspacePath = url?.match(/^\/e\/([^/?#]+)(?:\/|\?|$)/)?.[1];
    const referer = requestHeaders.get("referer");
    if (workspacePath && referer) {
      try {
        const previous = new URL(referer);
        const previousWorkspace = previous.pathname.match(/^\/e\/([^/]+)(?:\/|$)/)?.[1];
        if (previousWorkspace === workspacePath && previous.searchParams.has("societe")) return {
          requestedId: previous.searchParams.get("societe") ?? "", url, method, source: "referer",
        };
      } catch { /* Un referer non interprétable n'est jamais repris. */ }
    }
  } catch { /* Les traitements de fond n'ont pas de requête Next.js. */ }
  try {
    const cookie = (await cookies()).get(companyCookieName(workspaceId));
    if (cookie) return { requestedId: cookie.value, url, method, source: "cookie" };
  } catch { /* Le périmètre explicite du traitement de fond reste prioritaire. */ }
  return { requestedId: null, url, method, source: null };
}
