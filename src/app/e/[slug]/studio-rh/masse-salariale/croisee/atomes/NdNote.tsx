// Mention « n.d. » d'une ligne : ce qui manque, la raison écrite (jamais seulement au survol) et, s'il y a lieu, l'action qui y
// remédie (Données, Paramètres).
export function NdNote({ reason, label, action, testid }: { reason: string; label?: string; action?: { href: string; label: string }; testid?: string }) {
  return (
    <p className="tile-foot cx-nd" data-testid={testid}>
      <strong className="nd">n.d.</strong>
      {label && <span className="cx-nd-label"> {label}</span>}
      <span> — {reason}</span>
      {action && (
        <>
          {" "}
          <a href={action.href}>
            {action.label}
            <span aria-hidden="true"> →</span>
          </a>
        </>
      )}
    </p>
  );
}
