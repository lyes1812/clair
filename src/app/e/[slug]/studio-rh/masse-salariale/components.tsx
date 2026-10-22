import { formatEuros } from "@/lib/money";
import type { MonthPayroll } from "@/lib/payroll/engine";
import { fmtFixed } from "@/lib/rh/kpi/format";

const MONTH_SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
export const monthShort = (m: string) => MONTH_SHORT[Number(m.slice(5, 7)) - 1];
export const eurosOf = (r: { num: number; den: number }) => `${fmtFixed({ num: r.num, den: r.den * 100 })} €`;

// Tendance mensuelle : barres N (masse chargée), repère N-1 ; un mois n.d. est une barre hachurée sans hauteur inventée.
export function TrendChart({ rows, previous }: { rows: MonthPayroll[]; previous: MonthPayroll[] }) {
  const values = [...rows, ...previous].filter((r) => r.kind === "value").map((r) => (r.kind === "value" ? r.masse : 0));
  const max = Math.max(1, ...values);
  const W = 64;
  const H = 180;
  const width = rows.length * W + 40;
  const y = (v: number) => H - Math.max(0, (v / max) * (H - 20));
  return (
    <svg viewBox={`0 0 ${width} ${H + 34}`} role="img" aria-label="Masse salariale chargée par mois, N et N-1" style={{ width: "100%", maxWidth: width, height: "auto" }} data-testid="ms-trend">
      <line x1="20" x2={width - 10} y1={H} y2={H} stroke="var(--line)" />
      {rows.map((r, i) => {
        const x = 30 + i * W;
        const p = previous[i];
        return (
          <g key={r.month}>
            {p?.kind === "value" && <rect x={x + 26} y={y(p.masse)} width="14" height={H - y(p.masse)} fill="#c9cfdb"><title>{`${p.month} : ${formatEuros(p.masse)}`}</title></rect>}
            {r.kind === "value" ? (
              <>
                <rect x={x} y={y(r.masse)} width="24" height={H - y(r.masse)} fill={r.open ? "var(--blue-soft)" : "var(--ink)"}><title>{`${r.month} : ${formatEuros(r.masse)}${r.open ? " (provisoire)" : ""}`}</title></rect>
                <text x={x + 12} y={y(r.masse) - 5} textAnchor="middle" fontSize="10" fill="var(--ink)">{fmtFixed({ num: r.masse, den: 100000 }, 1)}</text>
              </>
            ) : (
              <rect x={x} y={H - 24} width="24" height="24" fill="url(#ms-nd)"><title>{`${r.month} : n.d. — ${r.nd.reason}`}</title></rect>
            )}
            <text x={x + 20} y={H + 18} textAnchor="middle" fontSize="11" fill="var(--muted)">{monthShort(r.month)}</text>
          </g>
        );
      })}
      <defs>
        <pattern id="ms-nd" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="6" fill="#e7eaf0" /></pattern>
      </defs>
    </svg>
  );
}

// Composition du coût : part du brut et des cotisations dans la masse chargée.
export function Composition({ brut, cotisations }: { brut: number; cotisations: number }) {
  const total = brut + cotisations;
  if (total <= 0) return <p className="nd">n.d. — masse chargée nulle ou négative sur la période</p>;
  const pct = (v: number) => fmtFixed({ num: v * 100, den: total }, 1);
  return (
    <div data-testid="ms-composition" style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", height: 12, borderRadius: 6, overflow: "hidden", background: "var(--surface)" }}>
        <span style={{ width: `${(brut / total) * 100}%`, background: "var(--ink)" }} />
        <span style={{ width: `${(cotisations / total) * 100}%`, background: "var(--blue)" }} />
      </div>
      <span className="tile-foot">
        Brut {pct(brut)} % · {formatEuros(brut)} — Cotisations patronales {pct(cotisations)} % · {formatEuros(cotisations)}
      </span>
    </div>
  );
}
