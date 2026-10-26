import type { NextRequest } from "next/server";
import { chapterExport, croiseeExport } from "@/lib/croisee/export";
import { contentDisposition, xlsxResponse } from "@/lib/export/response";
import { buildWorkbook } from "@/lib/export/xlsx";
import { requireWorkspace } from "@/lib/workspace";
import { loadCroiseeContext } from "../context";

export const dynamic = "force-dynamic";

// Exports de la Masse salariale croisée : Excel du chapitre (?format=xlsx, par défaut sans tableau) ou CSV d'un tableau
// (?format=csv&tableau=<identifiant>). Mêmes paramètres d'adresse que la page (chapitre, année, mois, service, budget, scénario, tri)
// et même modèle que l'écran. Aucune donnée nominative (la page croisée n'en montre pas) : ouvert à tous les rôles de l'espace.
// Chapitre inconnu ou « Prévu » : 404 avec la raison ; chapitre non calculable : 422 avec la raison.
type Search = Record<string, string | string[]>;
const text = (body: string, status: number) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
// Première valeur d'un paramètre répété, comme la page (parseQuery) : l'écran et le fichier lisent la même période.
const one = (v: string | string[] | undefined) => ((Array.isArray(v) ? v[0] : v) ?? "").trim();

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { workspace } = await requireWorkspace(slug);
  const sp: Search = {};
  for (const k of new Set(req.nextUrl.searchParams.keys())) {
    const all = req.nextUrl.searchParams.getAll(k);
    sp[k] = all.length > 1 ? all : all[0];
  }
  const tableau = one(sp.tableau);
  const format = one(sp.format) || (tableau ? "csv" : "xlsx");
  if (format !== "xlsx" && format !== "csv") return text("Format inconnu : xlsx ou csv.", 400);
  if (format === "csv" && !tableau) return text("Tableau à préciser : tableau=<identifiant>.", 400);
  const found = chapterExport(one(sp.chapitre));
  if (found.kind !== "ok") return text(found.reason, 404);

  const ctx = await loadCroiseeContext(slug, workspace, sp);
  const out = await croiseeExport(ctx, found.entry, { format, tableau, generatedAt: new Date().toISOString() });
  if (out.kind === "refused") return text(out.reason, out.status);
  if (out.kind === "csv") {
    return new Response(out.body, {
      status: 200,
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": contentDisposition(out.file, "csv"), "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  }
  if (out.unknownTerms.length) console.warn(`export de la masse salariale croisée : identifiants de glossaire inconnus (${out.unknownTerms.join(", ")})`);
  return xlsxResponse(await buildWorkbook(out.spec), out.file);
}
