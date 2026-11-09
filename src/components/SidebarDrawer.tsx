"use client";
import { Menu, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

// Menu latéral : toujours déployé sur grand écran ; sous 860 px il se replie derrière un bouton « Menu » pour que la page
// commence par son contenu (et non par 570 px de navigation).
export function SidebarDrawer({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 860px)");
    const sync = () => setOpen(!mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && drawerRef.current?.contains(document.activeElement) && window.matchMedia("(max-width: 860px)").matches) {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);
  return (
    <div ref={drawerRef} className="side-drawer" data-open={open}>
      <button ref={toggleRef} type="button" className="btn small drawer-btn" aria-expanded={open} aria-controls="side-drawer-body" onClick={() => setOpen((o) => !o)}>
        {open ? <X size={15} strokeWidth={1.75} aria-hidden="true" /> : <Menu size={15} strokeWidth={1.75} aria-hidden="true" />}
        Menu
      </button>
      <div id="side-drawer-body" className="drawer-body">{children}</div>
    </div>
  );
}
