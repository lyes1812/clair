import type { ReactNode } from "react";
import "@/styles/ms-page-actions.css";
import "@/styles/rh-studio.css";
import "@/styles/rh-people.css";
import "@/styles/rh-hypotheses.css";
import "@/styles/rh-payroll-reporting.css";

export default function StudioRhLayout({ children }: { children: ReactNode }) {
  return <div className="rh-studio" data-testid="rh-studio">{children}</div>;
}
