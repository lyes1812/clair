import type { NextRequest } from "next/server";
import { xlsxResponse } from "@/lib/export/response";
import { buildWorkbook } from "@/lib/export/xlsx";
import { loadCashContext } from "@/lib/restructuring/crisis/cash-context";
import { crisisWorkbook } from "@/lib/restructuring/crisis/export";
import { requireWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";
// Cap 13 : classeur du dossier de crise. Il nomme les créanciers : réservé aux éditeurs et administrateurs de l'espace.
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireWorkspace(slug, "editor");
  const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
  const query = Object.fromEntries(request.nextUrl.searchParams);
  const ctx = await loadCashContext(slug, query);
  const workbook = crisisWorkbook({ ...ctx, generatedAt: new Date().toISOString() });
  if (!workbook) return new Response("Rien à exporter : aucun FEC appliqué et aucun solde de départ saisi.", { status: 422, headers });
  const day = ctx.plan.kind === "value" ? ctx.plan.start.date : ctx.asOf ?? "";
  return xlsxResponse(await buildWorkbook(workbook), `cap13-dossier-de-crise-${day}`);
}
