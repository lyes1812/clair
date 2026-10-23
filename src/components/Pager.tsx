// Pagination d'un tableau long : « 21–40 sur 562 », précédente / suivante ; la page courante est portée par l'adresse.
export function Pager({ page, pageSize, total, href, testid }: { page: number; pageSize: number; total: number; href: (page: number) => string; testid: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, page), pages);
  const from = total === 0 ? 0 : (p - 1) * pageSize + 1;
  const to = Math.min(total, p * pageSize);
  return (
    <nav className="pager" aria-label="Pagination" data-testid={testid}>
      <span className="pager-range" data-col="range">{from}–{to} sur {total}</span>
      {p > 1 ? <a className="btn small" href={href(p - 1)} rel="prev">Précédente</a> : <span className="btn small" aria-disabled="true">Précédente</span>}
      <span className="pager-page">Page {p} / {pages}</span>
      {p < pages ? <a className="btn small" href={href(p + 1)} rel="next">Suivante</a> : <span className="btn small" aria-disabled="true">Suivante</span>}
    </nav>
  );
}
