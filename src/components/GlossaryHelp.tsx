"use client";
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** Le lien garde sa destination sans JavaScript ; la définition s’ouvre sur place dans l’application. */
export function GlossaryHelp({ href, term, definition, formula }: { href: string; term: string; definition: string; formula?: string }) {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const link = useRef<HTMLAnchorElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = () => { setPosition(null); link.current?.focus(); };
  useEffect(() => {
    if (!position) return;
    panel.current?.focus();
    const away = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node) && !link.current?.contains(event.target as Node)) setPosition(null); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setPosition(null); link.current?.focus(); } };
    const moved = () => setPosition(null);
    document.addEventListener('pointerdown', away); document.addEventListener('keydown', key);
    window.addEventListener('resize', moved);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key); window.removeEventListener('resize', moved); };
  }, [position]);
  return <>
    <a ref={link} className="gloss-link" href={href} aria-label={`Définition : ${term}`} title={`Définition : ${term}`} aria-haspopup="dialog" aria-expanded={position !== null} aria-controls={position ? id : undefined} onClick={event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      setPosition(position ? null : { left: Math.max(12, Math.min(rect.left, window.innerWidth - Math.min(380, window.innerWidth - 24) - 12)), top: Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - 310)) });
    }}>?</a>
    {position && createPortal(<div ref={panel} id={id} className="gloss-popover" role="dialog" aria-label={`Définition : ${term}`} tabIndex={-1} style={position}>
      <div className="gloss-popover-head"><strong>{term}</strong><button type="button" className="btn small" aria-label="Fermer la définition" onClick={close}>×</button></div>
      {definition.split('\n\n').map((paragraph, index) => <p key={index}>{paragraph}</p>)}
      {formula && <p className="gloss-popover-formula">{formula}</p>}
      <a href={href}>Ouvrir la définition complète →</a>
    </div>, document.body)}
  </>;
}
