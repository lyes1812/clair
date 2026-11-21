import { NextResponse, type NextRequest } from "next/server";

// Uniquement du transport de contexte, sans accès à la base ni décision d'accès.
export function middleware(request: NextRequest) {
  const forwarded = new Headers(request.headers);
  for (const key of [...forwarded.keys()]) if (key.toLowerCase().startsWith("x-clair-")) forwarded.delete(key);
  forwarded.set("x-clair-request-url", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  forwarded.set("x-clair-request-method", request.method);
  forwarded.delete("x-clair-company-query");
  if (request.nextUrl.searchParams.has("societe")) forwarded.set("x-clair-company-query", request.nextUrl.searchParams.get("societe") ?? "");
  return NextResponse.next({ request: { headers: forwarded } });
}

export const config = { matcher: ["/e/:path*"] };
