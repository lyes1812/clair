import { MoneyText } from "@/components/Money";
import { GlossaryLink } from "@/components/GlossaryLink";
import { trendClass } from "@/lib/trend";
import { cellView, defaultDir, sortHref, sortRows, sortState, tableNdReasons, type CroiseeColumn, type CroiseeRow, type CroiseeTable, type SortDir } from "@/lib/viz/croisee";
import { NdLines } from "../../components";
import { TBL } from "../../EcartParts";

// Tableau exact d'un chapitre, rendu depuis le modèle CroiseeTable (le même que celui des exports) : rôles de tableau explicites,
// en-tête et première colonne collants, ligne de total en pied. Un n.d. s'écrit « n.d. » (abréviation portant sa raison) et ses
// raisons sont listées sous le tableau ; une cellule vide est sans objet (« — »). Jamais un zéro à la place d'une valeur absente.
// Tri optionnel par l'adresse (tri=<tableau>.<colonne>, sens=asc|desc) : en-têtes en liens, aria-sort, sans script.
export function ModelTable({ table, slug, sortBase, tri = null, sens = null }: { table: CroiseeTable; slug: string; sortBase?: string; tri?: string | null; sens?: SortDir | null }) {
  const sort = sortBase ? sortState(table, tri, sens) : null;
  const rows = sort ? sortRows(table, sort.key, sort.dir) : table.rows;
  const reasons = tableNdReasons(table);
  const head = (c: CroiseeColumn) => {
    const numeric = c.kind !== "text" && c.kind !== "date";
    const current = sort?.key === c.key ? sort.dir : null;
    const sortable = Boolean(sortBase && c.sortable);
    const next: SortDir = current ? (current === "asc" ? "desc" : "asc") : defaultDir(c);
    return (
      <th key={c.key} scope="col" {...TBL.head} className={numeric ? "num" : undefined} aria-sort={sortable ? (current === "asc" ? "ascending" : current === "desc" ? "descending" : "none") : undefined}>
        {sortable ? (
          <a className="cx-sort" href={sortHref(sortBase!, table.id, c.key, next)} aria-label={`${c.header} : trier ${next === "asc" ? "par ordre croissant" : "par ordre décroissant"}`}>
            {c.header}
            {current && <span aria-hidden="true">{current === "asc" ? " ↑" : " ↓"}</span>}
          </a>
        ) : (
          c.header
        )}
        {c.term && <GlossaryLink slug={slug} term={c.term} label={c.header} />}
      </th>
    );
  };
  const line = (r: CroiseeRow, key: string, total = false) => (
    <tr key={key} {...TBL.row} className={total ? "total" : r.style}>
      {table.columns.map((c, i) => {
        const v = cellView(r.cells[i], c, r);
        const content = v.nd !== null ? <abbr className="nd" title={v.nd}>n.d.</abbr> : v.na ? <span className="cx-na" title="sans objet">—</span> : v.text;
        if (i === 0) {
          return (
            <th key={c.key} scope="row" {...TBL.rowhead} className={v.numeric ? "num" : undefined}>
              {r.href && v.nd === null && !v.na ? <a href={r.href}>{content}</a> : content}
            </th>
          );
        }
        const cls = [v.numeric ? "num" : "", trendClass(v.tone)].filter(Boolean).join(" ");
        return (
          <td key={c.key} {...TBL.cell} className={cls || undefined}>
            {content}
          </td>
        );
      })}
    </tr>
  );
  return (
    <MoneyText>
      <div className="cx-table-block" id={`cx-table-${table.id}`}>
        <div className="table-wrap scroll cx-table-wrap" role="region" aria-label={table.title} tabIndex={0} data-testid={`cx-table-${table.id}`}>
          <table className="data-table sticky sticky-first ms-table cx-table" {...TBL.table}>
            <caption className="ms-sr">{table.title}</caption>
            <thead {...TBL.group}>
              <tr {...TBL.row}>{table.columns.map(head)}</tr>
            </thead>
            <tbody {...TBL.group}>{rows.map((r, n) => line(r, `r${n}`))}</tbody>
            {table.foot && <tfoot {...TBL.group}>{line(table.foot, "foot", true)}</tfoot>}
          </table>
        </div>
        <NdLines lines={reasons} testid={`cx-table-${table.id}-nd`} />
        {(table.notes ?? []).map((n) => (
          <p key={n} className="tile-foot cx-table-note">{n}</p>
        ))}
      </div>
    </MoneyText>
  );
}
