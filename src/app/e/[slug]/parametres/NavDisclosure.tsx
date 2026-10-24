"use client";
import { useEffect, useRef, type ReactNode } from "react";

// « Sur cette page » : toujours déployé à partir de 961 px (volet de gauche), replié sous 960 px derrière son titre.
// Rendu serveur fermé : sur téléphone, rien ne s'ouvre puis se referme ; le CSS (donnees.css) montre le contenu sur grand écran
// avant même l'hydratation, et ce composant aligne l'attribut « open » sur la largeur pour les navigateurs sans ::details-content.
export function NavDisclosure({ title, children }: { title: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 961px)");
    const sync = () => {
      if (ref.current) ref.current.open = wide.matches;
      // Sur grand écran le volet reste déployé : le titre n'est plus une commande, il sort de l'ordre de tabulation.
      if (summaryRef.current) {
        if (wide.matches) summaryRef.current.tabIndex = -1;
        else summaryRef.current.removeAttribute("tabindex");
      }
    };
    sync();
    wide.addEventListener("change", sync);
    return () => wide.removeEventListener("change", sync);
  }, []);
  return (
    <details ref={ref} className="pm-disclosure">
      <summary ref={summaryRef}><span className="label">{title}</span></summary>
      {children}
    </details>
  );
}
