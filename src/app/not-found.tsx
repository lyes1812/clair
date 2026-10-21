import { AuthCard } from "@/components/AuthCard";

export default function NotFound() {
  return (
    <AuthCard title="Page introuvable">
      <p>Cette page n'existe pas, ou vous n'y avez pas accès.</p>
      <a href="/espaces">Mes espaces</a>
    </AuthCard>
  );
}
