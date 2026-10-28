import type { NextRequest } from "next/server";
import { contentDisposition, xlsxResponse } from "@/lib/export/response";
import { buildWorkbook } from "@/lib/export/xlsx";
import { loadRestructuringContext } from "@/lib/restructuring/context";
import { restructuringCsv, restructuringWorkbook } from "@/lib/restructuring/export";
import { requireWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireWorkspace(slug);
  const query = Object.fromEntries(request.nextUrl.searchParams);
  const format = query.format ?? "xlsx";
  const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
  if (format !== "xlsx" && format !== "csv") return new Response("Format disponible : Excel ou CSV.", { status: 400, headers });
  const ctx = { ...await loadRestructuringContext(slug, query), generatedAt: new Date().toISOString() };
  if (ctx.model.kind !== "value") return new Response(ctx.model.reason ?? "Choisis deux scénarios comparables.", { status: 422, headers });
  const name = `studio-restructuring-${ctx.reference!.firstMonth}-${ctx.reference!.lastMonth}`;
  if (format === "csv") return new Response(restructuringCsv(ctx), { headers: { ...headers, "content-type": "text/csv; charset=utf-8", "content-disposition": contentDisposition(name, "csv") } });
  return xlsxResponse(await buildWorkbook(restructuringWorkbook(ctx)), name);
}
