"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Les liens profonds existants révèlent leur contenu, même quand celui-ci est replié. */
export function SyntheseDisclosure({ children, summary, initiallyOpen = false, className = "", id, testid }: {
  children: ReactNode;
  summary: ReactNode;
  initiallyOpen?: boolean;
  className?: string;
  id?: string;
  testid: string;
}) {
  const ref = useRef<HTMLDetailsElement | null>(null);
  useEffect(() => {
    const reveal = () => {
      if (!location.hash) return;
      let target: HTMLElement | null;
      try { target = document.getElementById(decodeURIComponent(location.hash.slice(1))); }
      catch { return; }
      if (!target || !ref.current?.contains(target)) return;
      ref.current.open = true;
      requestAnimationFrame(() => target?.scrollIntoView({ block: "start" }));
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, [children]);
  return <details ref={ref} id={id} open={initiallyOpen} className={`ms-read-details ms-synthese-detail ${className}`.trim()} data-testid={testid} data-ms-print-details>
    <summary>{summary}</summary>
    <div className="ms-synthese-detail-body">{children}</div>
  </details>;
}
