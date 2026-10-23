// Page d'une entrée du cahier dont le comportement n'est pas encore établi : on le dit, avec la raison, sans simuler.
export function Prevu({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel" data-testid="prevu">
      <h2>{title} <span className="tag">Prévu</span></h2>
      <div className="desc">{children}</div>
    </section>
  );
}
