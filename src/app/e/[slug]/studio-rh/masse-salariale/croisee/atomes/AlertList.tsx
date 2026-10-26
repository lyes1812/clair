import { MoneyText } from "@/components/Money";
import { GlossaryLink } from "@/components/GlossaryLink";
import { CROISEE_TERMS } from "@/lib/glossary/croisee";
import { ALERT_LEVEL_LABELS, sortAlerts, type AlertSpec } from "@/lib/viz/croisee";

// « À surveiller » : alertes classées par niveau (défavorable, à compléter, repère), chacune avec son niveau écrit en toutes
// lettres et une pastille de forme propre (disque bleu, anneau bleu, carré gris). Jamais de rouge, de vert ni d'ambre : le niveau
// d'une alerte n'est pas une tendance de coût. Aucun plafond : toutes les alertes calculées sont listées.
export function AlertList({ alerts, slug, title = "À surveiller", empty = "Aucun point à surveiller sur ce périmètre.", id = "cx-alerts" }: { alerts: AlertSpec[]; slug: string; title?: string; empty?: string; id?: string }) {
  const list = sortAlerts(alerts);
  return (
    <MoneyText>
      <section className="cx-alerts" data-testid="cx-alerts" aria-labelledby={`${id}-titre`}>
        <h3 id={`${id}-titre`} className="cx-alerts-title">
          {title}
          <GlossaryLink slug={slug} term={CROISEE_TERMS.alertes} label="Points à surveiller" />
        </h3>
        {list.length === 0 ? (
          <p className="tile-foot cx-alerts-empty" data-testid="cx-alerts-empty">{empty}</p>
        ) : (
          <ul className="cx-alert-list">
            {list.map((a) => (
              <li key={a.id} className={`cx-alert cx-alert-${a.level}`} data-testid={`cx-alert-${a.id}`} data-level={a.level}>
                <span className="cx-pastille" aria-hidden="true" />
                <span className="cx-alert-level">{ALERT_LEVEL_LABELS[a.level]}</span>
                <span className="cx-alert-body">
                  <strong className="cx-alert-label">{a.label}</strong> <span className="cx-alert-text">{a.text}</span>
                  {a.href && (
                    <>
                      {" "}
                      <a href={a.href}>{a.linkLabel ?? "Voir"}</a>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </MoneyText>
  );
}
