import { TopBar } from "@/components/TopBar";
import { requireUser, safeReturnPath } from "@/lib/session";
import { TotpSetup } from "./TotpSetup";

export default async function SecuritePage({ searchParams }: { searchParams: Promise<{ retour?: string }> }) {
  const { retour } = await searchParams;
  const session = await requireUser("/securite");
  const returnTo = safeReturnPath(retour);
  const enabled = Boolean(session.user.twoFactorEnabled);
  return (
    <>
      <TopBar email={session.user.email} />
      <main className="page">
        <div style={{ display: "grid", gap: 8 }}>
          <span className="label">Compte</span>
          <h1>Sécurité</h1>
        </div>
        <section className="panel">
          <h2>Double authentification (TOTP)</h2>
          {enabled ? (
            <>
              <p data-testid="totp-status">Activée. Un code vous sera demandé à chaque connexion.</p>
              {retour && (
                <p>
                  <a className="btn primary" href={returnTo}>Continuer</a>
                </p>
              )}
            </>
          ) : (
            <>
              {retour && (
                <p className="notice">
                  Vous administrez un espace : la double authentification est obligatoire avant d'y accéder.
                </p>
              )}
              <TotpSetup returnTo={returnTo} />
            </>
          )}
        </section>
      </main>
    </>
  );
}
