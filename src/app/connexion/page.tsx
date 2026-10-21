import { redirect } from "next/navigation";
import { AuthCard } from "@/components/AuthCard";
import { getSession, safeReturnPath } from "@/lib/session";
import { SignInForm } from "./SignInForm";

export default async function ConnexionPage({ searchParams }: { searchParams: Promise<{ retour?: string }> }) {
  const { retour } = await searchParams;
  const returnTo = safeReturnPath(retour);
  if (await getSession()) redirect(returnTo);
  return (
    <AuthCard title="Connexion">
      <SignInForm returnTo={returnTo} />
      <p className="desc">
        Pas encore de compte ? <a href={`/inscription?retour=${encodeURIComponent(returnTo)}`}>Créer un compte</a>
      </p>
    </AuthCard>
  );
}
