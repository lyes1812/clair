import { Sparkline } from "@/components/Sparkline";
import { sparkDrawable } from "@/lib/viz/croisee";

// Mini-courbe d'une carte : un simple appel à Sparkline (composant partagé), nommée pour les lecteurs d'écran. Une valeur null
// (n.d.) coupe la ligne ; rien n'est tracé avec moins de deux valeurs connues. Aucune fonction en props.
export function Spark({ values, label }: { values: readonly (number | null)[]; label: string }) {
  if (!sparkDrawable(values)) return null;
  return (
    <span className="cx-spark" role="img" aria-label={label}>
      <Sparkline values={values} />
    </span>
  );
}
