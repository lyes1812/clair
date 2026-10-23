import type { NextRequest } from "next/server";
import type { Agg, Diff } from "@/lib/budget/versions";
import { HORS_SALARIE, zoomOf, ZOOM_RUBRICS, type ZoomRubric } from "@/lib/budget/zoom";
import { hasAtLeast } from "@/lib/roles";
import { requireWorkspace } from "@/lib/workspace";
import { loadVersions } from "../../ecart-data";
import { ecartRows } from "../../ecart-rows";
import { peopleIndex } from "../../people-index";

export const dynamic = "force-dynamic";

// Export CSV de l'écart budgétaire : le tableau affiché (agrégats), ou le détail par salarié d'une rubrique (nominatif :
// administrateurs et éditeurs seulement, comme à l'écran). Mêmes versions, période et filtres que la page.
const BOM = "﻿";
const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
function decimal(num: number, den: number, decimals: number): string {
  const n = BigInt(num);
  const d = BigInt(den);
  const scale = 10n ** BigInt(decimals);
  const neg = n < 0n;
  const a = neg ? -n : n;
  const v = (a * scale * 2n + d) / (d * 2n); // arrondi au plus proche, demi vers le haut
  const int = v / scale;
  const frac = (v % scale).toString().padStart(decimals, "0");
  return `${neg ? "-" : ""}${int}${decimals ? `,${frac}` : ""}`;
}
const cell = (a: Agg, unit: "eur" | "etp" | "nombre") => (a.kind === "nd" ? `n.d. (${a.reason})` : a.kind === "na" ? "" : unit === "eur" ? decimal(a.num, 100, 2) : unit === "etp" ? decimal(a.num, a.den, 2) : String(a.num));
const gapCell = (d: Diff, unit: "eur" | "etp" | "nombre") => (d.kind === "nd" ? `n.d. (${d.reason})` : d.kind === "na" ? "" : unit === "eur" ? decimal(d.num, 100, 2) : unit === "etp" ? decimal(d.num, d.den, 2) : String(d.num));
const pctCell = (d: Diff) => (d.kind !== "value" ? "" : d.pct ? decimal(d.pct.num * 100, d.pct.den, 2) : "n.d. (valeur de départ nulle)");

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { workspace } = await requireWorkspace(slug);
  const sp = Object.fromEntries(req.nextUrl.searchParams);
  const loaded = await loadVersions(slug, workspace.id, sp, 3);
  const headers = { "content-type": "text/csv; charset=utf-8", "cache-control": "no-store" };
  const [zr, zp] = (sp.zoom ?? "").split(":");
  if (zr) {
    if (!hasAtLeast(workspace.role, "editor")) return new Response("Détail nominatif réservé aux administrateurs et aux éditeurs.", { status: 403 });
    const rubric = zr as ZoomRubric;
    const pair = zp === "2" ? 1 : 0;
    const a = loaded.versions[pair];
    const b = loaded.versions[pair + 1];
    if (!(rubric in ZOOM_RUBRICS) || !a || !b) return new Response("Détail introuvable.", { status: 404 });
    const za = zoomOf(loaded.sources[pair], loaded.months(a.year), rubric);
    const zb = zoomOf(loaded.sources[pair + 1], loaded.months(b.year), rubric);
    if (za.kind === "nd" || zb.kind === "nd") return new Response(`n.d. — ${za.kind === "nd" ? za.reason : (zb as { reason: string }).reason}`, { status: 422 });
    const people = peopleIndex(loaded);
    const keys = [...new Set([...za.byKey.keys(), ...zb.byKey.keys()])];
    const lines = [["Écart (€)", a.label, b.label, "Matricule", "Nom", "Service", "Contrat", "Date d'embauche", "Date de sortie"].map(q).join(";")];
    for (const k of keys.map((x) => ({ k: x, i: x === HORS_SALARIE ? { label: "Hors salarié", externalId: null, service: null, contract: null, start: null, end: null } : (people.get(x) ?? { label: x, externalId: x, service: null, contract: null, start: null, end: null }) })).sort((x, y) => x.i.label.localeCompare(y.i.label))) {
      const av = za.byKey.get(k.k) ?? null;
      const bv = zb.byKey.get(k.k) ?? null;
      lines.push([decimal((bv ?? 0) - (av ?? 0), 100, 2), av === null ? "" : decimal(av, 100, 2), bv === null ? "" : decimal(bv, 100, 2), k.i.externalId ?? "", k.i.label, k.i.service ?? "", k.i.contract ?? "", k.i.start ?? "", k.i.end ?? ""].map((x) => q(String(x))).join(";"));
    }
    return new Response(BOM + lines.join("\n") + "\n", { headers: { ...headers, "content-disposition": `attachment; filename="ecart-detail-${rubric}.csv"` } });
  }
  const rows = ecartRows(loaded, sp.vue === "detail" ? "detail" : "synthese");
  const head = ["Rubrique", ...loaded.versions.flatMap((v, i) => (i === 0 ? [v.label] : [v.label, `Écart ${i + 1}−${i}`, `Écart ${i + 1}−${i} %`]))];
  const lines = [head.map(q).join(";")];
  for (const r of rows) lines.push([r.label, ...r.aggs.flatMap((a, i) => (i === 0 ? [cell(a, r.unit)] : [cell(a, r.unit), gapCell(r.gaps[i - 1], r.unit), pctCell(r.gaps[i - 1])]))].map((x) => q(String(x))).join(";"));
  return new Response(BOM + lines.join("\n") + "\n", { headers: { ...headers, "content-disposition": 'attachment; filename="ecart-budgetaire.csv"' } });
}
