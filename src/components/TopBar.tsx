import { Brand } from "./AuthCard";
import { SignOutButton } from "./SignOutButton";

export function TopBar({ email }: { email: string }) {
  return (
    <header className="topbar">
      <Brand />
      <div className="topbar-right">
        <span data-testid="current-user">{email}</span>
        <a href="/espaces">Mes espaces</a>
        <a href="/securite">Sécurité</a>
        <SignOutButton />
      </div>
    </header>
  );
}
