// Aperçu décoratif des séries déjà calculées pour les graphiques et tableaux de la page.
// Un point absent/non fini interrompt la ligne ; les points isolés ne deviennent pas une tendance.
export function Sparkline({ values }: { values: readonly (number | null)[] }) {
  const known = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (known.length < 2) return null;
  const min = Math.min(...known);
  const max = Math.max(...known);
  const span = max - min;
  if (!Number.isFinite(span)) return null;

  const segments: string[][] = [];
  let segment: string[] = [];
  const finish = () => {
    if (segment.length > 1) segments.push(segment);
    segment = [];
  };
  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) {
      finish();
      return;
    }
    const x = 2 + index * 136 / (values.length - 1);
    const y = span === 0 ? 16 : 28 - (value - min) / span * 24;
    segment.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  });
  finish();
  if (segments.length === 0) return null;

  return (
    <svg className="tile-sparkline" viewBox="0 0 140 32" aria-hidden="true" focusable="false">
      {segments.map((points, index) => (
        <polyline key={index} points={points.join(" ")} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  );
}
