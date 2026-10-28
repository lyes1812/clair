import type { NextRequest } from "next/server";
import { loadFinanceContext } from "@/lib/finance/context";
import { financeCsv, financeWorkbook } from "@/lib/finance/export";
import { contentDisposition, xlsxResponse } from "@/lib/export/response";
import { buildWorkbook } from "@/lib/export/xlsx";
import { requireWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireWorkspace(slug);
  const query = Object.fromEntries(req.nextUrl.searchParams);
  const format = query.format ?? "xlsx";
  if (format !== "xlsx" && format !== "csv") return new Response("Format disponible : Excel ou CSV.", { status: 400, headers: { "cache-control": "no-store" } });
  const context = { ...await loadFinanceContext(slug, query), generatedAt: new Date().toISOString() };
  const name = `studio-finance-${context.year}-${context.from}-${context.to}`;
  if (format === "csv") return new Response(financeCsv(context), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": contentDisposition(name, "csv"), "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
  return xlsxResponse(await buildWorkbook(financeWorkbook(context)), name);
}
