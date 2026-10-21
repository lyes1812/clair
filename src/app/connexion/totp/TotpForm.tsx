"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function TotpForm({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [useBackup, setUseBackup] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get("code")).trim();
    setPending(true);
    setError(null);
    const { error } = useBackup
      ? await authClient.twoFactor.verifyBackupCode({ code })
      : await authClient.twoFactor.verifyTotp({ code });
    setPending(false);
    if (error) {
      setError("Code invalide ou expiré. Reconnectez-vous si le problème persiste.");
      return;
    }
    router.push(returnTo);
    router.refresh();
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="field-row">
        <label htmlFor="code">{useBackup ? "Code de secours" : "Code"}</label>
        <input
          className="input"
          id="code"
          name="code"
          inputMode={useBackup ? "text" : "numeric"}
          autoComplete="one-time-code"
          pattern={useBackup ? undefined : "[0-9]{6}"}
          required
          autoFocus
        />
      </div>
      <button className="btn primary" type="submit" disabled={pending}>
        Vérifier
      </button>
      <button type="button" className="linklike desc" onClick={() => setUseBackup(!useBackup)}>
        {useBackup ? "Utiliser un code de l'application" : "Utiliser un code de secours"}
      </button>
    </form>
  );
}
