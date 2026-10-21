"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function SignUpForm({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    const { error } = await authClient.signUp.email({
      name: String(form.get("name")).trim(),
      email: String(form.get("email")).trim(),
      password: String(form.get("password")),
    });
    setPending(false);
    if (error) {
      setError(
        error.code === "USER_ALREADY_EXISTS" || error.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"
          ? "Un compte existe déjà avec cet e-mail."
          : error.code === "PASSWORD_TOO_SHORT"
            ? "Le mot de passe doit contenir au moins 12 caractères."
            : "Inscription impossible. Vérifiez les champs saisis.",
      );
      return;
    }
    router.push(returnTo);
    router.refresh();
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="field-row">
        <label htmlFor="name">Nom</label>
        <input className="input" id="name" name="name" autoComplete="name" required />
      </div>
      <div className="field-row">
        <label htmlFor="email">E-mail</label>
        <input className="input" id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="field-row">
        <label htmlFor="password">Mot de passe (12 caractères minimum)</label>
        <input className="input" id="password" name="password" type="password" autoComplete="new-password" minLength={12} required />
      </div>
      <button className="btn primary" type="submit" disabled={pending}>
        {pending ? "Création…" : "Créer le compte"}
      </button>
    </form>
  );
}
