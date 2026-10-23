"use client";
import { Menu, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

// Menu latéral : toujours déployé sur grand écran ; sous 860 px il se replie derrière un bouton « Menu » pour que la page
// commence par son contenu (et non par 570 px de navigation).
export function SidebarDrawer({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 860px)");
    const sync = () => setOpen(!mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return (
    <div className="side-drawer" data-open={open}>
      <button type="button" className="btn small drawer-btn" aria-expanded={open} aria-controls="side-drawer-body" onClick={() => setOpen((o) => !o)}>
        {open ? <X size={15} strokeWidth={1.75} aria-hidden="true" /> : <Menu size={15} strokeWidth={1.75} aria-hidden="true" />}
        Menu
      </button>
      <div id="side-drawer-body" className="drawer-body">{children}</div>
    </div>
  );
}
