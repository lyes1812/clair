"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { PrintAction } from "../reporting-social/PrintAction";

const Draft = createContext({ dirty: false, change: () => {} });

// Le document et ses données restent rendus côté serveur. Le client ne reçoit
// ici que ses enfants déjà rendus et un état local « composition modifiée ».
export function PublisherDraftProvider({ children }: { children: ReactNode }) {
  const [dirty, setDirty] = useState(false);
  return <Draft.Provider value={{ dirty, change: () => setDirty(true) }}>{children}</Draft.Provider>;
}

export function PublisherDraftObserver({ children }: { children: ReactNode }) {
  const draft = useContext(Draft);
  return <div className="publisher-compose-observer rs-screen-only" onChange={draft.change}>{children}</div>;
}

export function PublisherPrintAction() {
  const { dirty } = useContext(Draft);
  return <div className="publisher-print-action rs-screen-only">
    <PrintAction disabled={dirty} describedBy={dirty ? "publisher-draft-status" : undefined} />
    {dirty && <p className="desc" role="status" id="publisher-draft-status" data-testid="publisher-draft-status">Prévisualise les modifications avant d’imprimer.</p>}
  </div>;
}
