import { AuthCard } from "@/components/AuthCard";
import { safeReturnPath } from "@/lib/session";
import { TotpForm } from "./TotpForm";

export default async function TotpPage({ searchParams }: { searchParams: Promise<{ retour?: string }> }) {
  const { retour } = await searchParams;
  return (
    <AuthCard title="Double authentification">
      <p className="desc">Saisissez le code à 6 chiffres affiché par votre application d'authentification.</p>
      <TotpForm returnTo={safeReturnPath(retour)} />
    </AuthCard>
  );
}
