import type { ReactNode } from "react";

// Mise en page « paramètres à gauche, résultat à droite » des écrans d'analyse (J'analyse mes… / Par… / Répartis par…).
// Sous 960 px, le panneau passe au-dessus du résultat.
export function ParamLayout({ aside, children, testid }: { aside: ReactNode; children: ReactNode; testid?: string }) {
  return (
    <div className="param-layout" data-testid={testid}>
      <aside className="param-panel">{aside}</aside>
      <div className="param-main">{children}</div>
    </div>
  );
}

export function ParamSection({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <fieldset className="param-section">
      <legend>{icon}{title}</legend>
      {children}
    </fieldset>
  );
}
