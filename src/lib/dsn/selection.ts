// Sélection des déclarations qui font foi, par établissement (SIRET), mois et nature, parmi tous les fichiers appliqués.
// Règles reprises de Codex : numéro d'ordre le plus élevé, « annule et remplace » (03) seulement après une normale (01),
// fractions complètes et cohérentes ; tout conflit est signalé, jamais tranché en silence.
export type SelectableDeclaration = {
  key: string; siret: string | null; month: string | null; nature: string | null; type: string | null;
  fraction: string | null; order: string | null; eligible: boolean; blocking: string[];
  sourceId: string; contentHash: string;
};

export type CoverageRow = {
  siret: string;
  month: string;
  status: "complete" | "incomplete" | "blocked";
  selected: SelectableDeclaration[];
  excluded: { declaration: SelectableDeclaration; reason: string }[];
  messages: string[];
};

export function selectDeclarations(all: SelectableDeclaration[]): CoverageRow[] {
  const rows = new Map<string, CoverageRow>();
  const row = (siret: string, month: string) => {
    const k = `${siret}|${month}`;
    let r = rows.get(k);
    if (!r) { r = { siret, month, status: "complete", selected: [], excluded: [], messages: [] }; rows.set(k, r); }
    return r;
  };

  const groups = new Map<string, SelectableDeclaration[]>();
  for (const d of all) {
    if (!d.siret || !d.month) continue;
    if (!d.eligible) { row(d.siret, d.month).excluded.push({ declaration: d, reason: d.blocking[0] ?? "déclaration non éligible" }); continue; }
    const g = `${d.siret}|${d.month}|${d.nature}|${d.fraction}`;
    const list = groups.get(g) ?? [];
    // Copies identiques (même contenu) : une seule est retenue.
    if (!list.some((x) => x.key === d.key && x.contentHash === d.contentHash)) list.push(d);
    groups.set(g, list);
  }

  for (const list of groups.values()) {
    const r = row(list[0].siret!, list[0].month!);
    const sorted = [...list].sort((a, b) => {
      const diff = BigInt(b.order!) - BigInt(a.order!);
      return diff > 0n ? 1 : diff < 0n ? -1 : a.sourceId.localeCompare(b.sourceId);
    });
    const latest = sorted[0];
    if (sorted.length > 1 && BigInt(sorted[1].order!) === BigInt(latest.order!)) {
      r.messages.push(`Fraction ${latest.fraction} : deux déclarations différentes portent le même numéro d'ordre ${latest.order}.`);
      for (const d of sorted) r.excluded.push({ declaration: d, reason: "numéro d'ordre en conflit" });
      r.status = "blocked";
      continue;
    }
    const normals = sorted.filter((d) => d.type === "01");
    if (normals.length > 1) r.messages.push(`Fraction ${latest.fraction} : plusieurs déclarations normales (01) ; la plus récente par numéro d'ordre est retenue.`);
    if (latest.type === "03" && normals.length === 0) {
      r.messages.push(`Fraction ${latest.fraction} : annule et remplace sans déclaration normale ; chaîne incomplète.`);
      r.status = "incomplete";
    }
    if (latest.type === "01" && sorted.some((d) => d.type === "03")) {
      r.messages.push(`Fraction ${latest.fraction} : déclaration normale postérieure à un annule et remplace ; à vérifier.`);
      r.status = "blocked";
    }
    r.selected.push(latest);
    for (const d of sorted.slice(1)) r.excluded.push({ declaration: d, reason: d.type === "01" && latest.type === "03" ? "remplacée (annule et remplace)" : "numéro d'ordre inférieur" });
  }

  for (const r of rows.values()) {
    if (r.selected.length === 0 && r.status === "complete") { r.status = "blocked"; r.messages.push("Aucune déclaration éligible."); continue; }
    const totals = new Set(r.selected.map((d) => d.fraction![1]));
    if (totals.size > 1) {
      r.messages.push("Fractions incohérentes (totaux différents) : aucune déclaration retenue.");
      for (const d of r.selected) r.excluded.push({ declaration: d, reason: "fractions incohérentes" });
      r.selected = [];
      r.status = "blocked";
      continue;
    }
    const total = Number([...totals][0]);
    const ranks = new Set(r.selected.map((d) => Number(d.fraction![0])));
    const missing = Array.from({ length: total }, (_, i) => i + 1).filter((k) => !ranks.has(k));
    if (missing.length) {
      r.messages.push(`Fractions incomplètes : manque ${missing.map((k) => `${k}/${total}`).join(", ")}.`);
      if (r.status === "complete") r.status = "incomplete";
    }
  }
  return [...rows.values()].sort((a, b) => (a.month === b.month ? a.siret.localeCompare(b.siret) : a.month.localeCompare(b.month)));
}
