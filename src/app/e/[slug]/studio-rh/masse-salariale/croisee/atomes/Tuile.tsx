import { trendClass } from "@/lib/trend";
import { variationTone, type ChapterId, type TileSpec } from "@/lib/viz/croisee";
import { reasonView } from "@/lib/viz/synthese";
import { Tile } from "../../components";
import { Spark } from "./Spark";

// Carte d'un chapitre : libellé et « ? » du glossaire, valeur (ou « n.d. » et sa raison), lignes de variation, note, mini-courbe.
// Rendu par la tuile commune de la Masse salariale (Tile, classes ms-tile). Le rouge et le vert ne s'appliquent qu'à une carte de
// coût (TileSpec.cost) ; un effectif, un ETP ou un taux reste neutre, le signe écrit.
export function Tuile({ t, chapter, slug }: { t: TileSpec; chapter: ChapterId; slug: string }) {
  const id = `cx-tile-${chapter}-${t.id}`;
  const nd = t.value.kind === "nd";
  const why = nd && t.value.reason ? reasonView(t.value.reason) : null;
  const lead = t.sub || why ? (
    <>
      {t.sub && <span className="cx-tile-sub">{t.sub}</span>}
      {why && (
        <span className="cx-tile-nd" data-testid={`${id}-nd`} title={why.full ?? undefined}>
          {why.short}
        </span>
      )}
    </>
  ) : undefined;
  const variations = t.variations ?? [];
  const compare = variations.length ? (
    <>
      {variations.map((v, i) => {
        const tone = trendClass(variationTone(t, v));
        return (
          <span key={`${v.label}-${i}`} className="tile-foot cx-tile-var" data-testid={`${id}-var-${i}`}>
            {v.label} :{" "}
            {v.text === null ? (
              <abbr className="nd" title={v.reason ?? undefined}>n.d.</abbr>
            ) : (
              <span className={tone || undefined}>{v.text}</span>
            )}
          </span>
        );
      })}
    </>
  ) : undefined;
  const foot = t.note || t.spark ? (
    <>
      {t.note && <span className="tile-foot cx-tile-note">{t.note}</span>}
      {t.spark && <Spark values={t.spark.values} label={t.spark.label} />}
    </>
  ) : undefined;
  return (
    <Tile
      testid={id}
      label={t.label}
      def={t.term}
      slug={slug}
      value={t.value.kind === "lower" ? <span className="lower">{t.value.text}</span> : t.value.text}
      nd={nd}
      main={t.main && !nd}
      trend={t.cost && !nd ? trendClass(t.valueTone ?? "flat") || undefined : undefined}
      lead={lead}
      compare={compare}
      foot={foot}
    />
  );
}

// Rangée de cartes (liste de définitions) : six cartes sur six colonnes, puis trois, puis deux selon la largeur.
export function Tuiles({ tiles, chapter, slug, testid }: { tiles: TileSpec[]; chapter: ChapterId; slug: string; testid?: string }) {
  return (
    <dl className={`facts ms-tiles cx-tiles${tiles.length === 6 ? " six" : ""}`} data-testid={testid}>
      {tiles.map((t) => (
        <Tuile key={t.id} t={t} chapter={chapter} slug={slug} />
      ))}
    </dl>
  );
}
