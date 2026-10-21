"use client";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

type Pending = { secret: string; qrSvg: string; backupCodes: string[] };

export function TotpSetup({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending | null>(null);
  const [done, setDone] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get("password"));
    setBusy(true);
    setError(null);
    const { data, error } = await authClient.twoFactor.enable({ password });
    setBusy(false);
    if (error || !data) {
      setError("Mot de passe incorrect.");
      return;
    }
    const secret = new URL(data.totpURI).searchParams.get("secret") ?? "";
    const qrSvg = await QRCode.toString(data.totpURI, { type: "svg", margin: 1, width: 180 });
    setPending({ secret, qrSvg, backupCodes: data.backupCodes });
  }

  async function confirm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get("code")).trim();
    setBusy(true);
    setError(null);
    const { error } = await authClient.twoFactor.verifyTotp({ code });
    setBusy(false);
    if (error) {
      setError("Code invalide. Vérifiez l'heure de votre téléphone et réessayez.");
      return;
    }
    setDone(pending?.backupCodes ?? []);
  }

  if (done) {
    return (
      <div className="form">
        <p className="notice" data-testid="totp-enabled">Double authentification activée.</p>
        <div className="field-row">
          <span className="label">Codes de secours, à conserver hors ligne (affichés une seule fois)</span>
          <p className="code">{done.join("  ")}</p>
        </div>
        <p>
          <button className="btn primary" type="button" onClick={() => { router.push(returnTo); router.refresh(); }}>
            Continuer
          </button>
        </p>
      </div>
    );
  }

  if (pending) {
    return (
      <form className="form" onSubmit={confirm}>
        {error && <p className="error" role="alert">{error}</p>}
        <p className="desc">Scannez ce QR code avec votre application d'authentification, ou saisissez la clé manuellement.</p>
        <div aria-label="QR code TOTP" dangerouslySetInnerHTML={{ __html: pending.qrSvg }} style={{ width: 180 }} />
        <div className="field-row">
          <span className="label">Clé</span>
          <p className="code" data-testid="totp-secret">{pending.secret}</p>
        </div>
        <div className="field-row">
          <label htmlFor="code">Code à 6 chiffres</label>
          <input className="input" id="code" name="code" inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" required />
        </div>
        <button className="btn primary" type="submit" disabled={busy}>Activer</button>
      </form>
    );
  }

  return (
    <form className="form" onSubmit={start}>
      {error && <p className="error" role="alert">{error}</p>}
      <p className="desc">Confirmez votre mot de passe pour configurer une application d'authentification.</p>
      <div className="field-row">
        <label htmlFor="password">Mot de passe</label>
        <input className="input" id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <button className="btn primary" type="submit" disabled={busy}>Configurer</button>
    </form>
  );
}
