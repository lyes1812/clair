import { redirect } from "next/navigation";
import { AuthCard } from "@/components/AuthCard";
import { getSession, safeReturnPath } from "@/lib/session";
import { SignUpForm } from "./SignUpForm";

export default async function InscriptionPage({ searchParams }: { searchParams: Promise<{ retour?: string }> }) {
  const { retour } = await searchParams;
  const returnTo = safeReturnPath(retour);
  if (await getSession()) redirect(returnTo);
  return (
    <AuthCard title="Créer un compte">
      <SignUpForm returnTo={returnTo} />
      <p className="desc">
        Déjà un compte ? <a href={`/connexion?retour=${encodeURIComponent(returnTo)}`}>Se connecter</a>
      </p>
    </AuthCard>
  );
}
